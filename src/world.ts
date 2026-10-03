import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDef, ToolSpec, ToolOutcome, ToolCallContext, World, WorldConsoleDecl, WorldHost } from 'cortico/core/types.ts';
import type { WorldContext } from 'cortico/world.ts';
import { SURFING_DEFAULTS, SURFING_CONFIG_GROUP, SURFING_LIMITS_CONFIG_GROUP, validateConfig, type SurfingConfigSection } from './config.ts';
import { BiliClient, biliKey, type BiliInput } from './bili.ts';
import { ReadError, asReadError, PublicClient, waitWithSignal, type ReadOperation } from './network.ts';
import { PageReader, pageKey } from './page-reader.ts';
import { SnapshotCache, serializeReceipt, estimateTokens, type Material } from './snapshots.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));

const cursor = { type: 'string', maxLength: 256, description: '沿用上次返回的 nextCursor，并保持原目标参数。' };
export const SURFING_TOOL_DECLS: ToolSpec[] = [
  {
    name: 'surfing_read_page', tags: ['read'], description: '读取公开网页正文、目录和链接，返回预算内原文片段；可用 cursor 继续。URL 的章节锚点可定位长文。仅接受公开域名。',
    parameters: { type: 'object', additionalProperties: false, required: ['url'], properties: {
      url: { type: 'string', maxLength: 8192, description: '用户提供或搜索结果中需要打开的 HTTP(S) URL。' }, cursor,
    } },
  },
  {
    name: 'surfing_read_bili', tags: ['read'], description: '匿名读取 B站视频人工或 AI 字幕。提供 BV 即可；可指定 cid 或 URL 中的 p 选择分P。回执为字幕原文片段，缺字幕不代表无音频。',
    parameters: { type: 'object', additionalProperties: false, anyOf: [{ required: ['bvid'] }, { required: ['aid'] }, { required: ['url'] }], properties: {
      bvid: { type: 'string', pattern: '^BV[0-9A-Za-z]{10}$', description: '视频 BV号。' },
      aid: { type: 'integer', minimum: 1, description: '稿件 aid；不知道时只给 BV 或 URL。' },
      cid: { type: 'integer', minimum: 1, description: '特定分P的 cid；省略时按 URL 的 p 或第1P读取。' },
      url: { type: 'string', maxLength: 8192, description: 'B站视频长链或 b23.tv 短链。' }, cursor,
    } },
  },
  {
    name: 'surfing_search_bili', tags: ['read'], description: '独立搜索 B站视频，返回标题、BV、链接、UP主与时长。明确要求找视频时调用；查梗或概念可使用“关键词 梗知识”。可用 cursor 继续。',
    parameters: { type: 'object', additionalProperties: false, required: ['query'], properties: {
      query: { type: 'string', minLength: 1, maxLength: 240 }, cursor,
    } },
  },
];

export class SurfingWorld implements World {
  readonly id = 'surfing';
  private readonly cache = new SnapshotCache();
  private readonly bili = new BiliClient();
  private readonly pages = new PageReader();
  private readonly pendingSearches = new Map<string,{promise:Promise<string>;signal:AbortSignal}>();
  private lifecycle = new AbortController();
  private stopped = false;
  private last?: { status: string; failed: boolean; estimatedTokens: number; sourceTruncated: boolean };

  constructor(private readonly ctx: WorldContext<SurfingConfigSection>, private readonly client = new PublicClient()) {}

  envPromptVars(): Record<string, string> {
    return { 'surfing.maxResponseEstimatedTokens': String(this.ctx.cfg.reading.maxResponseEstimatedTokens),
      'surfing.subtitleGroupSec': String(this.ctx.cfg.bili.subtitleGroupSec) };
  }

  tools(): ToolDef[] {
    return SURFING_TOOL_DECLS.map(tool => ({ ...tool, handler: (args, call) => this.read(tool.name, args, call) }));
  }

  private async read(name: string, args: Record<string, unknown>, call: ToolCallContext): Promise<ToolOutcome> {
    let operation: ReadOperation | undefined;
    try {
      if (this.stopped) throw new ReadError('access_denied', '网上冲浪已停止。');
      const config = structuredClone(this.ctx.cfg);
      validateConfig(config);
      if (args.cursor !== undefined && typeof args.cursor !== 'string') throw new ReadError('cursor_expired', '续读游标必须为字符串。');
      let cursor = args.cursor as string | undefined;
      const signals = [this.lifecycle.signal, ...(call.signal ? [call.signal] : [])];
      operation = this.client.operation(config.network, AbortSignal.any(signals));
      let material: Material | undefined;
      let key: string;
      if (name === 'surfing_read_page') {
        if (typeof args.url !== 'string') throw new ReadError('invalid_input', '提供需要读取的网页 URL。');
        key = pageKey(args.url);
        if (!cursor) material = await this.pages.read(args.url, operation, config.network.maxDownloadBytes);
      } else if (name === 'surfing_read_bili') {
        const input: BiliInput = { bvid: args.bvid as string | undefined, aid: args.aid as number | undefined,
          cid: args.cid as number | undefined, url: args.url as string | undefined };
        key = biliKey(input);
        if (!cursor) material = await this.bili.read(input, operation, config.bili.subtitleGroupSec);
      } else {
        if (typeof args.query !== 'string' || !args.query.trim() || [...args.query.trim()].length > 240)
          throw new ReadError('invalid_input', '搜索词需为1–240字符。');
        const query = args.query.trim();
        key = 'search:' + query;
        if (cursor) cursor = await this.searchCursor(cursor,key,query,config,operation);
        else material = await this.bili.search(query, 1, operation);
      }
      operation.signal.throwIfAborted();
      if (material) cursor = this.cache.put(material, config);
      const page = this.cache.read(cursor!, key, config);
      const status = JSON.parse(page.text).status as string;
      const failed = status !== 'ok';
      this.last = { status, failed, estimatedTokens: page.estimatedTokens, sourceTruncated: page.sourceTruncated };
      return { text: page.text, ...(failed ? { failed: true as const } : {}) };
    } catch (error) {
      const failure = asReadError(error);
      const text = serializeReceipt({ status: failure.kind, reason: failure.message, tool: name,
        hasMore: false, nextCursor: null, sourceTruncated: false });
      this.last = { status: failure.kind, failed: true, estimatedTokens: estimateTokens(text), sourceTruncated: false };
      return { text, failed: true };
    } finally { operation?.close(); }
  }

  private async searchCursor(original: string, key: string, query: string, config: SurfingConfigSection, operation: ReadOperation): Promise<string> {
    while (true) {
      operation.signal.throwIfAborted();
      const next = this.cache.nextSearch(original,key,config);
      if (!next) return original;
      if (next.cursor) return next.cursor;
      let pending = this.pendingSearches.get(original);
      if (!pending) {
        const promise = (async()=>{
          const material = await this.bili.search(query,next.page,operation);
          operation.signal.throwIfAborted();
          const created = this.cache.put(material,config);
          this.cache.rememberSearchNext(original,created);
          return created;
        })();
        pending = {promise,signal:operation.signal}; this.pendingSearches.set(original,pending);
        void promise.finally(()=>{
          if (this.pendingSearches.get(original)===pending) this.pendingSearches.delete(original);
        }).catch(()=>{});
      }
      try { return await waitWithSignal(pending.promise,operation.signal); }
      catch (error) {
        if (operation.signal.aborted || !pending.signal.aborted) throw error;
        if (this.pendingSearches.get(original)===pending) this.pendingSearches.delete(original);
      }
    }
  }

  console(): WorldConsoleDecl {
    const override = join(this.ctx.botDir, 'prompts', 'worlds', 'surfing', 'ENV_PROMPT.md');
    return {
      label: '网上冲浪',
      lamps: [{ label: '最近读取', state: this.last ? (this.last.failed ? 'error' : 'online') : 'offline',
        hint: this.last?.status ?? '尚未读取' }],
      badges: [
        { label: '单次上限', value: this.ctx.cfg.reading.maxResponseEstimatedTokens + ' 估算 token' },
        { label: '最近返回', value: this.last ? this.last.estimatedTokens + ' 估算 token' : '尚未读取' },
        { label: '源材料', value: this.last ? (this.last.sourceTruncated ? '触及保留上限' : '未触及保留上限') : '尚未读取' },
        { label: '文本缓存', value: Math.ceil(this.cache.sizeBytes / 1024) + ' KiB' },
      ],
      config: [SURFING_CONFIG_GROUP, SURFING_LIMITS_CONFIG_GROUP],
      promptDocs: [{ key: 'worlds.surfing.envPrompt', title: '网上冲浪环境提示词', description: '网页、视频与学习工具的使用指导。',
        path: existsSync(override) ? override : ENV_PROMPT_FILE, deploymentPath: override, role: 'envPrompt',
        vars: [
          { name: 'surfing.maxResponseEstimatedTokens', description: '本次完整回执的估算 token 上限。' },
          { name: 'surfing.subtitleGroupSec', description: '新字幕快照的时间分组秒数。' },
        ] }],
    };
  }

  async start(_host: WorldHost): Promise<void> { this.lifecycle = new AbortController(); this.stopped = false; }
  async stop(): Promise<void> {
    this.stopped = true; this.lifecycle.abort(); this.cache.clear(); this.pendingSearches.clear();
    await this.pages.stop();
  }
}
