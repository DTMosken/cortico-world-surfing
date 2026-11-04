import { expect, test } from 'vitest';
import { MicrolinkRenderer } from '../src/microlink.ts';
import { ReadError, requestHeaders, waitWithSignal, type ReadOperation } from '../src/network.ts';
import { fixtureOperation } from './browser-fixture.ts';
import { PageReader, Renderer } from '../src/page-reader.ts';

function serviceFixture(key = '', html = '<main><p>远程渲染的正文。</p></main>') {
  const operation = fixtureOperation('<main><p>Loading...</p></main><script src="/app.js"></script>');
  const get = operation.get.bind(operation);
  const requests: URL[] = [];
  operation.get = async (input, options) => {
    const url = new URL(input);
    if (!url.hostname.endsWith('.microlink.io')) return get(input, options);
    requests.push(url);
    const headers = requestHeaders(options ?? {});
    const authenticated = url.hostname === 'pro.microlink.io';
    if ((key && (!authenticated || headers['x-api-key'] !== key)) || (!key && (authenticated || headers['x-api-key'])))
      return { url: input, status: 401, headers: {}, body: Buffer.from('{}') };
    if (url.searchParams.has('apiKey') || url.searchParams.has('key') || url.searchParams.get('prerender') !== 'true')
      throw new Error('invalid render request');
    if (options?.allowHost?.('other.example.org') !== false) throw new Error('service credentials must stay at the API host');
    return { url: input, status: 200, headers: {}, body: Buffer.from(JSON.stringify({
      status: 'success', statusCode: 200, data: { html, url: 'https://example.org/docs/final' },
    })) };
  };
  return { operation, requests };
}
const unavailable = () => new Renderer(async () => { throw new Error('browser missing'); });
const body = (material: Awaited<ReturnType<PageReader['read']>>) => material.units.filter(unit => unit.kind === 'text').map(unit => unit.text).join('');

test.each(['', 'fixture-credential'])('Chromium 不可用时取得远程正文，保留章节和重定向链接 %s', async key => {
  const html = '<main><h2 id="section">本节</h2><p>远程渲染的正文。<a href="next">下一页</a></p><h2>后文</h2><p>其他章节。</p></main>';
  const { operation } = serviceFixture(key, html);
  const reader = new PageReader(unavailable(), new MicrolinkRenderer(() => key));
  try {
    const material = await reader.read('https://example.org/start#section', operation, 8 * 1024 * 1024);
    expect(body(material)).toContain('远程渲染的正文。');
    expect(body(material)).not.toContain('其他章节');
    expect(material.scope).toMatchObject({ kind: 'web-section', extraction: 'rendered-html', renderingProvider: 'microlink' });
    expect(material.key).toBe('page:https://example.org/start#section');
    expect(material.source).toBe('https://example.org/docs/final#section');
    expect(material.links).toEqual({ L1: 'https://example.org/docs/next' });
    if (key) expect(JSON.stringify(material)).not.toContain(key);
  } finally { operation.close(); await reader.stop(); }
});

test('静态正文可用时不请求 Microlink，也不读取可选密钥', async () => {
  const { operation, requests } = serviceFixture();
  const get = operation.get.bind(operation);
  operation.get = async (url, options) => new URL(url).hostname === 'example.org'
    ? { url, status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<main><p>静态正文。</p></main>') } : get(url, options);
  const reader = new PageReader(unavailable(), new MicrolinkRenderer(() => { throw new Error('unexpected key read'); }));
  try {
    expect(body(await reader.read('https://example.org/article', operation, 8192))).toContain('静态正文。');
    expect(requests).toHaveLength(0);
  } finally { operation.close(); await reader.stop(); }
});

test('本机 Chromium 取得动态正文时 Microlink 请求次数为零', async () => {
  const { operation, requests } = serviceFixture();
  const get = operation.get.bind(operation);
  operation.get = async (url, options) => new URL(url).hostname === 'example.org'
    ? { url, status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from('<main><p id="body"></p></main><script>document.querySelector("#body").textContent="本机动态正文。"</script>') } : get(url, options);
  const reader = new PageReader();
  try {
    const material = await reader.read('https://example.org/article', operation, 8192);
    expect(body(material)).toContain('本机动态正文。');
    expect(material.scope.renderingProvider).toBe('chromium');
    expect(requests).toHaveLength(0);
  } finally { operation.close(); await reader.stop(); }
});

test('Chromium 页面的拒绝访问不触发 Microlink，保留静态片段及失败原因', async () => {
  class DeniedRenderer extends Renderer {
    override async render(): Promise<{ html: string; url: string }> { throw new ReadError('access_denied', '页面拒绝渲染。'); }
  }
  const { operation, requests } = serviceFixture();
  const reader = new PageReader(new DeniedRenderer());
  try {
    const material = await reader.read('https://example.org/article', operation, 8192);
    expect(material.sourceTruncated).toBe(true);
    expect(material.scope.renderingReason).toBe('页面拒绝渲染。');
    expect(requests).toHaveLength(0);
  } finally { operation.close(); await reader.stop(); }
});

test('Microlink 额度耗尽时保留静态片段并说明原因', async () => {
  const { operation } = serviceFixture();
  const get = operation.get.bind(operation);
  operation.get = async (url, options) => new URL(url).hostname.endsWith('.microlink.io')
    ? { url, status: 429, headers: {}, body: Buffer.from('{}') } : get(url, options);
  const reader = new PageReader(unavailable());
  try {
    const material = await reader.read('https://example.org/article', operation, 8192);
    expect(body(material)).toContain('Loading');
    expect(material.sourceTruncated).toBe(true);
    expect(material.scope.renderingReason).toContain('额度');
  } finally { operation.close(); await reader.stop(); }
});

test('每次远程读取使用当前密钥，清空后恢复免 Key', async () => {
  let key = 'fixture-credential';
  const renderer = new MicrolinkRenderer(() => key);
  for (const next of ['fixture-credential', '']) {
    key = next;
    const { operation } = serviceFixture(next);
    try { expect((await renderer.render('https://example.org/article', operation, 8192)).html).toContain('远程渲染'); }
    finally { operation.close(); }
  }
});

test.each([
  [200, 'not json', 'protocol_error'],
  [200, JSON.stringify({ status: 'success', statusCode: 200, data: {} }), 'protocol_error'],
  [200, JSON.stringify({ status: 'success', statusCode: 404, data: { html: '<main>missing</main>', url: 'https://example.org/' } }), 'not_found'],
  [200, JSON.stringify({ status: 'success', statusCode: 200, data: { html: '<main>private</main>', url: 'http://localhost/' } }), 'address_denied'],
  [401, '{}', 'access_denied'],
])('Microlink 边界响应 %s %s 不冒充可用正文', async (status, responseBody, kind) => {
  const { operation } = serviceFixture();
  operation.get = async url => ({ url, status, headers: {}, body: Buffer.from(responseBody) });
  try { await expect(new MicrolinkRenderer().render('https://example.org/article', operation, 8192)).rejects.toMatchObject({ kind }); }
  finally { operation.close(); }
});

test('远程 HTML 遵守读取大小上限', async () => {
  const { operation } = serviceFixture('', '<main>' + '正文'.repeat(2000) + '</main>');
  try { await expect(new MicrolinkRenderer().render('https://example.org/article', operation, 1024)).rejects.toMatchObject({ kind: 'source_limit' }); }
  finally { operation.close(); }
});

test('远程等待共用整次读取的取消信号', async () => {
  const { operation } = serviceFixture();
  const controller = new AbortController();
  const pending: ReadOperation = { ...operation, signal: controller.signal,
    get: () => waitWithSignal(new Promise(() => {}), controller.signal) };
  const reading = new MicrolinkRenderer().render('https://example.org/article', pending, 8192);
  controller.abort(new ReadError('timeout', '读取已取消。'));
  try { await expect(reading).rejects.toMatchObject({ kind: 'timeout' }); }
  finally { operation.close(); }
});
