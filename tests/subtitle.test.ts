import { expect, test } from 'vitest';
import { parseSubtitleTracks, resolveSubtitleUrl } from '../src/subtitle.ts';

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
