import { expect, test } from 'vitest';
import type { WorldContext } from 'cortico/world.ts';
import { SURFING } from '../src/definition.ts';
import { SurfingWorld } from '../src/world.ts';
import { SURFING_DEFAULTS, type SurfingConfigSection } from '../src/config.ts';
import { estimateTokens } from '../src/snapshots.ts';
import { PublicClient, validatePublicUrl, waitWithSignal, type NetworkLimits } from '../src/network.ts';
import { PlatformFixture, receipt } from './platform-fixture.ts';

class FixtureClient extends PublicClient {
  constructor(readonly fixture: PlatformFixture) { super(); }
  override operation(limits: NetworkLimits, parent?: AbortSignal) {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal,AbortSignal.timeout(limits.requestTimeoutMs),...(parent?[parent]:[])]);
    return {signal,downloadedBytes:0,close:()=>controller.abort(),get:(url:string,options?:import('../src/network.ts').GetOptions)=>waitWithSignal(this.fixture.get(url,options),signal)};
  }
}
function result(outcome: Awaited<ReturnType<ReturnType<SurfingWorld['tools']>[number]['handler']>>) {
  return { ...receipt(typeof outcome==='string'?outcome:outcome.text), failed: typeof outcome !== 'string' && !!outcome.failed };
}

function context(): WorldContext<SurfingConfigSection> {
  return { id: 'surfing', cfg: structuredClone(SURFING_DEFAULTS), timezone: 'UTC', botName: 'test',
    botDir: '.', packageDir: '.', dataDir: '.', repoRoot: '.', secret() { return ''; },
    storeSecret() { throw new Error('credentials must not be stored'); }, persist() {}, async restart() {} };
}

test('独立 World 在没有 learn 或凭证时提供工具、登录和可调面板', () => {
  const world = new SurfingWorld(context());
  expect(world.tools().map(x=>x.name)).toEqual(['surfing_read_page','surfing_read_bili','surfing_search_bili','surfing_open_link']);
  const groups = world.console().config!;
  const fields = groups.flatMap(group => Object.keys(group.schema.properties));
  expect(fields).toContain('worlds.surfing.reading.maxResponseEstimatedTokens');
  expect(fields).toContain('worlds.surfing.bili.maxSubtitleRetries');
  expect(fields).toContain('worlds.surfing.bili.subtitleRetryDelayMs');
  expect(fields.some(field => /login|cookie|apiKey|summaryModel/i.test(field))).toBe(false);
  expect(world.console().panels?.some(panel=>panel.id==='login')).toBe(true);
  const first = SURFING.defaults(), second = SURFING.defaults();
  first.reading.maxResponseEstimatedTokens = 1024;
  expect(second.reading.maxResponseEstimatedTokens).toBe(SURFING_DEFAULTS.reading.maxResponseEstimatedTokens);
});

test('已有配置缺少新增重试配置时补默认值，保留原阅读配置', () => {
  const ctx = context(); const bili = ctx.cfg.bili as Partial<SurfingConfigSection['bili']>;
  delete bili.maxSubtitleRetries; delete bili.subtitleRetryDelayMs;
  ctx.cfg.reading.maxResponseEstimatedTokens = 2048;
  new SurfingWorld(ctx);
  expect(ctx.cfg.bili).toEqual(SURFING_DEFAULTS.bili);
  expect(ctx.cfg.reading.maxResponseEstimatedTokens).toBe(2048);
});

test('错误回执也受完整返回上限约束', async () => {
  const ctx = context(); ctx.cfg.reading.maxResponseEstimatedTokens = 1024;
  const world = new SurfingWorld(ctx);
  const tool = world.tools()[0];
  const outcome = await tool.handler({ url: 'http://localhost/' }, { role: 'test', log: {} as never });
  const result = typeof outcome === 'string' ? { text: outcome } : outcome;
  expect(result.failed).toBe(true);
  expect(result.text).toMatch(/^\[tool failed\] .*公开域名/);
  expect(result.text).not.toMatch(/hasMore|sourceTruncated|estimatedTokens|null|\{.*status/);
  expect(estimateTokens(result.text)).toBeLessThanOrEqual(ctx.cfg.reading.maxResponseEstimatedTokens);
});

test('World 热调返回量后沿原位置续读，续读不访问平台', async () => {
  const ctx = context(); ctx.cfg.reading.maxResponseEstimatedTokens = 1024;
  const fixture = new PlatformFixture(); fixture.subtitleTail = '原文🌌'.repeat(2000);
  const world = new SurfingWorld(ctx,new FixtureClient(fixture));
  const tool = world.tools()[1]; const call = {role:'test',log:{} as never};
  let receipt = result(await tool.handler({bvid:'BV1aa411a7aa'},call));
  let content = receipt.content; expect(receipt.nextCursor).toBeTruthy();
  expect(estimateTokens(receipt.text)).toBeLessThanOrEqual(ctx.cfg.reading.maxResponseEstimatedTokens);
  fixture.offline = true;
  ctx.cfg.reading.maxResponseEstimatedTokens = 2048; ctx.cfg.bili.subtitleGroupSec = 1;
  while(receipt.nextCursor) {
    receipt = result(await tool.handler({bvid:'BV1aa411a7aa',cursor:receipt.nextCursor},call));
    expect(receipt.failed).toBe(false);
    expect(estimateTokens(receipt.text)).toBeLessThanOrEqual(ctx.cfg.reading.maxResponseEstimatedTokens);
    content += receipt.content;
  }
  const original = '[00:00–00:01] 开头。\n\n[00:31–00:32] '+fixture.subtitleTail+'\n\n';
  expect(content.slice(0, original.length)).toBe(original);
  expect(content).toContain('cid: 201');
  expect(receipt.text).not.toContain('https://');
  await world.stop();
});

test('搜索仅在跨远端页时请求平台，重放边界游标返回相同材料', async () => {
  const fixture = new PlatformFixture(); const world = new SurfingWorld(context(),new FixtureClient(fixture));
  const tool = world.tools()[2]; const call = {role:'test',log:{} as never};
  const first = result(await tool.handler({query:'竞赛'},call));
  const second = result(await tool.handler({query:'竞赛',cursor:first.nextCursor},call));
  expect(first.content).toContain('第1页'); expect(second.content).toContain('第2页');
  expect(second.nextCursor).toBeUndefined();
  expect(second.text).not.toContain('https://');
  fixture.offline = true;
  const replay = result(await tool.handler({query:'竞赛',cursor:first.nextCursor},call));
  expect(replay).toEqual(second); expect(fixture.searchPages).toEqual([1,2]);
  await world.stop();
});

test('同一搜索边界并发续读只获取一份下一页快照', async () => {
  class RacingFixture extends PlatformFixture {
    generation = 0;
    override async get(url: string) {
      const target = new URL(url);
      if (!target.pathname.endsWith('/search/type') || target.searchParams.get('page')!=='2') return super.get(url);
      const generation = ++this.generation; await new Promise(resolve=>setTimeout(resolve,20));
      const response = await super.get(url); const body = JSON.parse(response.body.toString());
      body.data.result[0].title = '第2页第'+generation+'次快照';
      return {...response,body:Buffer.from(JSON.stringify(body))};
    }
  }
  const fixture = new RacingFixture(); const world = new SurfingWorld(context(),new FixtureClient(fixture));
  const tool = world.tools()[2]; const call = {role:'test',log:{} as never};
  const first = result(await tool.handler({query:'竞赛'},call)); const args = {query:'竞赛',cursor:first.nextCursor};
  const [left,right] = (await Promise.all([tool.handler(args,call),tool.handler(args,call)])).map(result);
  expect(left).toEqual(right); expect(left.content).toContain('第1次快照');
  expect(fixture.searchPages).toEqual([1,2]);
  expect(result(await tool.handler(args,call))).toEqual(left);
  await world.stop();
});

test('取消首个搜索等待者后，其他调用可在自己的时限内继续', async () => {
  class SlowFixture extends PlatformFixture {
    override async get(url:string) {
      if (new URL(url).searchParams.get('page')==='2') await new Promise(resolve=>setTimeout(resolve,40));
      return super.get(url);
    }
  }
  const fixture = new SlowFixture(); const world = new SurfingWorld(context(),new FixtureClient(fixture));
  const tool = world.tools()[2]; const call = {role:'test',log:{} as never};
  const page = result(await tool.handler({query:'竞赛'},call)); const args={query:'竞赛',cursor:page.nextCursor};
  const controller = new AbortController();
  const first = tool.handler(args,{...call,signal:controller.signal}); const second = tool.handler(args,call);
  setTimeout(()=>controller.abort(),5);
  const [cancelled,complete] = (await Promise.all([first,second])).map(result);
  expect(cancelled.failed).toBe(true); expect(complete.failed).toBe(false);
  expect(complete.content).toContain('第2页');
  expect(result(await tool.handler(args,call))).toEqual(complete);
  await world.stop();
});

class PageFixtureClient extends PublicClient {
  requests: string[] = [];
  offline = false;
  constructor(private readonly html: Record<string, string>) { super(async () => [{ address: '127.0.0.1', family: 4 }]); }
  override operation(limits: NetworkLimits, parent?: AbortSignal) {
    const guarded = super.operation(limits, parent);
    return { signal: guarded.signal, downloadedBytes: 0, close: () => guarded.close(), get: async (input: string) => {
      const url = validatePublicUrl(input);
      if (url.hostname !== 'example.org') return guarded.get(input);
      this.requests.push(url.pathname);
      if (this.offline) throw new Error('fixture offline');
      return { url: url.href, status: this.html[url.pathname] ? 200 : 404, headers: { 'content-type': 'text/html' },
        body: Buffer.from(this.html[url.pathname] ?? '') };
    } };
  }
}

test('主agent按正文编号打开目标页，目标 pageRef 续读不再请求网络', async () => {
  const ctx = context(); ctx.cfg.reading.maxResponseEstimatedTokens = 1024;
  const client = new PageFixtureClient({
    '/article': '<title>文章</title><nav><a href="/menu">菜单</a></nav><main><p>详情参见<a href="/guide#install">安装指南</a>。</p></main>',
    '/guide': `<title>指南</title><main><h2 id="install">安装</h2><p>${'正文🌌'.repeat(2000)}<a href="/last">末尾资料</a></p><h2>其他章节</h2><p>未选中。</p></main>`,
    '/last': '<main><p>最后一页。</p></main>',
  });
  const world = new SurfingWorld(ctx, client); const call = { role: 'test', log: {} as never };
  const read = world.tools().find(x => x.name === 'surfing_read_page')!;
  const open = world.tools().find(x => x.name === 'surfing_open_link')!;
  try {
    const first = result(await read.handler({ url: 'https://example.org/article' }, call));
    expect(first.failed).toBe(false); expect(first.content).toContain('安装指南 [L1]');
    expect(first.text).not.toMatch(/菜单|https?:\/\//);
    let target = result(await open.handler({ pageRef: first.pageRef, linkId: 'L1' }, call));
    expect(target.failed).toBe(false); expect(target.pageRef).not.toBe(first.pageRef);
    expect(target.nextCursor).toBeTruthy(); expect(target.text).toContain('章节：install');
    let restored = target.content; const targetRef = target.pageRef;
    client.offline = true;
    ctx.cfg.reading.maxResponseEstimatedTokens = 2048;
    while (target.nextCursor) {
      target = result(await read.handler({ pageRef: targetRef, cursor: target.nextCursor }, call));
      expect(target.failed).toBe(false); expect(target.pageRef).toBe(targetRef);
      expect(estimateTokens(target.text)).toBeLessThanOrEqual(ctx.cfg.reading.maxResponseEstimatedTokens);
      restored += target.content;
    }
    expect(restored).toBe('## 安装\n\n' + '正文🌌'.repeat(2000) + '末尾资料 [L1]\n\n');
    expect(restored).not.toContain('未选中');
    expect(client.requests).toEqual(['/article', '/guide']);
    const mismatch = result(await read.handler({ pageRef: first.pageRef, cursor: targetRef }, call));
    expect(mismatch.failed).toBe(true); expect(mismatch.text).toContain('不匹配');
    client.offline = false;
    const last = result(await open.handler({ pageRef: targetRef, linkId: 'L1' }, call));
    expect(last.failed).toBe(false); expect(last.content).toContain('最后一页。');
  } finally { await world.stop(); }
});

test('打开编号链接继续拒绝解析到内网的域名，无效编号不发出请求', async () => {
  const client = new PageFixtureClient({ '/article': '<main><p><a href="https://inside.example.net/">相关资料</a><a href="http://127.0.0.1/">本机</a></p></main>' });
  const world = new SurfingWorld(context(), client); const call = { role: 'test', log: {} as never };
  const read = world.tools().find(x => x.name === 'surfing_read_page')!;
  const open = world.tools().find(x => x.name === 'surfing_open_link')!;
  try {
    const page = result(await read.handler({ url: 'https://example.org/article' }, call));
    expect(page.content).toContain('相关资料 [L1]'); expect(page.content).not.toContain('[L2]');
    const blocked = result(await open.handler({ pageRef: page.pageRef, linkId: 'L1' }, call));
    expect(blocked.failed).toBe(true); expect(blocked.text).toContain('公网地址');
    const missing = result(await open.handler({ pageRef: page.pageRef, linkId: 'L99' }, call));
    expect(missing.failed).toBe(true); expect(missing.text).toContain('没有此链接编号');
    expect(client.requests).toEqual(['/article']);
  } finally { await world.stop(); }
});
