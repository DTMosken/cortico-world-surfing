import { expect, test } from 'vitest';
import { SnapshotCache, estimateTokens, type Material } from '../src/snapshots.ts';
import { SURFING_DEFAULTS } from '../src/config.ts';
import { receipt } from './platform-fixture.ts';

test('完整回执受限且改变预算续读不丢字、不破坏 Unicode', () => {
  const config = structuredClone(SURFING_DEFAULTS);
  const original = ('字幕🌌与文字段落。'.repeat(1100)) + '\n\n最后的结论。';
  const material: Material = { kind: 'page', key: 'page:article', source: 'https://example.org/article',
    title: '长文', scope: { kind: 'web-page' }, units: [{ kind: 'text', text: original }] };
  const cache = new SnapshotCache();
  let cursor: string | undefined = cache.put(material, config);
  let restored = '';
  let count = 0;
  while (cursor) {
    config.reading.maxResponseEstimatedTokens = count++ === 0 ? 1024 : 2048;
    const result = cache.read(cursor, material.key, config);
    expect(estimateTokens(result.text)).toBeLessThanOrEqual(config.reading.maxResponseEstimatedTokens);
    const page = receipt(result.text);
    expect(result.sourceTruncated).toBe(false);
    expect(page.content).not.toContain('\ufffd');
    restored += page.content;
    cursor = page.nextCursor;
  }
  expect(count).toBeGreaterThan(2);
  expect(restored).toBe(original);
});

function material(units: Material['units'], key = 'page:fixture'): Material {
  return { kind: 'page', key, source: 'https://example.org/article', title: '材料', scope: { kind: 'web-page' }, units };
}

test('空搜索结果说明未找到视频，不输出空字段或链接', () => {
  const config = structuredClone(SURFING_DEFAULTS);
  const source = { ...material([], 'search:词'), kind: 'search' as const, scope: { query: '词', page: 1 } };
  const cache = new SnapshotCache(); const page = cache.read(cache.put(source, config), source.key, config);
  expect(page.text).toContain('未找到匹配的视频');
  expect(page.text).not.toMatch(/https:\/\/|hasMore|estimatedTokens|results|nextCursor|续读 cursor/);
});

test('搜索记录不会切坏；提高预算后可继续取回', () => {
  const cfg = structuredClone(SURFING_DEFAULTS); cfg.reading.maxResponseEstimatedTokens = 1024;
  const title = 'x'.repeat(7000);
  const cache = new SnapshotCache();
  const cursor = cache.put(material([{ kind: 'result', value: { title, bvid: 'BV1aa411a7aa', author: '作者', duration: '1:30' } }]), cfg);
  const limited = cache.read(cursor, 'page:fixture', cfg);
  expect(limited.failed).toBe(true);
  expect(limited.text).toMatch(/^\[tool failed\]/);
  expect(limited.hasMore).toBe(true);
  cfg.reading.maxResponseEstimatedTokens = 3000;
  const complete = cache.read(limited.nextCursor!, 'page:fixture', cfg);
  expect(complete.text).toContain(title);
  expect(complete.hasMore).toBe(false);
});

test('源截断与分页分开，调整源上限不会改变旧快照', () => {
  const cfg = structuredClone(SURFING_DEFAULTS); cfg.reading.maxSourceChars = 12;
  const cache = new SnapshotCache();
  const source = '文字🌌。'.repeat(20);
  const cursor = cache.put(material([{ kind: 'text', text: source }]), cfg);
  cfg.reading.maxSourceChars = 300000;
  const page = cache.read(cursor, 'page:fixture', cfg);
  expect(receipt(page.text).content).toBe([...source].slice(0,12).join(''));
  expect(page.hasMore).toBe(false);
  expect(page.sourceTruncated).toBe(true);
  expect(page.text).toContain('剩余内容未保留');
});

test('拒绝跨目标、篡改、过期与其他实例的游标', () => {
  const cfg = structuredClone(SURFING_DEFAULTS);
  let now = 0;
  const cache = new SnapshotCache(() => now);
  const cursor = cache.put(material([{ kind: 'text', text: '正文。' }]), cfg);
  expect(() => cache.read(cursor, 'page:other', cfg)).toThrow(/不匹配/);
  expect(() => cache.read(cursor.slice(0,-1)+'!', 'page:fixture', cfg)).toThrow(/游标/);
  expect(() => new SnapshotCache().read(cursor, 'page:fixture', cfg)).toThrow(/游标/);
  now = cfg.cache.ttlMs + 1;
  expect(() => cache.read(cursor, 'page:fixture', cfg)).toThrow(/到期/);
});

test('相同预算重读一致，不重复输出时间范围与计数', () => {
  const cfg = structuredClone(SURFING_DEFAULTS); cfg.reading.maxResponseEstimatedTokens = 1024;
  const cache = new SnapshotCache();
  const cursor = cache.put(material(Array.from({length:30},(_,index)=>({ kind: 'text', text: '句段。'.repeat(100),
    startSec:index*30+0.12345, endSec:index*30+29.12345 }))), cfg);
  const first = cache.read(cursor, 'page:fixture', cfg).text;
  expect(cache.read(cursor, 'page:fixture', cfg).text).toBe(first);
  expect(first).not.toMatch(/timeRange|estimatedTokens|materialEstimatedTokens|fromUnit|nextCursor|https:\/\//);
  expect(estimateTokens(first)).toBeLessThanOrEqual(cfg.reading.maxResponseEstimatedTokens);
});

test('容量不足淘汰最久未读的快照', () => {
  const cfg = structuredClone(SURFING_DEFAULTS); cfg.cache.maxBytes = 5000;
  const cache = new SnapshotCache();
  const first = cache.put(material([{kind:'text',text:'a'.repeat(2000)}],'one'), cfg);
  const second = cache.put(material([{kind:'text',text:'b'.repeat(2000)}],'two'), cfg);
  cache.read(first,'one',cfg);
  cache.put(material([{kind:'text',text:'c'.repeat(2000)}],'three'), cfg);
  expect(() => cache.read(second,'two',cfg)).toThrow(/释放/);
  expect(receipt(cache.read(first,'one',cfg).text).content).toBe('a'.repeat(2000));
});

test('远端搜索页由游标指向，重读使用同一份已取得的下一页', () => {
  const cfg = structuredClone(SURFING_DEFAULTS);
  const cache = new SnapshotCache();
  const first = cache.put({...material([{kind:'result',value:{title:'甲',url:'https://example.org/a'}}],'search:词'),kind:'search',nextSearchPage:2},cfg);
  const result = cache.read(first,'search:词',cfg);
  expect(result.hasMore).toBe(true);
  expect(cache.nextSearch(result.nextCursor!,'search:词',cfg)).toEqual({page:2,cursor:undefined});
  const second = cache.put({...material([{kind:'result',value:{title:'乙',url:'https://example.org/b'}}],'search:词'),kind:'search'},cfg);
  cache.rememberSearchNext(result.nextCursor!,second);
  expect(cache.nextSearch(result.nextCursor!,'search:词',cfg)?.cursor).toBe(second);
});

test.each([1024,2048,4096,32768])('预算 %i 包含长标题和混合 Unicode', cap => {
  const cfg = structuredClone(SURFING_DEFAULTS); cfg.reading.maxResponseEstimatedTokens = cap;
  const source = material([{kind:'text',text:'🌌文字\"\\\n\t'.repeat(10000)}]);
  source.title = '标题'.repeat(3000);
  const cache = new SnapshotCache(); let cursor: string|undefined = cache.put(source,cfg);
  let restored = '';
  while(cursor) {
    const page = cache.read(cursor,source.key,cfg);
    expect(estimateTokens(page.text)).toBeLessThanOrEqual(cap);
    const parsed = receipt(page.text); restored += parsed.content; cursor = page.nextCursor;
  }
  expect(restored).toBe(source.units[0].kind==='text' ? source.units[0].text : '');
});

test('渲染失败只声明已取得静态文本', () => {
  const cfg = structuredClone(SURFING_DEFAULTS);
  const source = material([{kind:'text',text:'正文。'}]);
  source.sourceTruncated = true; source.truncationReason = 'rendering_unavailable'; source.scope.renderingReason = '浏览器不可用';
  const cache = new SnapshotCache();
  const result = cache.read(cache.put(source,cfg),source.key,cfg);
  expect(result.sourceTruncated).toBe(true);
  expect(result.text).toContain('仅取得静态网页文本');
  expect(result.text).toContain('浏览器不可用');
});

test('搜索词身份不裁切，其他显示字段裁切时明确列出', () => {
  const cfg = structuredClone(SURFING_DEFAULTS); const source = material([{kind:'text',text:'原文。'}]);
  source.title = '长标题'.repeat(200); source.scope = {kind:'video-search',query:'查询'.repeat(100),part:'分P标题'.repeat(100)};
  source.kind = 'search';
  const cache = new SnapshotCache(); const result = cache.read(cache.put(source,cfg),source.key,cfg);
  expect(result.text).toContain(source.scope.query);
  expect(result.text).toContain('标题信息已截短');
});
