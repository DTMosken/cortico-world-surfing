/** Independent protobuf reader; protocol facts and URL constants follow the Bilibili web player. */
import { ReadError } from './errors.ts';

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
