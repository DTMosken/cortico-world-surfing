import { expect, test } from 'vitest';
import type { WorldContext } from 'cortico/world.ts';
import { SURFING_DEFAULTS, validateConfig, type SurfingConfigSection } from '../src/config.ts';
import { PublicClient, waitWithSignal, type GetOptions, type NetworkLimits } from '../src/network.ts';
import { SurfingWorld } from '../src/world.ts';
import { PlatformFixture, receipt } from './platform-fixture.ts';

const posts = (page: number, count: number) => Array.from({ length: count }, (_, index) => ({ tid: `${page}0${index}`,
  title: `第${page}页帖子${index}`, content: `摘要${index}`, forum_name: '示例' }));

class SitesFixture extends PlatformFixture {
  urls: string[] = [];
  pages: Record<number, { posts: unknown[]; hasMore: number }> = { 1: { posts: posts(1, 7), hasMore: 1 }, 2: { posts: posts(2, 1), hasMore: 0 } };
  fail = new Set<string>();
  hang = new Set<string>();
  override async get(url: string, options: GetOptions = {}) {
    const target = new URL(url);
    this.urls.push(url);
    if (this.fail.has(target.hostname)) return { url, status: 403, headers: {}, body: Buffer.alloc(0) };
    if (this.hang.has(target.hostname)) return new Promise<never>(() => {});
    const json = (body: unknown) => ({ url, status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(body)) });
    if (target.pathname === '/mo/q/search/thread') {
      const page = Number(target.searchParams.get('pn'));
      return json({ no: 0, data: { current_page: page, has_more: this.pages[page].hasMore, post_list: this.pages[page].posts } });
    }
    if (target.pathname === '/mo/m') return { url, status: 200, headers: { 'content-type': 'text/html' },
      body: Buffer.from(`<title>帖子</title><main><p>帖子正文 ${target.searchParams.get('kz')}。</p></main>`) };
    if (target.hostname === 'zh.moegirl.org.cn') return json(target.searchParams.get('titles') === '无匹配'
      ? { query: { pages: { '-1': { title: '无匹配', missing: '', fullurl: 'https://zh.moegirl.org.cn/x' } } } }
      : { query: { pages: { 1: { title: '破防', extract: '萌娘释义。', fullurl: 'https://zh.moegirl.org.cn/%E7%A0%B4%E9%98%B2' } } } });
    if (target.hostname === 'baike.baidu.com') return json(target.searchParams.get('bk_key') === '无匹配'
      ? {} : { title: '破防', abstract: '百科释义。', wapUrl: 'http://wapbaike.baidu.com/item/x' });
    if (target.hostname === 'wapbaike.baidu.com') return { url, status: 200, headers: { 'content-type': 'text/html' },
      body: Buffer.from('<title>词条</title><main><p>词条正文。</p></main>') };
    return super.get(url, options);
  }
}

class FixtureClient extends PublicClient {
  constructor(readonly fixture: SitesFixture) { super(); }
  override operation(limits: NetworkLimits, parent?: AbortSignal) {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(limits.requestTimeoutMs), ...(parent ? [parent] : [])]);
    return { signal, downloadedBytes: 0, close: () => controller.abort(),
      get: (url: string, options?: GetOptions) => waitWithSignal(this.fixture.get(url, options), signal) };
  }
}

function setup(edit: (config: SurfingConfigSection) => void = () => {}) {
  const cfg = structuredClone(SURFING_DEFAULTS);
  edit(cfg);
  const ctx = { id: 'surfing', cfg, timezone: 'UTC', botName: 'test', botDir: '.', packageDir: '.', dataDir: '.', repoRoot: '.',
    secret: () => '', storeSecret() {}, persist() {}, async restart() {} } as WorldContext<SurfingConfigSection>;
  const fixture = new SitesFixture();
  const world = new SurfingWorld(ctx, new FixtureClient(fixture));
  const call = async (name: string, args: Record<string, unknown>) => {
    const outcome = await world.tools().find(tool => tool.name === name)!.handler(args, { role: 'test', log: {} as never });
    return typeof outcome === 'string' ? { text: outcome, failed: undefined } : outcome;
  };
  return { fixture, world, call, cfg };
}
const hosts = (fixture: SitesFixture) => [...new Set(fixture.urls.map(url => new URL(url).hostname))].sort();

test('多源首搜按来源分组，贴吧和百科共用 pageRef 编号，B站只给 BV号', async () => {
  const { call, world } = setup();
  const { text, failed } = await call('surfing_search_all', { query: '破防' });
  expect(failed).toBeUndefined();
  const pageRef = receipt(text).pageRef!;
  expect(text).toBe(`「破防」\npageRef: ${pageRef}\n\n【B站】\n· 第1页 比赛 & 说明｜作者｜1:30｜BV1aa411a7aa\n\n【贴吧】\n`
    + [0, 1, 2, 3, 4].map(i => `· （示例吧）第1页帖子${i} [L${i + 1}]\n  摘要${i}\n`).join('')
    + '更多贴吧结果 [L6]\n\n【萌娘百科】\n破防：萌娘释义。 [L7]\n\n【百度百科】\n破防：百科释义。 [L8]');
  expect(text).not.toMatch(/cursor|https?:/);
  await world.stop();
});

test('B站候选的 BV号可用于 surfing_read_bili 的三种 mode，字幕为默认', async () => {
  const { call, fixture, world } = setup();
  const bvid = /BV[0-9A-Za-z]{10}/.exec((await call('surfing_search_all', { query: '破防', sources: ['bili'] })).text)![0];
  expect((await call('surfing_read_bili', { bvid })).text).toContain('开头。');
  expect((await call('surfing_read_bili', { bvid, cid: 201 })).text).toContain('附录说明。');
  const info = await call('surfing_read_bili', { bvid, mode: 'info' });
  expect(info.text).toContain('视频简介：竞赛介绍'); expect(info.text).toContain('cid: 201');
  const comments = await call('surfing_read_bili', { bvid, mode: 'comments', sort: 'time' });
  expect(comments.text).toContain('最新评论'); expect(comments.text).toContain('楼中楼预览。');
  const thread = await call('surfing_read_bili', { bvid, mode: 'comments', root: '123' });
  expect(thread.text).toContain('根评论 rpid: 123'); expect(thread.text).toContain('楼中楼第1页。');
  expect(fixture.commentRequests.map(request => request.sort)).toEqual(['2', 'thread']);
  await world.stop();
});

test('sources 和配置开关决定请求范围，并保持固定来源顺序', async () => {
  const selected = setup();
  const tieba = await selected.call('surfing_search_all', { query: '破防', sources: ['tieba'] });
  expect(tieba.text).toContain('【贴吧】'); expect(tieba.text).not.toContain('【B站】');
  expect(hosts(selected.fixture)).toEqual(['tieba.baidu.com']);
  expect((await selected.call('surfing_search_all', { query: '破防', sources: ['unknown'] })).failed).toBe(true);
  expect((await selected.call('surfing_search_all', { query: '破防', sources: [] })).failed).toBe(true);
  await selected.world.stop();

  const off = setup(config => { config.search.moegirl = false; });
  const text = (await off.call('surfing_search_all', { query: '破防' })).text;
  expect(text).not.toContain('萌娘百科'); expect(text).toContain('破防：百科释义。 [L7]');
  expect(hosts(off.fixture)).not.toContain('zh.moegirl.org.cn');
  off.fixture.urls = [];
  expect((await off.call('surfing_search_all', { query: '破防', sources: ['moegirl'] })).text).toBe('【萌娘百科】已在配置中关闭。');
  expect(off.fixture.urls).toEqual([]);
  off.cfg.search.moegirl = true;
  expect((await off.call('surfing_search_all', { query: '破防' })).text).toContain('【萌娘百科】');
  await off.world.stop();

  const none = setup(config => { Object.assign(config.search, { bili: false, tieba: false, moegirl: false, baike: false }); });
  expect((await none.call('surfing_search_all', { query: '破防' })).text).toBe('[tool failed] 所有来源已在配置中关闭。');
  await none.world.stop();
});

test('单源失败只留短状态；仅 B站候选和无匹配都不生成 pageRef', async () => {
  const { call, fixture, world } = setup();
  fixture.fail.add('zh.moegirl.org.cn');
  expect((await call('surfing_search_all', { query: '破防', sources: ['bili', 'moegirl'] })).text)
    .toBe('「破防」\n\n【B站】\n· 第1页 比赛 & 说明｜作者｜1:30｜BV1aa411a7aa\n\n【萌娘百科】访问受限。');
  fixture.pages[1] = { posts: [], hasMore: 0 };
  expect((await call('surfing_search_all', { query: '无匹配', sources: ['tieba', 'baike'] })).text)
    .toBe('【贴吧】未找到匹配结果。\n\n【百度百科】未找到匹配结果。');
  fixture.fail.delete('zh.moegirl.org.cn');
  expect((await call('surfing_search_all', { query: '无匹配', sources: ['moegirl'] })).text).toBe('【萌娘百科】未找到匹配结果。');
  await world.stop();
});

test('某来源挂起到超时，其他来源结果仍然返回', async () => {
  const { call, fixture, world } = setup(config => { config.network.requestTimeoutMs = 3000; });
  fixture.hang.add('zh.moegirl.org.cn');
  const { text, failed } = await call('surfing_search_all', { query: '破防', sources: ['baike', 'moegirl'] });
  expect(failed).toBeUndefined();
  expect(text).toContain('破防：百科释义。 [L1]'); expect(text).toContain('【萌娘百科】读取已取消或超时。');
  await world.stop();
}, 10000);

test('编号打开帖子和百科原文，正文沿用网页回执', async () => {
  const { call, fixture, world } = setup();
  const first = receipt((await call('surfing_search_all', { query: '破防' })).text);
  const post = await call('surfing_read_page', { pageRef: first.pageRef, linkId: 'L1' });
  expect(post.text).toContain('网页：帖子'); expect(post.text).toContain('帖子正文 100。');
  expect(fixture.urls).toContain('https://tieba.baidu.com/mo/m?kz=100');
  const entry = await call('surfing_read_page', { pageRef: first.pageRef, linkId: 'L8' });
  expect(entry.text).toContain('词条正文。');
  await world.stop();
});

test('更多贴吧结果先读完已取页，再请求下一页；旧引用含义不变，耗尽后不再列编号', async () => {
  const { call, fixture, world } = setup();
  const firstText = (await call('surfing_search_all', { query: '破防', sources: ['tieba'] })).text;
  const first = receipt(firstText);
  const tiebaRequests = () => fixture.urls.filter(url => url.includes('/search/thread')).length;
  expect(tiebaRequests()).toBe(1);
  const second = await call('surfing_read_page', { pageRef: first.pageRef, linkId: 'L6' });
  const secondRef = receipt(second.text).pageRef!;
  expect(second.text).toBe(`「破防」· 贴吧\npageRef: ${secondRef}\n\n· （示例吧）第1页帖子5 [L1]\n  摘要5\n· （示例吧）第1页帖子6 [L2]\n  摘要6\n更多贴吧结果 [L3]`);
  expect(tiebaRequests()).toBe(1);

  expect((await call('surfing_read_page', { pageRef: first.pageRef, linkId: 'L6' })).text).toBe(second.text);
  expect((await call('surfing_read_page', { pageRef: first.pageRef })).text).toBe(firstText);
  expect((await call('surfing_read_page', { pageRef: first.pageRef, linkId: 'L1' })).text).toContain('帖子正文 100。');
  expect((await call('surfing_read_page', { pageRef: secondRef, linkId: 'L1' })).text).toContain('帖子正文 105。');

  const third = (await call('surfing_read_page', { pageRef: secondRef, linkId: 'L3' })).text;
  expect(tiebaRequests()).toBe(2);
  expect(third).toContain('第2页帖子0 [L1]'); expect(third).not.toContain('更多贴吧结果');
  await world.stop();
});

test('上游声称还有结果但下一页为空时报告耗尽；过期引用报告失败', async () => {
  const { call, fixture, world } = setup(config => { config.search.maxResults = 7; });
  fixture.pages[2] = { posts: [], hasMore: 0 };
  const first = receipt((await call('surfing_search_all', { query: '破防', sources: ['tieba'] })).text);
  expect((await call('surfing_read_page', { pageRef: first.pageRef, linkId: 'L8' })).text).toBe('【贴吧】没有更多结果。');
  await world.stop();
  const expired = setup();
  const ref = receipt((await expired.call('surfing_search_all', { query: '破防', sources: ['tieba'] })).text).pageRef;
  expired.fixture.pages[2] = { posts: [], hasMore: 0 };
  await expired.world.stop();
  await expired.world.start({} as never);
  const failure = await expired.call('surfing_read_page', { pageRef: ref, linkId: 'L6' });
  expect(failure.failed).toBe(true); expect(failure.text).toMatch(/^\[tool failed\] 引用已到期/);
  await expired.world.stop();
});

test('回执超出返回上限时用 pageRef 与 cursor 续读', async () => {
  const { call, fixture, world, cfg } = setup(config => { config.reading.maxResponseEstimatedTokens = 1024; config.search.maxResults = 10; });
  fixture.pages[1] = { hasMore: 0, posts: Array.from({ length: 10 }, (_, i) => ({ tid: String(i), title: '题'.repeat(60) + i, content: '摘'.repeat(70), forum_name: '吧'.repeat(30) })) };
  let page = receipt((await call('surfing_search_all', { query: '破防' })).text);
  let all = page.content;
  expect(page.nextCursor).toBeTruthy();
  const ref = page.pageRef;
  while (page.nextCursor) { page = receipt((await call('surfing_read_page', { pageRef: ref, cursor: page.nextCursor })).text); all += page.content; }
  expect(all).toContain('破防：百科释义。 [L12]');
  expect(cfg.search.maxResults).toBe(10);
  await world.stop();
});

test('配置校验覆盖站点搜索设置，分批写入后补齐缺失字段', () => {
  const config = structuredClone(SURFING_DEFAULTS);
  config.search = { moegirl: false } as SurfingConfigSection['search'];
  validateConfig(config);
  expect(config.search).toEqual({ ...SURFING_DEFAULTS.search, moegirl: false });
  config.search.maxResults = 11;
  expect(() => validateConfig(config)).toThrow('每源显示条数');
  config.search.maxResults = 5; (config.search as Record<string, unknown>).baike = 'yes';
  expect(() => validateConfig(config)).toThrow('百度百科');
});
