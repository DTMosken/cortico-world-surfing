import { Worker } from 'node:worker_threads';
import { ReadError, asReadError, validatePublicUrl, waitWithSignal, type FailureKind, type ReadOperation, type PublicResponse } from './network.ts';
import { createServer, type Server } from 'node:net';
import { chromium, type Browser } from 'playwright';
import type { Material } from './snapshots.ts';

const ENGINE = new URL('../dist/page-engine.mjs', import.meta.url);
export function pageKey(input: string): string { return 'page:' + validatePublicUrl(input).href; }

function extract(html: string, url: string, signal: AbortSignal): Promise<Material> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(ENGINE, { workerData: { html, url } });
    const abort = () => { void worker.terminate(); reject(asReadError(signal.reason)); };
    signal.addEventListener('abort', abort, { once: true });
    worker.once('message', (message: { material?: Material; error?: { kind: FailureKind; message: string } }) => {
      signal.removeEventListener('abort', abort);
      void worker.terminate();
      if (message.error) reject(new ReadError(message.error.kind, message.error.message)); else resolve(message.material!);
    });
    worker.once('error', () => { signal.removeEventListener('abort', abort); reject(new ReadError('protocol_error', '正文提取引擎未能完成读取。')); });
    worker.once('exit', code => {
      signal.removeEventListener('abort', abort);
      if (code !== 0) reject(new ReadError('content_unavailable', '正文提取被中断。'));
    });
  });
}

export class PageReader {
  constructor(private readonly renderer = new Renderer()) {}

  async read(input: string, operation: ReadOperation, maxBytes: number): Promise<Material> {
    const original = validatePublicUrl(input);
    this.rejectVideo(original);
    const response = await operation.get(original.href);
    if (response.status !== 200) throw new ReadError(response.status === 404 ? 'not_found' : 'access_denied', '网页未允许本次公开读取。');
    const target = validatePublicUrl(response.url);
    if (!target.hash) target.hash = original.hash;
    this.rejectVideo(target);
    const type = response.headers['content-type']?.toLowerCase() ?? '';
    const prefix = response.body.subarray(0,8192).toString('latin1');
    const bom = response.body[0]===255 && response.body[1]===254 ? 'utf-16le'
      : response.body[0]===254 && response.body[1]===255 ? 'utf-16be' : undefined;
    const charset = bom ?? type.match(/charset\s*=\s*["']?([^\s;"']+)/)?.[1]
      ?? prefix.match(/<meta\b[^>]*\bcharset\s*=\s*["']?([a-z0-9._-]+)/i)?.[1] ?? 'utf-8';
    let html: string;
    try { html = new TextDecoder(charset).decode(response.body); }
    catch { throw new ReadError('protocol_error', '网页使用了不支持的文字编码。'); }
    if (type.startsWith('text/plain') || type.startsWith('text/markdown')) return {
      kind: 'page', key: pageKey(input), source: target.href, title: '公开文本', scope: { kind: 'web-page', extraction: 'text' },
      units: [{ kind: 'text', text: html }],
    };
    if (type && !type.includes('text/html') && !type.includes('application/xhtml+xml'))
      throw new ReadError('content_unavailable', '首版仅读取网页和公开文本，未提取此文件格式。');
    let material: Material;
    let staticMaterial: Material | undefined;
    try {
      material = await extract(html, target.href, operation.signal);
      staticMaterial = material;
      if (material.scope.mayNeedRendering) throw new ReadError('content_unavailable','页面含脚本而静态正文很短，需要检查渲染结果。');
    }
    catch (error) {
      if (!(error instanceof ReadError) || error.kind !== 'content_unavailable') throw error;
      try {
        const rendered = await this.renderer.render(target.href, operation, maxBytes,response);
        material = await extract(rendered.html, rendered.url, operation.signal);
        delete material.scope.mayNeedRendering;
        material.scope.extraction = 'rendered-html';
      } catch (renderError) {
        if (!staticMaterial || operation.signal.aborted) throw renderError;
        const failure = asReadError(renderError);
        material = staticMaterial; delete material.scope.mayNeedRendering;
        material.sourceTruncated = true; material.truncationReason = 'rendering_unavailable';
        material.scope.renderingStatus = failure.kind; material.scope.renderingReason = failure.message;
      }
    }
    material.key = pageKey(input);
    return material;
  }

  private rejectVideo(url: URL): void {
    if (['bilibili.com', 'www.bilibili.com', 'm.bilibili.com', 'b23.tv'].includes(url.hostname)) {
      const bvid = url.pathname.match(/BV[0-9A-Za-z]{10}/)?.[0];
      if (bvid || url.hostname === 'b23.tv' || /^\/video\/av\d+/.test(url.pathname))
        throw new ReadError('invalid_input', `该链接是 B站视频${bvid ? '（'+bvid+'）' : ''}，请用 surfing_read_bili 读取字幕。`);
    }
  }

  async stop(): Promise<void> { await this.renderer.stop(); }
}

/** Chromium receives fulfilled responses only; its direct proxy rejects every connection. */
export class Renderer {
  private browser?: Promise<Browser>;
  private proxy?: Server;

  constructor(private readonly launchBrowser: typeof chromium.launch = options=>chromium.launch(options)) {}

  private launch(): Promise<Browser> {
    if (!this.browser) this.browser = (async () => {
      const proxy = createServer(socket => socket.destroy());
      this.proxy = proxy;
      await new Promise<void>((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
      const port = (proxy.address() as { port: number }).port;
      try {
        return await this.launchBrowser({ headless: true, timeout: 10000,
          proxy: { server: `http://127.0.0.1:${port}`, bypass: '<-loopback>' },
          args: ['--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--disable-component-update',
            '--disable-sync', '--disable-extensions', '--disable-default-apps', '--disable-features=DnsOverHttps,WebTransport',
            '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
        });
      } catch {
        proxy.close();
        if (this.proxy === proxy) { this.proxy = undefined; this.browser = undefined; }
        throw new ReadError('browser_unavailable', '动态网页读取需要 Chromium；在扩展目录执行 pnpm install:browser 后重试。');
      }
    })();
    return this.browser;
  }

  async render(input: string, operation: ReadOperation, maxBytes: number, initialDocument?: PublicResponse): Promise<{ html: string; url: string }> {
    const original = validatePublicUrl(input);
    operation.signal.throwIfAborted();
    const document = initialDocument ?? await operation.get(original.href);
    if (document.status!==200) throw new ReadError('access_denied','网页未允许本次公开渲染。');
    const target = validatePublicUrl(document.url);
    if (!target.hash) target.hash = original.hash;
    let browser: Browser;
    try { browser = await waitWithSignal(this.launch(),operation.signal); }
    catch (error) { throw asReadError(error); }
    operation.signal.throwIfAborted();
    const opening = browser.newContext({ acceptDownloads: false, serviceWorkers: 'block', storageState: undefined });
    let context;
    try { context = await waitWithSignal(opening,operation.signal); }
    catch (error) { void opening.then(value=>value.close()).catch(()=>{}); throw asReadError(error); }
    const abort = () => { void context.close().catch(() => {}); };
    operation.signal.addEventListener('abort', abort, { once: true });
    let navigationError: ReadError | undefined;
    let initialNavigation = false;
    const entry = new URL(target); entry.hash = '';
    try {
      operation.signal.throwIfAborted();
      await context.routeWebSocket('**/*', socket => socket.close());
      await context.addInitScript(() => {
        for (const key of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) {
          Object.defineProperty(globalThis, key, { value: undefined, configurable: false, writable: false });
        }
        for (const key of ['submit','requestSubmit']) {
          Object.defineProperty(HTMLFormElement.prototype,key,{value:()=>{},configurable:false,writable:false});
        }
        const preventDefault = Function.prototype.call.bind(Event.prototype.preventDefault);
        window.addEventListener('submit',event=>preventDefault(event),true);
      });
      await context.route('**/*', async route => {
        const request = route.request();
        if (request.method() !== 'GET' || !['document', 'script', 'stylesheet', 'xhr', 'fetch'].includes(request.resourceType())) {
          await route.abort().catch(() => {}); return;
        }
        try {
          let response: PublicResponse;
          if (request.resourceType()==='document') {
            const first = !initialNavigation && request.frame().parentFrame()===null && request.url()===entry.href;
            if (!first)
              throw new ReadError('access_denied','动态读取仅允许入口页面和 HTTP 重定向；需要其他页面时单独读取其链接。');
            initialNavigation = true; response = document;
          } else response = await operation.get(request.url(), { headers: request.headers() });
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
      await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 0 });
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
    const proxy = this.proxy;
    this.browser = undefined; this.proxy = undefined;
    await browser?.then(value => value.close()).catch(() => {});
    if (proxy) await new Promise<void>(resolve => proxy.close(() => resolve()));
  }
}
