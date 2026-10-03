import { expect, test } from 'vitest';
import { SnapshotCache, type Material } from '../src/snapshots.ts';
import { SURFING_DEFAULTS } from '../src/config.ts';
import { estimateTokens } from '../src/tokens.ts';

test('完整回执受限且改变预算续读不丢字、不破坏 Unicode', () => {
  const config = structuredClone(SURFING_DEFAULTS);
  const original = ('字幕🌌与文字段落。'.repeat(1100)) + '\n\n最后的结论。';
  const material: Material = { kind: 'page', key: 'page:article', source: 'https://example.org/article',
    title: '长文', scope: { kind: 'web-page' }, units: [{ kind: 'text', text: original }] };
  const cache = new SnapshotCache();
  let cursor: string | null = cache.put(material, config);
  let restored = '';
  let count = 0;
  while (cursor) {
    config.reading.maxResponseEstimatedTokens = count++ === 0 ? 1024 : 2048;
    const result = cache.read(cursor, material.key, config);
    expect(estimateTokens(result.text)).toBeLessThanOrEqual(config.reading.maxResponseEstimatedTokens);
    const page = JSON.parse(result.text);
    expect(page.sourceTruncated).toBe(false);
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

test('完整单条链接不会切坏；提高预算后可继续取回', () => {
  const cfg = structuredClone(SURFING_DEFAULTS); cfg.reading.maxResponseEstimatedTokens = 1024;
  const url = 'https://example.org/' + 'x'.repeat(7000);
  const cache = new SnapshotCache();
  const cursor = cache.put(material([{ kind: 'link', value: { text: '长链接', url } }]), cfg);
  const limited = JSON.parse(cache.read(cursor, 'page:fixture', cfg).text);
  expect(limited.status).toBe('response_limit');
  expect(limited.links).toEqual([]);
  expect(limited.hasMore).toBe(true);
  cfg.reading.maxResponseEstimatedTokens = 4096;
  const complete = JSON.parse(cache.read(limited.nextCursor, 'page:fixture', cfg).text);
  expect(complete.links[0].url).toBe(url);
  expect(complete.hasMore).toBe(false);
});

test('源截断与分页分开，调整源上限不会改变旧快照', () => {
  const cfg = structuredClone(SURFING_DEFAULTS); cfg.reading.maxSourceChars = 12;
  const cache = new SnapshotCache();
  const source = '文字🌌。'.repeat(20);
  const cursor = cache.put(material([{ kind: 'text', text: source }]), cfg);
  cfg.reading.maxSourceChars = 300000;
  const page = JSON.parse(cache.read(cursor, 'page:fixture', cfg).text);
  expect(page.content).toBe([...source].slice(0,12).join(''));
  expect(page.hasMore).toBe(false);
  expect(page.sourceTruncated).toBe(true);
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

test('相同预算重读一致，含字幕时间范围的回执仍不超限', () => {
  const cfg = structuredClone(SURFING_DEFAULTS); cfg.reading.maxResponseEstimatedTokens = 1024;
  const cache = new SnapshotCache();
  const cursor = cache.put(material(Array.from({length:30},(_,index)=>({ kind: 'text', text: '句段。'.repeat(100),
    startSec:index*30+0.12345, endSec:index*30+29.12345 }))), cfg);
  const first = cache.read(cursor, 'page:fixture', cfg).text;
  expect(cache.read(cursor, 'page:fixture', cfg).text).toBe(first);
  expect(JSON.parse(first).timeRange.fromSec).toBe(0.12345);
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
  expect(JSON.parse(cache.read(first,'one',cfg).text).content).toBe('a'.repeat(2000));
});

test('远端搜索页由游标指向，重读使用同一份已取得的下一页', () => {
  const cfg = structuredClone(SURFING_DEFAULTS);
  const cache = new SnapshotCache();
  const first = cache.put({...material([{kind:'result',value:{title:'甲',url:'https://example.org/a'}}],'search:词'),kind:'search',nextSearchPage:2},cfg);
  const result = JSON.parse(cache.read(first,'search:词',cfg).text);
  expect(result.hasMore).toBe(true);
  expect(cache.nextSearch(result.nextCursor,'search:词',cfg)).toEqual({page:2,cursor:undefined});
  const second = cache.put({...material([{kind:'result',value:{title:'乙',url:'https://example.org/b'}}],'search:词'),kind:'search'},cfg);
  cache.rememberSearchNext(result.nextCursor,second);
  expect(cache.nextSearch(result.nextCursor,'search:词',cfg)?.cursor).toBe(second);
});

test.each([1024,2048,4096,32768])('预算 %i 包含长标题、目录与混合 Unicode', cap => {
  const cfg = structuredClone(SURFING_DEFAULTS); cfg.reading.maxResponseEstimatedTokens = cap;
  const source = material([{kind:'text',text:'🌌文字\"\\\n\t'.repeat(10000)}]);
  source.title = '标题'.repeat(3000);
  source.outline = Array.from({length:50},(_,i)=>({text:'章节'+i,url:'https://example.org/article#section'+i}));
  const cache = new SnapshotCache(); let cursor: string|null = cache.put(source,cfg);
  let restored = '';
  while(cursor) {
    const page = cache.read(cursor,source.key,cfg);
    expect(estimateTokens(page.text)).toBeLessThanOrEqual(cap);
    const parsed = JSON.parse(page.text); restored += parsed.content; cursor = parsed.nextCursor;
  }
  expect(restored).toBe(source.units[0].kind==='text' ? source.units[0].text : '');
});

test('目录纳入源字符上限，并标明无法显示完整目录', () => {
  const cfg = structuredClone(SURFING_DEFAULTS); cfg.reading.maxSourceChars = 60;
  const source = material([{kind:'text',text:'正文。'}]);
  source.outline = Array.from({length:70},(_,index)=>({text:'章节'+index,url:'https://example.org/#'+index}));
  const cache = new SnapshotCache();
  const result = JSON.parse(cache.read(cache.put(source,cfg),source.key,cfg).text);
  expect(result.sourceTruncated).toBe(true);
  expect(result.outlinePartial).toBe(true);
});

test('搜索词身份不裁切，其他显示字段裁切时明确列出', () => {
  const cfg = structuredClone(SURFING_DEFAULTS); const source = material([{kind:'text',text:'原文。'}]);
  source.title = '长标题'.repeat(200); source.scope = {kind:'video-search',query:'查询'.repeat(100),part:'分P标题'.repeat(100)};
  const cache = new SnapshotCache(); const result = JSON.parse(cache.read(cache.put(source,cfg),source.key,cfg).text);
  expect(result.scope.query).toBe(source.scope.query);
  expect(result.metadataTruncated).toEqual(['title','scope.part']);
});
