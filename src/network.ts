/** Public DNS results are pinned to each socket; redirects repeat the same checks. */
import { lookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { createGunzip, createInflate, createBrotliDecompress } from 'node:zlib';
import ipaddr from 'ipaddr.js';
import { ReadError, asReadError } from './errors.ts';

export interface NetworkLimits { requestTimeoutMs: number; maxDownloadBytes: number }
export interface Address { address: string; family: number }
export type Resolver = (hostname: string) => Promise<Address[]>;
export interface PublicResponse { url: string; status: number; headers: Record<string, string>; body: Buffer }
export interface GetOptions { headers?: Record<string, string>; allowHost?: (hostname: string) => boolean; followRedirects?: boolean }
export interface ReadOperation {
  readonly signal: AbortSignal;
  readonly downloadedBytes: number;
  get(url: string, options?: GetOptions): Promise<PublicResponse>;
  close(): void;
}

export function validatePublicUrl(input: string): URL {
  if (typeof input !== 'string' || input.length > 8192) throw new ReadError('invalid_input', 'URL 为空或过长。');
  let url: URL;
  try { url = new URL(input); } catch { throw new ReadError('invalid_input', '需要完整的 HTTP(S) URL。'); }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || isIP(hostname.replace(/^\[|\]$/g, '')) || !hostname.includes('.')
    || /(^|\.)(localhost|local|localdomain|internal|lan|home|onion)$/.test(hostname))
    throw new ReadError('address_denied', '只允许公开域名，不能读取本地、IP 或带账号信息的地址。');
  url.hostname = hostname;
  return url;
}

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    if (parsed.range() !== 'unicast') return false;
    return parsed.kind() === 'ipv4' || parsed.match(ipaddr.parse('2000::'), 3);
  } catch { return false; }
}

function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function responseHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
    .filter(([key]) => key !== 'set-cookie')
    .map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]));
}

export class PublicClient {
  constructor(private readonly resolve: Resolver = hostname => lookup(hostname, { all: true, verbatim: true })) {}

  operation(limits: NetworkLimits, parent?: AbortSignal): ReadOperation {
    return new Operation(this.resolve, limits, parent);
  }
}

class Operation implements ReadOperation {
  private readonly controller = new AbortController();
  readonly signal: AbortSignal;
  downloadedBytes = 0;

  constructor(private readonly resolve: Resolver, private readonly limits: NetworkLimits, parent?: AbortSignal) {
    this.signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(limits.requestTimeoutMs), ...(parent ? [parent] : [])]);
  }

  close(): void { this.controller.abort(); }

  async get(input: string, options: GetOptions = {}): Promise<PublicResponse> {
    try {
      let url = validatePublicUrl(input);
      for (let hops = 0; hops <= 5; hops++) {
        this.signal.throwIfAborted();
        if (options.allowHost && !options.allowHost(url.hostname)) throw new ReadError('address_denied', '目标站点不在本次读取范围内。');
        const addresses = await withSignal(this.resolve(url.hostname), this.signal);
        if (!addresses.length || addresses.some(a => !isPublicAddress(a.address)))
          throw new ReadError('address_denied', '域名未解析到允许的公网地址。');
        const selected = addresses.find(a => a.family === 4) ?? addresses[0];
        const response = await this.request(url, selected, options);
        if (![301, 302, 303, 307, 308].includes(response.status) || options.followRedirects === false) return response;
        if (!response.headers.location) throw new ReadError('protocol_error', '重定向缺少目标地址。');
        if (hops === 5) throw new ReadError('access_denied', '重定向次数超出限制。');
        url = validatePublicUrl(new URL(response.headers.location, url).href);
      }
      throw new ReadError('access_denied', '重定向次数超出限制。');
    } catch (error) { throw asReadError(error); }
  }

  private request(url: URL, selected: Address, options: GetOptions): Promise<PublicResponse> {
    const headers: Record<string, string> = {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      'accept-encoding': 'gzip, deflate, br',
    };
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      if (['accept', 'accept-language', 'referer', 'user-agent'].includes(key.toLowerCase())) headers[key.toLowerCase()] = value;
    }
    return new Promise((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        method: 'GET', headers, agent: false, signal: this.signal, family: selected.family,
        lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
      }, response => {
        const status = response.statusCode ?? 0;
        const normalized = responseHeaders(response.headers);
        if ([301, 302, 303, 307, 308].includes(status)) {
          response.destroy();
          resolve({ url: url.href, status, headers: normalized, body: Buffer.alloc(0) });
          return;
        }
        const encoding = normalized['content-encoding']?.toLowerCase();
        const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'deflate' ? createInflate()
          : encoding === 'br' ? createBrotliDecompress() : null;
        if (encoding && encoding !== 'identity' && !decoder) {
          response.destroy();
          reject(new ReadError('protocol_error', '不支持的响应压缩格式。'));
          return;
        }
        if (decoder) response.on('error', error => decoder.destroy(error));
        const stream = decoder ? response.pipe(decoder) : response;
        void (async () => {
          const chunks: Buffer[] = [];
          try {
            for await (const value of stream) {
              const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
              this.downloadedBytes += chunk.length;
              if (this.downloadedBytes > this.limits.maxDownloadBytes)
                throw new ReadError('source_limit', '单次读取的下载量已触及配置上限。');
              chunks.push(chunk);
            }
            delete normalized['content-encoding'];
            delete normalized['content-length'];
            delete normalized['transfer-encoding'];
            resolve({ url: url.href, status, headers: normalized, body: Buffer.concat(chunks) });
          } catch (error) { request.destroy(); response.destroy(); decoder?.destroy(); reject(error); }
        })();
      });
      request.on('socket', socket => socket.once('connect', () => {
        const peer = socket.remoteAddress;
        if (!peer || ipaddr.process(peer).toString() !== ipaddr.process(selected.address).toString())
          request.destroy(new ReadError('address_denied', '实际连接地址与已核验地址不一致。'));
      }));
      request.on('error', reject);
      request.end();
    });
  }
}
