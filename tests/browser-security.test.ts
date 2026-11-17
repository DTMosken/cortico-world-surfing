import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createSecureServer } from 'node:http2';
import type { Socket } from 'node:net';
import { gzipSync } from 'node:zlib';
import { chromium, type Browser } from 'playwright';
import { expect, test } from 'vitest';
import { PublicClient, type ReadError } from '../src/network.ts';
import { Renderer } from '../src/page-reader.ts';
import { attachBrowserNetwork } from '../src/browser-network.ts';
import { createBrowserProxy } from '../src/browser-proxy.ts';
import { browserTls } from './fixtures/browser-tls.ts';

type WorkerKind = 'Worker' | 'nested Worker' | 'SharedWorker' | 'URL Worker' | 'URL SharedWorker';
const kinds: WorkerKind[] = ['Worker', 'nested Worker', 'SharedWorker', 'URL Worker', 'URL SharedWorker'];
const smallContent = 'Worker 读取到的正文。';

function workerPage(kind: WorkerKind, websocket: boolean): { html: string; script: string } {
  const exercise = `async function exercise(report) {
    const content = await fetch(self.location.origin + '/content').then(response => response.text());
    let socket = 'unused';
    ${websocket ? `socket = await new Promise(resolve => {
      try {
        const connection = new WebSocket(self.location.origin.replace('https:', 'wss:') + '/socket');
        connection.onopen = () => { connection.send('fixture-write'); resolve('connected'); connection.close(); };
        connection.onerror = () => resolve('blocked');
        connection.onclose = () => resolve('blocked');
      } catch { resolve('blocked'); }
    });` : ''}
    report({ content: content.length < 100 ? content : '', size: content.length, socket });
  }`;
  const inner = exercise + ';exercise(value => postMessage(value));';
  const shared = kind.endsWith('SharedWorker');
  // SharedWorker fixtures close after reporting their completed task.
  const script = shared ? exercise + ';onconnect = event => exercise(value => { event.ports[0].postMessage(value); close(); });'
    : kind === 'nested Worker' ? `const nested = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(inner)}], { type: 'text/javascript' }))); nested.onmessage = event => postMessage(event.data);`
    : inner;
  const source = kind.startsWith('URL') ? "'/worker.js'" : `URL.createObjectURL(new Blob([${JSON.stringify(script)}], { type: 'text/javascript' }))`;
  const html = `<main id="body">waiting</main><script>
    fetch('/hold');
    const worker = new ${shared ? 'SharedWorker' : 'Worker'}(${source});
    const channel = ${shared ? 'worker.port' : 'worker'};
    channel.onmessage = event => {
      const body = document.querySelector('#body');
      body.textContent = event.data.content;
      body.dataset.socket = event.data.socket;
      body.dataset.size = event.data.size;
      fetch('/done').then(() => { body.dataset.done = 'true'; });
    };
  </script>`;
  return { html, script };
}

async function withSite(html: string, content: string, run: (site: {
  url: string; requests: string[]; upgrades: string[]; receivedBytes: () => number;
}) => Promise<void>, workerScript = '') {
  const requests: string[] = [], upgrades: string[] = [];
  const sockets = new Set<Socket>();
  const held = new Set<{ end(): void }>();
  const ready = new Set<{ end(data: string): void }>();
  let finished = false, slowStarted = false, receivedBytes = 0;
  const server = createSecureServer({ allowHTTP1: true, ...await browserTls });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('upgrade', (request, socket) => {
    upgrades.push(request.url!);
    const accept = createHash('sha1').update(request.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on('data', (bytes: Buffer) => { receivedBytes += bytes.length; socket.end(); });
    socket.on('error', () => socket.destroy());
  });
  server.on('request', (request, response) => {
    requests.push(request.url!);
    if (request.url === '/slow') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('pending');
      slowStarted = true;
      for (const pending of ready) pending.end('started');
    } else if (request.url === '/started') {
      if (slowStarted) response.end('started'); else ready.add(response);
      response.once('close', () => ready.delete(response));
    } else if (request.url === '/hold') {
      response.statusCode = 204;
      if (finished) response.end(); else held.add(response);
      response.once('close', () => held.delete(response));
    } else if (request.url === '/done') {
      finished = true;
      response.writeHead(204).end();
      for (const pending of held) pending.end();
    } else if (request.url === '/worker.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end(workerScript);
    } else if (request.url === '/content') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-encoding': 'gzip' });
      response.end(gzipSync(content));
    } else {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run({ url: `https://example.org:${(server.address() as { port: number }).port}/article`, requests, upgrades, receivedBytes: () => receivedBytes }); }
  finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

function browser(inspectArguments = false) {
  let arguments_: string[] = [];
  const renderer = new Renderer(async options => {
    const launched = await chromium.launch(inspectArguments
      ? { ...options, args: [...options?.args ?? [], '--enable-automation'] } : options);
    if (inspectArguments) {
      const session = await launched.newBrowserCDPSession();
      arguments_ = (await session.send('Browser.getBrowserCommandLine')).arguments;
      await session.detach();
    }
    const createContext = launched.newContext.bind(launched);
    launched.newContext = options => createContext({ ...options, ignoreHTTPSErrors: true });
    return launched;
  });
  return { renderer, arguments: () => arguments_ };
}

async function render(html: string, url: string, maxDownloadBytes: number, renderer: Renderer) {
  const operation = new PublicClient(async () => [{ address: '127.0.0.1', family: 4 }]).operation({
    requestTimeoutMs: 10000, maxDownloadBytes, proxyCompatibility: true, customProxyRanges: '127.0.0.0/8',
  });
  try {
    return await renderer.render(url, operation, 1024 * 1024,
      { url, status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(html) });
  } finally { operation.close(); await renderer.stop(); }
}

async function renderSharedWorker(url: string) {
  const operation = new PublicClient(async () => [{ address: '127.0.0.1', family: 4 }]).operation({
    requestTimeoutMs: 10000, maxDownloadBytes: 8192, proxyCompatibility: true, customProxyRanges: '127.0.0.0/8',
  });
  const proxy = await createBrowserProxy(operation);
  let launched: Browser | undefined, failure: ReadError | undefined;
  try {
    launched = await chromium.launch({ headless: true, chromiumSandbox: true, proxy: { server: proxy.server, bypass: '<-loopback>' } });
    const context = await launched.newContext({ ignoreHTTPSErrors: true });
    await attachBrowserNetwork(launched, operation, error => { failure = error; void context.close().catch(() => {}); });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    // URL SharedWorker script requests keep Playwright's networkidle pending; wait for their result.
    await page.waitForFunction(() => document.querySelector('#body')?.hasAttribute('data-done'), undefined, { timeout: 10000 });
    expect(operation.downloadedBytes).toBeGreaterThan(Buffer.byteLength(smallContent));
    return { html: await page.content() };
  } catch (error) { throw failure ?? error; }
  finally { operation.close(); await launched?.close(); await proxy.close(); }
}

test('Chromium 启用沙箱后仍能通过原生网络读取页面', () => {
  const html = '<main>沙箱中的页面。</main>';
  return withSite(html, '', async ({ url }) => {
    const instance = browser(true);
    expect((await render(html, url, 8192, instance.renderer)).html).toContain('<main>沙箱中的页面。</main>');
    expect(instance.arguments()).not.toContain('--no-sandbox');
  });
});

test.each(kinds)('%s 的 GET 读取正常，WebSocket 不连接也不发送数据', kind => {
  const { html, script } = workerPage(kind, true);
  return withSite(html, smallContent, async site => {
    const result = kind === 'URL SharedWorker' ? await renderSharedWorker(site.url)
      : await render(html, site.url, 8192, browser().renderer);
    expect(result.html).toContain(smallContent);
    expect(result.html).toContain('data-socket="blocked"');
    expect(site.requests).toContain('/done');
    expect(site.upgrades).toEqual([]);
    expect(site.receivedBytes()).toBe(0);
  }, script);
});

test.each(kinds)('%s 的压缩响应按解压后的大小执行整次下载上限', kind => {
  const { html, script } = workerPage(kind, false);
  return withSite(html, 'x'.repeat(256 * 1024), async ({ url }) => {
    await expect(render(html, url, 8192, browser().renderer)).rejects.toMatchObject({ kind: 'source_limit' });
  }, script);
});

test('页面取消自己的 fetch 后仍可完成正文读取', () => {
  const html = `<main id="body">waiting</main><script>
    const controller = new AbortController();
    const cancelled = fetch('/slow', { signal: controller.signal }).then(response => response.text()).catch(error => error.name);
    fetch('/started').then(response => response.text()).then(async () => {
      controller.abort();
      const body = document.querySelector('#body');
      body.dataset.abort = await cancelled;
      body.textContent = await fetch('/content').then(response => response.text());
    });
  </script>`;
  return withSite(html, smallContent, async ({ url, requests }) => {
    const result = await render(html, url, 8192, browser().renderer);
    expect(result.html).toContain('data-abort="AbortError"');
    expect(result.html).toContain(smallContent);
    expect(requests).toContain('/slow');
  });
});
