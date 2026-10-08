import { expect, test } from 'vitest';
import { BiliClient, biliKey, parseSubtitleTracks, resolveSubtitleUrl } from '../src/bili.ts';
import { BiliLogin } from '../src/bili-login.ts';
import { SURFING_DEFAULTS } from '../src/config.ts';
import type { GetOptions, PublicResponse } from '../src/network.ts';
import { PlatformFixture } from './platform-fixture.ts';

test('未登录 nav 仍能取得原生字幕并保留后文、分P与来源', async () => {
  const result = await new BiliClient().read({bvid:'BV1aa411a7aa'},new PlatformFixture(),30);
  expect(result.scope).toMatchObject({aid:100,cid:200,page:1,language:'ai-zh',isAi:true});
  expect(result.units.filter(x=>x.kind==='text').map(x=>x.text).join('')).toContain('末尾结论。');
  expect(result.units.filter(x=>x.kind==='part')).toHaveLength(2);
  expect(result.sentenceTimes).toEqual([{from:0,to:1},{from:31,to:32}]);
});

test('原生空轨道按配置最多尝试三次，最终仅报告本次未取得字幕', async () => {
  const fixture = new PlatformFixture(); fixture.emptyResponses = Infinity;
  const retries = { ...SURFING_DEFAULTS.bili, subtitleRetryDelayMs: 100 };
  await expect(new BiliClient().read({bvid:'BV1aa411a7aa'},fixture,30,retries))
    .rejects.toMatchObject({kind:'no_subtitle', message: '本次未取得 P1 字幕（已尝试3次）。'});
  expect(fixture.nativeRequests).toBe(retries.maxSubtitleRetries + 1);
  expect(fixture.nativeAtMs[1]-fixture.nativeAtMs[0]).toBeGreaterThanOrEqual(retries.subtitleRetryDelayMs);
  expect(fixture.nativeAtMs[2]-fixture.nativeAtMs[1]).toBeGreaterThanOrEqual(retries.subtitleRetryDelayMs * 2);
});

test('原生暂时空轨道可在一次重试后取得正文', async () => {
  const fixture = new PlatformFixture(); fixture.emptyResponses = 1;
  const result = await new BiliClient().read({bvid:'BV1aa411a7aa'},fixture,30,{ ...SURFING_DEFAULTS.bili, subtitleRetryDelayMs: 100 });
  expect(result.units.filter(x=>x.kind==='text').map(x=>x.text).join('')).toContain('开头。');
  expect(fixture.nativeRequests).toBe(2);
});

test('关闭空字幕重试时只请求一次', async () => {
  const fixture = new PlatformFixture(); fixture.emptyResponses = Infinity;
  await expect(new BiliClient().read({bvid:'BV1aa411a7aa'},fixture,30,{ ...SURFING_DEFAULTS.bili, maxSubtitleRetries: 0 }))
    .rejects.toMatchObject({kind:'no_subtitle'});
  expect(fixture.nativeRequests).toBe(1);
});

test('轨道存在但正文暂为空时也重试并保留后来取得的原句', async () => {
  const fixture = new PlatformFixture(); fixture.emptySubtitleBodies = 2;
  const result = await new BiliClient().read({bvid:'BV1aa411a7aa'},fixture,30,{ ...SURFING_DEFAULTS.bili, subtitleRetryDelayMs: 100 });
  expect(result.units.some(unit=>unit.kind==='text'&&unit.text.includes('末尾结论。'))).toBe(true);
  expect(fixture.nativeRequests).toBe(3); expect(fixture.subtitleRequests).toBe(3);
});

test('明确拒绝和协议错误都不进行空字幕重试', async () => {
  for (const status of [403,429]) {
    const fixture = new PlatformFixture(); fixture.nativeStatus = status;
    await expect(new BiliClient().read({bvid:'BV1aa411a7aa'},fixture,30)).rejects.toMatchObject({kind:'access_denied'});
    expect(fixture.nativeRequests).toBe(1);
  }
  const fixture = new PlatformFixture(); fixture.nativeJson = {code:0,data:{}};
  await expect(new BiliClient().read({bvid:'BV1aa411a7aa'},fixture,30)).rejects.toMatchObject({kind:'protocol_error'});
  expect(fixture.nativeRequests).toBe(1);
});

test('重试等待响应同一次读取的超时，不发起后续请求', async () => {
  const fixture = new PlatformFixture(); fixture.emptyResponses = Infinity;
  Object.defineProperty(fixture,'signal',{value:AbortSignal.timeout(40)});
  await expect(new BiliClient().read({bvid:'BV1aa411a7aa'},fixture,30)).rejects.toMatchObject({name:'AbortError'});
  expect(fixture.nativeRequests).toBe(1);
});

test('登录后取得播放器字幕，凭证不传给字幕 CDN', async () => {
  const sessdata = 'fixture-session';
  const fixture = new PlatformFixture(); fixture.acceptedSession = sessdata; fixture.emptyResponses = Infinity;
  const login = new BiliLogin({secret:()=>JSON.stringify({SESSDATA:sessdata}),storeSecret:()=>{throw new Error('unexpected write');}});
  const result = await new BiliClient(login).read({bvid:'BV1aa411a7aa'},fixture,30);
  expect(result.units.some(unit=>unit.kind==='text'&&unit.text.includes('开头。'))).toBe(true);
  expect(fixture.nativeRequests).toBe(0);
  expect(login.state()).toMatchObject({kind:'logged_in',username:'测试用户'});
});

test('登录播放器轨道为空时，仍可通过原生接口取得字幕', async () => {
  const sessdata = 'fixture-session';
  const fixture = new PlatformFixture(); fixture.acceptedSession = sessdata; fixture.playerEmpty = true;
  const login = new BiliLogin({secret:()=>JSON.stringify({SESSDATA:sessdata}),storeSecret:()=>{throw new Error('unexpected write');}});
  const result = await new BiliClient(login).read({bvid:'BV1aa411a7aa'},fixture,30);
  expect(result.units.some(unit=>unit.kind==='text'&&unit.text.includes('开头。'))).toBe(true);
  expect(fixture.nativeRequests).toBe(1);
});

test('登录凭证失效时以匿名模式取得原生字幕', async () => {
  const fixture = new PlatformFixture(); fixture.acceptedSession = 'current-session';
  const login = new BiliLogin({secret:()=>JSON.stringify({SESSDATA:'expired-session'}),storeSecret:()=>{throw new Error('unexpected write');}});
  const result = await new BiliClient(login).read({bvid:'BV1aa411a7aa'},fixture,30);
  expect(result.units.some(unit=>unit.kind==='text'&&unit.text.includes('开头。'))).toBe(true);
  expect(login.state().kind).toBe('expired');
});

test('读取途中平台明确返回登录失效时，使用同一次操作匿名重读', async () => {
  class ExpiringFixture extends PlatformFixture {
    override async get(url: string, options: GetOptions = {}): Promise<PublicResponse> {
      if (new URL(url).pathname.endsWith('/wbi/view') && options.biliCookie)
        return {url,status:200,headers:{},body:Buffer.from('{"code":-101}')};
      return super.get(url, options);
    }
  }
  const sessdata = 'fixture-session';
  const fixture = new ExpiringFixture(); fixture.acceptedSession = sessdata;
  const login = new BiliLogin({secret:()=>JSON.stringify({SESSDATA:sessdata}),storeSecret:()=>{throw new Error('unexpected write');}});
  const result = await new BiliClient(login).read({bvid:'BV1aa411a7aa'},fixture,30);
  expect(result.units.some(unit=>unit.kind==='text'&&unit.text.includes('开头。'))).toBe(true);
  expect(login.state().kind).toBe('expired');
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
