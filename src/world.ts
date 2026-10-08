import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDef, ToolSpec, ToolOutcome, ToolCallContext, World, WorldConsoleDecl, WorldHost } from 'cortico/core/types.ts';
import type { WorldContext } from 'cortico/world.ts';
import { SURFING_DEFAULTS, SURFING_CONFIG_GROUP, SURFING_LIMITS_CONFIG_GROUP, applyBiliDefaults, validateConfig, type SurfingConfigSection } from './config.ts';
import { BiliClient, biliKey, type BiliInput } from './bili.ts';
import { BiliLogin } from './bili-login.ts';
import { ReadError, asReadError, PublicClient, waitWithSignal, type ReadOperation } from './network.ts';
import { PageReader, pageKey } from './page-reader.ts';
import { SnapshotCache, estimateTokens, type Material } from './snapshots.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));

const cursor = { type: 'string', maxLength: 256, description: '沿用回执末尾的续读 cursor。' };
export const SURFING_TOOL_DECLS: ToolSpec[] = [
  {
    name: 'surfing_read_page', tags: ['read'], description: '读取公开网页正文：提供 URL 初读，或用原页 pageRef 与 linkId 打开正文编号链接；用目标页 pageRef 与 cursor 续读。打开链接时不带 cursor。返回预算内原文，仅接受公开域名，支持 URL 章节锚点。',
    parameters: { type: 'object', additionalProperties: false, oneOf: [
      { required: ['url'], not: { required: ['linkId'] } },
      { required: ['pageRef'], not: { required: ['linkId'] } },
      { required: ['pageRef', 'linkId'], not: { anyOf: [{ required: ['url'] }, { required: ['cursor'] }] } },
    ], properties: {
      url: { type: 'string', maxLength: 8192, description: '用户提供、分享卡片或搜索结果中的公开 HTTP(S) 网页 URL。' },
      pageRef: { type: 'string', maxLength: 256, description: '网页回执中的 pageRef；打开链接时用原页引用，续读时用目标页引用。' },
      linkId: { type: 'string', pattern: '^L[1-9][0-9]*$', description: '打开正文中的链接编号，如 L1；需配合原页 pageRef，不带 cursor。' }, cursor,
    } },
  },
  {
    name: 'surfing_read_bili', tags: ['read'], description: '读取 B站视频人工或 AI 字幕；可选登录由面板管理。提供 BV 或视频链接即可；可指定 cid 或 URL 中的 p 选择分P。回执为字幕原文片段，未取得字幕不代表无音频。',
    parameters: { type: 'object', additionalProperties: false, anyOf: [{ required: ['bvid'] }, { required: ['aid'] }, { required: ['url'] }], properties: {
      bvid: { type: 'string', pattern: '^BV[0-9A-Za-z]{10}$', description: '视频 BV号。' },
      aid: { type: 'integer', minimum: 1, description: '稿件 aid；不知道时只给 BV 或 URL。' },
      cid: { type: 'integer', minimum: 1, description: '特定分P的 cid；省略时按 URL 的 p 或第1P读取。' },
      url: { type: 'string', maxLength: 8192, description: 'B站视频长链或 b23.tv 短链，可直接使用分享卡片中的链接。' }, cursor,
    } },
  },
  {
    name: 'surfing_search_bili', tags: ['read'], description: '独立搜索 B站视频，返回标题、BV、UP主与时长。明确要求找视频时调用；查梗或概念可使用“关键词 梗知识”。可用 cursor 继续。',
    parameters: { type: 'object', additionalProperties: false, required: ['query'], properties: {
      query: { type: 'string', minLength: 1, maxLength: 240 }, cursor,
    } },
  },
];

export class SurfingWorld implements World {
  readonly id = 'surfing';
  private readonly cache = new SnapshotCache();
  private readonly login: BiliLogin;
  private readonly bili: BiliClient;
  private readonly pages = new PageReader();
  private readonly pendingSearches = new Map<string,{promise:Promise<string>;signal:AbortSignal}>();
  private lifecycle = new AbortController();
  private stopped = false;
  private last?: { status: string; failed: boolean; estimatedTokens: number; sourceTruncated: boolean };

  constructor(private readonly ctx: WorldContext<SurfingConfigSection>, private readonly client = new PublicClient()) {
    applyBiliDefaults(ctx.cfg);
    this.login = new BiliLogin(ctx);
    this.bili = new BiliClient(this.login);
  }

  envPromptVars(): Record<string, string> {
    return { 'surfing.maxResponseEstimatedTokens': String(this.ctx.cfg.reading.maxResponseEstimatedTokens),
      'surfing.subtitleGroupSec': String(this.ctx.cfg.bili.subtitleGroupSec) };
  }

  tools(): ToolDef[] {
    return SURFING_TOOL_DECLS.map(tool => ({ ...tool, interruptible: true, handler: (args, call) => this.read(tool.name, args, call) }));
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
        if (args.pageRef !== undefined) {
          if (typeof args.pageRef !== 'string' || args.url !== undefined)
            throw new ReadError('invalid_input', '提供网页 pageRef 或 URL，两者只需一个。');
          if (args.linkId !== undefined) {
            if (typeof args.linkId !== 'string' || !/^L[1-9][0-9]*$/.test(args.linkId) || args.cursor !== undefined)
              throw new ReadError('invalid_input', '打开链接时提供 L1 等 linkId，不带 cursor；续读用目标页 pageRef 和 cursor。');
            const url = this.cache.link(args.pageRef, args.linkId, config);
            key = pageKey(url);
            material = await this.pages.read(url, operation, config.network.maxDownloadBytes);
          } else ({ key, cursor } = this.cache.pageCursor(args.pageRef, cursor, config));
        } else {
          if (args.linkId !== undefined) throw new ReadError('invalid_input', '打开编号链接需提供原页 pageRef 和 linkId。');
          if (typeof args.url !== 'string') throw new ReadError('invalid_input', '提供需要读取的网页 URL 或 pageRef。');
          key = pageKey(args.url);
          if (!cursor) material = await this.pages.read(args.url, operation, config.network.maxDownloadBytes);
        }
      } else if (name === 'surfing_read_bili') {
        const input: BiliInput = { bvid: args.bvid as string | undefined, aid: args.aid as number | undefined,
          cid: args.cid as number | undefined, url: args.url as string | undefined };
        key = biliKey(input);
        if (!cursor) material = await this.bili.read(input, operation, config.bili.subtitleGroupSec, config.bili);
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
      this.last = { status: page.failed ? 'response_limit' : 'ok', failed: !!page.failed,
        estimatedTokens: page.estimatedTokens, sourceTruncated: page.sourceTruncated };
      return { text: page.text, ...(page.failed ? { failed: true as const } : {}) };
    } catch (error) {
      const failure = asReadError(error);
      const text = '[tool failed] ' + failure.message;
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
      panels: [{ id: 'login', title: 'B站登录' }],
      invoke: async (panel, method) => {
        if (panel !== 'login' || !['state', 'start', 'poll', 'logout'].includes(method)) throw new Error('未知的登录操作。');
        if (method === 'logout') return this.login.logout();
        if (this.stopped) {
          if (method === 'state') return this.login.state();
          throw new Error('请先启用网上冲浪，再扫码登录。');
        }
        const operation = this.client.operation(this.ctx.cfg.network, this.lifecycle.signal);
        try {
          if (method === 'start') return await this.login.start(operation);
          if (method === 'poll') return await this.login.poll(operation);
          if (this.login.state().kind === 'unverified') await this.login.cookie(operation);
          return this.login.state();
        } finally { operation.close(); }
      },
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
    this.stopped = true; this.lifecycle.abort(); this.login.cancel(); this.cache.clear(); this.pendingSearches.clear();
    await this.pages.stop();
  }
}
