import { ReadError, validatePublicUrl, type ReadOperation } from './network.ts';

export class MicrolinkRenderer {
  constructor(private readonly apiKey: () => string = () => '') {}

  async render(input: string, operation: ReadOperation, maxBytes: number): Promise<{ html: string; url: string }> {
    const target = validatePublicUrl(input);
    const key = this.apiKey().trim();
    const endpoint = new URL(key ? 'https://pro.microlink.io/' : 'https://api.microlink.io/');
    endpoint.search = new URLSearchParams({ url: target.href, 'data.html.attr': 'html', meta: 'false', prerender: 'true' }).toString();
    const response = await operation.get(endpoint.href, {
      headers: key ? { 'x-api-key': key } : undefined,
      allowHost: hostname => hostname === endpoint.hostname,
    });
    if (response.status === 429) throw new ReadError('access_denied', 'Microlink 请求额度已用完或请求过于频繁，请等待额度重置或检查套餐。');
    if (response.status === 401 || response.status === 403)
      throw new ReadError('access_denied', 'Microlink 未允许本次读取，请检查可选 API Key 和访问权限。');
    if (response.status !== 200) throw new ReadError('network_error', `Microlink 读取失败（HTTP ${response.status}）。`);
    let result: { status?: string; code?: string; statusCode?: number; data?: { html?: string; url?: string } };
    try { result = JSON.parse(response.body.toString('utf8')); }
    catch { throw new ReadError('protocol_error', 'Microlink 未返回有效 JSON。'); }
    if (result?.status !== 'success') {
      if (result?.code === 'EPROXYNEEDED') throw new ReadError('access_denied', '该网页需要 Microlink 代理，请配置 API Key 后重试。');
      throw new ReadError('content_unavailable', 'Microlink 未取得渲染后的网页。');
    }
    if (result.statusCode !== 200)
      throw new ReadError(result.statusCode === 404 ? 'not_found' : 'access_denied', '网页未允许本次 Microlink 公开读取。');
    if (typeof result.data?.html !== 'string' || typeof result.data.url !== 'string')
      throw new ReadError('protocol_error', 'Microlink 响应缺少 HTML 或最终网页地址。');
    if (Buffer.byteLength(result.data.html) > maxBytes) throw new ReadError('source_limit', '渲染后的 HTML 超出单次读取上限。');
    const url = validatePublicUrl(result.data.url);
    if (!url.hash) url.hash = target.hash;
    return { html: result.data.html, url: url.href };
  }
}
