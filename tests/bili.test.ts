import { expect, test } from 'vitest';
import { BiliClient, biliKey, parseSubtitleTracks, resolveSubtitleUrl } from '../src/bili.ts';
import { PlatformFixture } from './platform-fixture.ts';

test('未登录 nav 仍能取得原生字幕并保留后文、分P与来源', async () => {
  const result = await new BiliClient().read({bvid:'BV1aa411a7aa'},new PlatformFixture(),30);
  expect(result.scope).toMatchObject({aid:100,cid:200,page:1,language:'ai-zh',isAi:true});
  expect(result.units.filter(x=>x.kind==='text').map(x=>x.text).join('')).toContain('末尾结论。');
  expect(result.units.filter(x=>x.kind==='part')).toHaveLength(2);
  expect(result.sentenceTimes).toEqual([{from:0,to:1},{from:31,to:32}]);
});

test('原生空轨道只重试一次，仍为空则报告未提供字幕', async () => {
  const fixture = new PlatformFixture(); fixture.emptyResponses = Infinity;
  await expect(new BiliClient().read({bvid:'BV1aa411a7aa'},fixture,30)).rejects.toMatchObject({kind:'no_subtitle'});
  expect(fixture.nativeRequests).toBe(2);
});

test('原生暂时空轨道可在一次重试后取得正文', async () => {
  const fixture = new PlatformFixture(); fixture.emptyResponses = 1;
  const result = await new BiliClient().read({bvid:'BV1aa411a7aa'},fixture,30);
  expect(result.units.filter(x=>x.kind==='text').map(x=>x.text).join('')).toContain('开头。');
  expect(fixture.nativeRequests).toBe(2);
});

test.each([{bvid:'BV1aa411a7aa',cid:201},{aid:100,cid:201},{url:'https://www.bilibili.com/video/BV1aa411a7aa/?p=2'},{url:'https://b23.tv/short'}])('指定分P与短链均使用所选正文 %j', async input => {
  const fixture = new PlatformFixture(); fixture.manual = true;
  const result = await new BiliClient().read(input,fixture,30);
  expect(result.scope).toMatchObject({page:2,cid:201,isAi:false});
  expect(result.units.filter(x=>x.kind==='text').map(x=>x.text).join('')).toContain('附录说明。');
});

test.each([{bvid:'BV1aa411a7aa',aid:101},{cid:200},{url:'https://www.bilibili.com/read/cv1'},
  {bvid:'BV1aa411a7aa',cid:200,url:'https://www.bilibili.com/video/BV1aa411a7aa/?p=2'},
  {url:'https://www.bilibili.com/video/BV1aa411a7aa/?p=1&p=2'}])('拒绝身份冲突或不能定位视频的参数 %j', async input => {
  await expect(new BiliClient().read(input,new PlatformFixture(),30)).rejects.toMatchObject({kind:'invalid_input'});
});

test('协议变化与匿名拒绝采用不同状态', async () => {
  for (const [body,kind] of [[{code:0,data:{}},'protocol_error'],[{code:-101},'access_denied']] as const) {
    const fixture = new PlatformFixture(); fixture.nativeJson = body;
    await expect(new BiliClient().read({bvid:'BV1aa411a7aa'},fixture,30)).rejects.toMatchObject({kind});
  }
});

test('搜索返回可交给读取工具的身份，并解码标题', async () => {
  const fixture = new PlatformFixture(); const client = new BiliClient();
  const first = await client.search('竞赛',1,fixture);
  expect(first.nextSearchPage).toBe(2);
  expect(first.units[0]).toMatchObject({kind:'result',value:{bvid:'BV1aa411a7aa',title:'第1页 比赛 & 说明'}});
  const second = await client.search('竞赛',2,fixture);
  expect(second.nextSearchPage).toBeUndefined();
  expect(()=>biliKey({bvid:'BV1aa411a7aa'})).not.toThrow();
});

test.each([[0],[10,255],[10,1,31],[10,2,26,255]].map(bytes=>({bytes})))('损坏的 protobuf 不当作无字幕 %j', ({bytes}) => {
  expect(()=>parseSubtitleTracks(Uint8Array.from(bytes))).toThrowError(expect.objectContaining({kind:'protocol_error'}));
});

test('未知字段可跳过，轨道包含无效 UTF-8 时拒绝', () => {
  expect(parseSubtitleTracks(Uint8Array.from([8,0,10,2,8,0]))).toEqual([]);
  expect(()=>parseSubtitleTracks(Uint8Array.from([10,7,26,5,26,1,255,40,0]))).toThrow(/无效文本/);
});

test('字幕正文仅接受 HTTPS 的字幕 CDN，异常地址保留为协议错误', () => {
  expect(resolveSubtitleUrl('//aisubtitle.hdslb.com/a.json')).toBe('https://aisubtitle.hdslb.com/a.json');
  for (const url of ['http://aisubtitle.hdslb.com/a.json','https://other.example.org/a.json','https://user:pass@aisubtitle.hdslb.com/a.json',
    'https://subtitle.bilibili.com/unknown','https://aisubtitle.hdslb.com:8443/a.json'])
    expect(()=>resolveSubtitleUrl(url)).toThrow(/地址/);
});

test('存在轨道但缺正文地址时报告协议错误，不能误报空轨道', () => {
  expect(()=>parseSubtitleTracks(Uint8Array.from([10,9,26,7,26,5,97,105,45,122,104])))
    .toThrowError(expect.objectContaining({kind:'protocol_error'}));
});
