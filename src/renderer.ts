/** Chromium receives fulfilled responses only; its direct proxy rejects every connection. */
import { createServer, type Server } from 'node:net';
import { chromium, type Browser } from 'playwright';
import { ReadError, asReadError } from './errors.ts';
import { validatePublicUrl, type ReadOperation } from './network.ts';

export class Renderer {
  private browser?: Promise<Browser>;
  private proxy?: Server;

  private launch(): Promise<Browser> {
    if (!this.browser) this.browser = (async () => {
      const proxy = createServer(socket => socket.destroy());
      this.proxy = proxy;
      await new Promise<void>((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
      const port = (proxy.address() as { port: number }).port;
      try {
        return await chromium.launch({ headless: true, timeout: 10000,
          proxy: { server: `http://127.0.0.1:${port}`, bypass: '<-loopback>' },
          args: ['--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--disable-component-update',
            '--disable-sync', '--disable-extensions', '--disable-default-apps', '--disable-features=DnsOverHttps,WebTransport',
            '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
        });
      } catch {
        proxy.close(); this.proxy = undefined; this.browser = undefined;
        throw new ReadError('browser_unavailable', '动态网页读取需要 Chromium；在扩展目录执行 pnpm install:browser 后重试。');
      }
    })();
    return this.browser;
  }

  async render(input: string, operation: ReadOperation, maxBytes: number): Promise<{ html: string; url: string }> {
    validatePublicUrl(input);
    operation.signal.throwIfAborted();
    const browser = await this.launch();
    operation.signal.throwIfAborted();
    const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block', storageState: undefined });
    const abort = () => { void context.close().catch(() => {}); };
    operation.signal.addEventListener('abort', abort, { once: true });
    let navigationError: ReadError | undefined;
    try {
      operation.signal.throwIfAborted();
      await context.routeWebSocket('**/*', socket => socket.close());
      await context.addInitScript(() => {
        for (const key of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) {
          Object.defineProperty(globalThis, key, { value: undefined, configurable: false, writable: false });
        }
      });
      await context.route('**/*', async route => {
        const request = route.request();
        if (request.method() !== 'GET' || !['document', 'script', 'stylesheet', 'xhr', 'fetch'].includes(request.resourceType())) {
          await route.abort().catch(() => {}); return;
        }
        try {
          const response = await operation.get(request.url(), { followRedirects: false, headers: request.headers() });
          const headers = { ...response.headers };
          delete headers.connection;
          delete headers['keep-alive'];
          await route.fulfill({ status: response.status, headers, body: response.body });
        } catch (error) {
          if (request.isNavigationRequest() && request.frame().parentFrame() === null) navigationError = asReadError(error);
          await route.abort().catch(() => {});
        }
      });
      const page = await context.newPage();
      await page.goto(input, { waitUntil: 'domcontentloaded', timeout: 0 });
      await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
      operation.signal.throwIfAborted();
      const html = await page.content();
      if (Buffer.byteLength(html) > maxBytes) throw new ReadError('source_limit', '渲染后的 HTML 超出单次读取上限。');
      return { html, url: validatePublicUrl(page.url()).href };
    } catch (error) {
      if (operation.signal.aborted) throw asReadError(operation.signal.reason);
      throw navigationError ?? asReadError(error);
    } finally {
      operation.signal.removeEventListener('abort', abort);
      await context.close().catch(() => {});
    }
  }

  async stop(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    await browser?.then(value => value.close()).catch(() => {});
    const proxy = this.proxy;
    this.proxy = undefined;
    if (proxy) await new Promise<void>(resolve => proxy.close(() => resolve()));
  }
}
