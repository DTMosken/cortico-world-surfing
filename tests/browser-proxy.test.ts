import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { createSecureServer } from 'node:http2';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { expect, test } from 'vitest';
import { PublicClient } from '../src/network.ts';
import { Renderer } from '../src/page-reader.ts';

const html = '<main id="body"></main><script>fetch("/content").then(r=>r.text()).then(text=>document.querySelector("#body").textContent=text)</script>';
const text = '浏览器通过原生 HTTPS 取得正文。';

async function withServer(run: (url: string, requests: Array<{ path: string; protocol: string; cookie?: string }>) => Promise<void>, content = text) {
  const requests: Array<{ path: string; protocol: string; cookie?: string }> = [];
  const server = createSecureServer({ allowHTTP1: true,
    key: readFileSync(new URL('./fixtures/browser-key.pem', import.meta.url)),
    cert: readFileSync(new URL('./fixtures/browser-cert.pem', import.meta.url)) });
  server.on('request', (request, response) => {
    requests.push({ path: request.url!, protocol: request.httpVersion, cookie: request.headers.cookie });
    if (request.url === '/content') {
      response.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' });
      response.end(gzipSync(content));
    } else {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'reading=fixture; Path=/; Secure' });
      response.end(html);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`https://example.org:${(server.address() as { port: number }).port}/article`, requests); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

function renderer() {
  return new Renderer(async options => {
    const browser = await chromium.launch(options);
    const createContext = browser.newContext.bind(browser);
    browser.newContext = options => createContext({ ...options, ignoreHTTPSErrors: true });
    return browser;
  });
}

function operation(maxDownloadBytes = 1024*1024) {
  const read = new PublicClient(async () => [{ address: '127.0.0.1', family: 4 }]).operation({
    requestTimeoutMs: 10000, maxDownloadBytes, proxyCompatibility: true, customProxyRanges: '127.0.0.0/8',
  });
  read.get = async () => { throw new Error('Browser resources must use Chromium networking'); };
  return read;
}

test('Chromium 原生 HTTPS 使用 HTTP/2 和本次匿名 Cookie 取得动态正文', () => withServer(async (url, requests) => {
  const read = operation(), browser = renderer();
  try {
    const result = await browser.render(url, read, 1024*1024, { url, status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(html) });
    expect(result.html).toContain(text);
    expect(requests.find(request => request.path === '/content')).toMatchObject({ protocol: '2.0', cookie: 'reading=fixture' });
    expect(read.downloadedBytes).toBeGreaterThanOrEqual(Buffer.byteLength(html) + Buffer.byteLength(text));
  } finally { read.close(); await browser.stop(); }
}));

test('浏览器原生下载仍按解压后的字节数执行整次读取上限', () => withServer(async url => {
  const read = operation(4096), browser = renderer();
  try {
    await expect(browser.render(url, read, 1024*1024, { url, status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(html) }))
      .rejects.toMatchObject({ kind: 'source_limit' });
  } finally { read.close(); await browser.stop(); }
}, 'x'.repeat(65536)));
