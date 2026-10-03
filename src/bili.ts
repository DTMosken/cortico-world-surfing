import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { SURFING_DEFAULTS, type SurfingConfigSection } from './config.ts';
import { BiliLogin } from './bili-login.ts';
import { ReadError, validatePublicUrl, type ReadOperation } from './network.ts';
import type { Material, Unit } from './snapshots.ts';

const MIXIN_ORDER = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
const API = 'https://api.bilibili.com';
const videoHosts = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com']);
export interface BiliInput { bvid?: string; aid?: number; cid?: number; url?: string }
interface WbiImages { img_url: string; sub_url: string }
interface Part { cid: number; page: number; part: string; duration: number }
class SessionExpired extends ReadError { constructor() { super('access_denied', 'B站登录态已失效。'); } }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReadError('protocol_error', '平台响应格式发生变化。');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new ReadError('protocol_error', '平台响应缺少文本字段。');
  return value;
}
function id(value: unknown, name: string, kind: 'invalid_input' | 'protocol_error' = 'invalid_input'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new ReadError(kind, `${name} 必须为正整数。`);
  return value;
}
export function validateBiliInput(input: BiliInput): void {
  if (input.bvid === undefined && input.aid === undefined && input.url === undefined)
    throw new ReadError('invalid_input', '提供 BV、aid 或视频 URL 即可读取；cid 不能单独定位稿件。');
  if (input.bvid !== undefined && (typeof input.bvid !== 'string' || !/^BV[0-9A-Za-z]{10}$/.test(input.bvid)))
    throw new ReadError('invalid_input', 'BV号格式无效。');
  if (input.aid !== undefined) id(input.aid, 'aid');
  if (input.cid !== undefined) id(input.cid, 'cid');
  if (input.url !== undefined) {
    const url = validatePublicUrl(input.url);
    if (!(videoHosts.has(url.hostname) || url.hostname === 'b23.tv')) throw new ReadError('invalid_input', '需要 B站视频链接或 b23.tv 短链。');
  }
}
export function biliKey(input: BiliInput): string {
  validateBiliInput(input);
  return 'bili:' + JSON.stringify({ bvid: input.bvid, aid: input.aid, cid: input.cid,
    url: input.url === undefined ? undefined : validatePublicUrl(input.url).href });
}

export function signWbi(params: Record<string, string | number>, images: WbiImages, timestamp = Math.floor(Date.now() / 1000)): string {
  const key = (value: string) => new URL(value).pathname.split('/').at(-1)!.split('.')[0];
  const raw = key(images.img_url) + key(images.sub_url);
  if (raw.length !== 64) throw new ReadError('protocol_error', '公开签名信息格式发生变化。');
  const mixin = MIXIN_ORDER.map(index => raw[index]).join('').slice(0, 32);
  const values: Record<string, string | number> = { ...params, wts: timestamp };
  const query = Object.keys(values).sort().map(name => encodeURIComponent(name) + '='
    + encodeURIComponent(String(values[name]).replace(/[!'()*]/g, ''))).join('&');
  return query + '&w_rid=' + createHash('md5').update(query + mixin).digest('hex');
}

export class BiliClient {
  private wbi?: { images: WbiImages; expiresAtMs: number };
  constructor(private readonly login?: BiliLogin) {}

  private async withLogin<T>(operation: ReadOperation, read: (cookie?: string) => Promise<T>): Promise<T> {
    const cookie = await this.login?.cookie(operation);
    try { return await read(cookie); }
    catch (error) {
      if (!(error instanceof SessionExpired) || !this.login) throw error;
      this.login.expire(cookie);
      return read(await this.login.cookie(operation));
    }
  }

  private async json(operation: ReadOperation, url: string, allowHost: (host: string) => boolean, checkCode = true, cookie?: string): Promise<Record<string, unknown>> {
    const response = await operation.get(url, { allowHost, headers: { referer: 'https://www.bilibili.com/' }, biliCookie: cookie });
    if (response.status === 404) throw new ReadError('not_found', '视频或字幕不存在。');
    if (response.status !== 200) throw new ReadError('access_denied', `B站读取请求失败（HTTP ${response.status}）。`);
    let result: Record<string, unknown>;
    try { result = object(JSON.parse(response.body.toString('utf8'))); }
    catch { throw new ReadError('protocol_error', '平台返回了无法解析的响应。'); }
    if (result.code !== undefined && !Number.isInteger(result.code)) throw new ReadError('protocol_error', '平台响应代码格式发生变化。');
    if (checkCode && result.code !== undefined && result.code !== 0) {
      if (result.code === -101 && cookie) throw new SessionExpired();
      if (result.code === -404 || result.code === 62002) throw new ReadError('not_found', '视频不存在或不可公开访问。');
      throw new ReadError('access_denied', `B站未允许本次读取（代码 ${result.code}）。`);
    }
    return result;
  }

  private async signed(operation: ReadOperation, path: string, params: Record<string, string | number>, cookie?: string): Promise<string> {
    if (!this.wbi || this.wbi.expiresAtMs < Date.now()) {
      const nav = await this.json(operation, API + '/x/web-interface/nav', host => host === 'api.bilibili.com', false, cookie);
      const images = object(object(nav.data).wbi_img);
      this.wbi = { images: { img_url: text(images.img_url), sub_url: text(images.sub_url) }, expiresAtMs: Date.now() + 3600000 };
    }
    return API + path + '?' + signWbi(params, this.wbi.images);
  }

  async read(input: BiliInput, operation: ReadOperation, groupSec: number,
    retry: Pick<SurfingConfigSection['bili'], 'maxSubtitleRetries' | 'subtitleRetryDelayMs'> = SURFING_DEFAULTS.bili): Promise<Material> {
    validateBiliInput(input);
    return this.withLogin(operation, cookie => this.readVideo(input, operation, groupSec, retry, cookie));
  }

  private async readVideo(input: BiliInput, operation: ReadOperation, groupSec: number,
    retry: Pick<SurfingConfigSection['bili'], 'maxSubtitleRetries' | 'subtitleRetryDelayMs'>, cookie?: string): Promise<Material> {
    validateBiliInput(input);
    let bvid = input.bvid, aid = input.aid;
    let requestedPage: number | undefined;
    if (input.url) {
      let url = validatePublicUrl(input.url);
      if (url.hostname === 'b23.tv') {
        const response = await operation.get(url.href, { allowHost: host => videoHosts.has(host) || host === 'b23.tv' });
        url = validatePublicUrl(response.url);
      }
      if (!videoHosts.has(url.hostname)) throw new ReadError('invalid_input', '短链没有指向 B站视频。');
      const match = url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10}|av\d+)\/?$/);
      if (!match) throw new ReadError('invalid_input', '该 B站链接不是可读取的视频地址。');
      if (match[1].startsWith('BV')) {
        if (bvid && bvid !== match[1]) throw new ReadError('invalid_input', 'BV号与 URL 指向不同视频。');
        bvid = match[1];
      } else {
        const parsedAid = id(Number(match[1].slice(2)), 'URL 中的 aid');
        if (aid && aid !== parsedAid) throw new ReadError('invalid_input', 'aid 与 URL 指向不同视频。');
        aid = parsedAid;
      }
      const page = url.searchParams.get('p');
      if (page !== null) {
        if (!/^\d+$/.test(page) || url.searchParams.getAll('p').length !== 1) throw new ReadError('invalid_input', '分P编号无效。');
        requestedPage = id(Number(page), '分P编号');
      }
    }
    const params: Record<string, string | number> = bvid ? { bvid } : { aid: aid! };
    const result = await this.json(operation, await this.signed(operation, '/x/web-interface/wbi/view', params, cookie), host => host === 'api.bilibili.com', true, cookie);
    const metadata = object(result.data);
    const actualAid = id(metadata.aid, 'aid', 'protocol_error');
    const actualBvid = text(metadata.bvid);
    if (!/^BV[0-9A-Za-z]{10}$/.test(actualBvid)) throw new ReadError('protocol_error', '平台响应缺少有效 BV号。');
    if ((aid && aid !== actualAid) || (bvid && bvid !== actualBvid)) throw new ReadError('invalid_input', '提供的稿件标识不一致。');
    if (!Array.isArray(metadata.pages)) throw new ReadError('protocol_error', '平台没有返回分P目录。');
    const parts: Part[] = metadata.pages.map((value: unknown) => {
      const part = object(value);
      if (typeof part.duration !== 'number' || !Number.isFinite(part.duration) || part.duration < 0)
        throw new ReadError('protocol_error', '平台返回的分P时长无效。');
      return { cid: id(part.cid, 'cid', 'protocol_error'), page: id(part.page, 'page', 'protocol_error'),
        part: text(part.part), duration: part.duration };
    });
    const selected = input.cid ? parts.find(part => part.cid === input.cid) : parts.find(part => part.page === (requestedPage ?? 1));
    if (!selected) throw new ReadError('not_found', '指定的分P不存在。');
    if (requestedPage && selected.page !== requestedPage) throw new ReadError('invalid_input', 'cid 与 URL 的分P编号不一致。');
    let track: SubtitleTrack | undefined;
    let segments: Array<{ from: number; to: number; content: string }> = [];
    for (let attempt = 0; attempt <= retry.maxSubtitleRetries; attempt++) {
      if (attempt) await delay(retry.subtitleRetryDelayMs * 2 ** (attempt - 1), undefined, { signal: operation.signal });
      operation.signal.throwIfAborted();
      const tracks = await this.subtitleTracks(operation, actualBvid, actualAid, selected, cookie);
      track = tracks.find(item => item.language === 'zh-Hans') ?? tracks.find(item => item.language === 'ai-zh') ?? tracks[0];
      if (!track) continue;
      const subtitle = await this.json(operation, resolveSubtitleUrl(track.url), host => host.endsWith('.hdslb.com'));
      if (!Array.isArray(subtitle.body)) throw new ReadError('protocol_error', '字幕正文格式发生变化。');
      segments = subtitle.body.map((value: unknown) => {
        const line = object(value);
        if (typeof line.from !== 'number' || typeof line.to !== 'number' || !Number.isFinite(line.from)
          || !Number.isFinite(line.to) || line.from < 0 || line.to < line.from)
          throw new ReadError('protocol_error', '字幕时间范围无效。');
        return { from: Number(line.from), to: Number(line.to), content: text(line.content) };
      }).filter(line => line.content.trim());
      if (segments.length) break;
    }
    if (!segments.length || !track) throw new ReadError('no_subtitle', `本次未取得 P${selected.page} 字幕（已尝试${retry.maxSubtitleRetries + 1}次）。`);
    const groups: Array<{ from: number; to: number; texts: string[] }> = [];
    for (const line of segments) {
      let group = groups.at(-1);
      if (!group || line.from - group.from >= groupSec) { group = { from: line.from, to: line.to, texts: [] }; groups.push(group); }
      group.to = Math.max(group.to,line.to);
      group.texts.push(line.content);
    }
    const clock = (sec: number) => Math.floor(sec / 60).toString().padStart(2, '0') + ':' + Math.floor(sec % 60).toString().padStart(2, '0');
    const units: Unit[] = groups.map(group => ({ kind: 'text', startSec: group.from, endSec: group.to,
      text: `[${clock(group.from)}–${clock(group.to)}] ${group.texts.join(' ')}\n\n` }));
    if (parts.length > 1) for (const part of parts) units.push({ kind: 'part', value: { page: part.page, cid: part.cid, title: part.part } });
    return { kind: 'bili', key: biliKey(input), source: `https://www.bilibili.com/video/${actualBvid}/?p=${selected.page}`,
      title: text(metadata.title), units, sentenceTimes: segments.map(({ from, to }) => ({ from, to })),
      scope: { kind: 'video-part', bvid: actualBvid, aid: actualAid, cid: selected.cid, page: selected.page,
        part: selected.part, author: text(object(metadata.owner).name), language: track.language, isAi: track.language.startsWith('ai-'),
        durationSec: selected.duration, subtitleGroupSec: groupSec } };
  }

  private async subtitleTracks(operation: ReadOperation, bvid: string, aid: number, part: Part, cookie?: string): Promise<SubtitleTrack[]> {
    if (cookie) {
      const result = await this.json(operation, await this.signed(operation, '/x/player/wbi/v2', { bvid, cid: part.cid }, cookie),
        host => host === 'api.bilibili.com', true, cookie);
      const entries = object(object(result.data).subtitle).subtitles;
      if (!Array.isArray(entries)) throw new ReadError('protocol_error', '播放器字幕响应格式发生变化。');
      const tracks = entries.map(value => {
        const entry = object(value);
        return { language: text(entry.lan), label: text(entry.lan_doc), url: text(entry.subtitle_url) };
      });
      if (tracks.length) return tracks;
    }
    const nativeUrl = await this.signed(operation, '/x/v2/subtitle/web/view', {
      oid: part.cid, pid: aid, context_ext: JSON.stringify({ video_type: 1 }),
      type: 1, cur_production_type: 0, preferred_language: 'ai-zh', playlist_switch: 0,
    }, cookie);
    const response = await operation.get(nativeUrl, { allowHost: host => host === 'api.bilibili.com', biliCookie: cookie,
      headers: { referer: `https://www.bilibili.com/video/${bvid}/?p=${part.page}` } });
    if (response.status !== 200) throw new ReadError('access_denied', `B站字幕请求失败（HTTP ${response.status}）。`);
    if (response.body.toString('utf8').trimStart().startsWith('{')) {
      let result: Record<string, unknown>;
      try { result = object(JSON.parse(response.body.toString('utf8'))); }
      catch { throw new ReadError('protocol_error', '平台返回了无法解析的字幕响应。'); }
      if (result.code !== undefined && !Number.isInteger(result.code)) throw new ReadError('protocol_error', '字幕响应代码格式发生变化。');
      if (result.code === -101 && cookie) throw new SessionExpired();
      if (result.code !== undefined && result.code !== 0) throw new ReadError('access_denied', `B站未允许本次字幕读取（代码 ${result.code}）。`);
      throw new ReadError('protocol_error', '原生字幕响应格式发生变化。');
    }
    return parseSubtitleTracks(response.body);
  }

  async search(query: string, page: number, operation: ReadOperation): Promise<Material> {
    if (typeof query !== 'string' || !query.trim() || [...query].length > 240) throw new ReadError('invalid_input', '搜索词需为1–240字符。');
    return this.withLogin(operation, cookie => this.searchVideos(query, page, operation, cookie));
  }

  private async searchVideos(query: string, page: number, operation: ReadOperation, cookie?: string): Promise<Material> {
    const url = await this.signed(operation, '/x/web-interface/wbi/search/type', { keyword: query, search_type: 'video', page, page_size: 20 }, cookie);
    const result = await this.json(operation, url, host => host === 'api.bilibili.com', true, cookie);
    const data = object(result.data);
    if (!Array.isArray(data.result)) throw new ReadError('protocol_error', '视频搜索响应格式发生变化。');
    const dom = new JSDOM('<!doctype html><body></body>');
    const decodeTitle = (title: string) => { dom.window.document.body.innerHTML = title; return dom.window.document.body.textContent ?? ''; };
    try {
      const units: Unit[] = data.result.map((entry: unknown) => {
        const video = object(entry);
        const bvid = text(video.bvid);
        if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new ReadError('protocol_error', '搜索结果缺少可用 BV号。');
        return { kind: 'result', value: { bvid, aid: id(video.aid, 'aid', 'protocol_error'), title: decodeTitle(text(video.title)),
          author: text(video.author), duration: text(video.duration) } };
      });
      const totalPages = Number(data.numPages ?? data.num_pages ?? 1);
      return { kind: 'search', key: 'search:' + query, source: 'https://search.bilibili.com/all?keyword=' + encodeURIComponent(query),
        title: 'B站视频搜索', scope: { kind: 'video-search', query, page }, units,
        nextSearchPage: units.length && Number.isSafeInteger(totalPages) && page < totalPages ? page + 1 : undefined };
    } finally { dom.window.close(); }
  }
}

/** Independent protobuf reader; protocol facts and URL constants follow the Bilibili web player. */

const URL_KEYS = [
  ['nP](wOFRvU.+<fjS{jn-!$D|Dz&",zT`', '=CFxYRn{.y|uVyO$uh&sikph?N.ilF/`'],
  ['Bn"q~|albg@]Go~ACgyDvKnd+)_D}^&J?', "Cu~L!xs~f^&r@'vh=q]q{eeng*sEg^kp#J"],
];

interface Field { number: number; value: bigint | Uint8Array }
export interface SubtitleTrack { language: string; label: string; url: string }

function fields(bytes: Uint8Array): Field[] {
  let offset = 0;
  const result: Field[] = [];
  const integer = () => {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (offset >= bytes.length) throw new ReadError('protocol_error', '字幕二进制响应不完整。');
      const byte = bytes[offset++];
      value |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) return value;
    }
    throw new ReadError('protocol_error', '字幕二进制数值超出范围。');
  };
  while (offset < bytes.length) {
    const tag = integer();
    if (tag > 0xffffffffn || tag < 8n) throw new ReadError('protocol_error', '字幕二进制字段无效。');
    const number = Number(tag) >>> 3, wire = Number(tag) & 7;
    if (wire === 0) result.push({ number, value: integer() });
    else if ([1, 2, 5].includes(wire)) {
      const length = wire === 2 ? Number(integer()) : wire === 1 ? 8 : 4;
      if (!Number.isSafeInteger(length) || length < 0 || length > bytes.length - offset)
        throw new ReadError('protocol_error', '字幕二进制字段不完整。');
      result.push({ number, value: bytes.subarray(offset, offset + length) });
      offset += length;
    } else throw new ReadError('protocol_error', '字幕二进制格式发生变化。');
  }
  return result;
}

export function parseSubtitleTracks(bytes: Uint8Array): SubtitleTrack[] {
  const data = fields(bytes).find(field => field.number === 1 && field.value instanceof Uint8Array);
  if (!data || !(data.value instanceof Uint8Array)) throw new ReadError('protocol_error', '字幕响应缺少数据字段。');
  return fields(data.value).filter(field => field.number === 3).map(field => {
    if (!(field.value instanceof Uint8Array)) throw new ReadError('protocol_error','字幕轨道字段格式发生变化。');
    const entries = fields(field.value);
    const text = (number: number) => {
      const value = entries.find(entry => entry.number === number && entry.value instanceof Uint8Array)?.value;
      try { return value instanceof Uint8Array ? new TextDecoder('utf-8', { fatal: true }).decode(value) : ''; }
      catch { throw new ReadError('protocol_error', '字幕轨道包含无效文本。'); }
    };
    const track = { language: text(3), label: text(4), url: text(5) };
    if (!track.language || !track.url) throw new ReadError('protocol_error','字幕轨道缺少语言或正文地址。');
    return track;
  });
}

export function resolveSubtitleUrl(input: string): string {
  try {
    let url = new URL(input, 'https://www.bilibili.com/');
    if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error();
    if (url.hostname === 'subtitle.bilibili.com') {
      const encoded = decodeURIComponent(url.pathname.slice(1));
      let path: string | undefined;
      for (const [prefix, suffix] of URL_KEYS) {
        const key = suffix + 'bilibili';
        const decoded = [...encoded].map((character, index) =>
          String.fromCharCode(character.charCodeAt(0) ^ key.charCodeAt(index % key.length))).join('');
        if (decoded.startsWith(prefix)) { path = decoded.slice(prefix.length); break; }
      }
      if (!path?.startsWith('/') || path.startsWith('//')) throw new Error();
      url = new URL('https://aisubtitle.hdslb.com' + path + url.search);
    }
    if (!(url.hostname.endsWith('.hdslb.com')) || url.protocol !== 'https:') throw new Error();
    return url.href;
  } catch { throw new ReadError('protocol_error', '字幕正文地址格式不受支持。'); }
}
