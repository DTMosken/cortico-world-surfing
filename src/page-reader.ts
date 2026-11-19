import { Worker } from 'node:worker_threads';
import { ReadError, asReadError, validatePublicUrl, waitWithSignal, type FailureKind, type ReadOperation, type PublicResponse } from './network.ts';
import { createServer } from 'node:net';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { Material } from './snapshots.ts';
import { MicrolinkRenderer } from './microlink.ts';
import { renderPdf } from './pdf-reader.ts';
import { SURFING_DEFAULTS } from './config.ts';
import { createBrowserProxy } from './browser-proxy.ts';
import { attachBrowserNetwork } from './browser-network.ts';
import { answerYouTubeComments, youtubeContinuation, youtubeWatchPage } from './youtube-comments.ts';

import { captureScreen, type VisualStep, type VisualButton } from './visual-page.ts';

export interface PageReadOptions { mode: 'auto' | 'text' | 'visual'; page: number; maxImageDimension: number; steps?: VisualStep[]; afterClick?: boolean }
const defaultOptions: PageReadOptions = { mode: 'auto', page: 1, maxImageDimension: SURFING_DEFAULTS.reading.maxImageDimension };

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
  constructor(private readonly renderer = new Renderer(), private readonly microlink = new MicrolinkRenderer()) {}

  async read(input: string, operation: ReadOperation, maxBytes: number, options = defaultOptions, savedPdf?: Uint8Array): Promise<Material> {
    const original = validatePublicUrl(input);
    this.rejectVideo(original);
    const response = savedPdf ? { url: original.href, status: 200, headers: { 'content-type': 'application/pdf' }, body: Buffer.from(savedPdf) }
      : await operation.get(original.href);
    if (response.status !== 200) throw new ReadError(response.status === 404 ? 'not_found' : 'access_denied', '网页未允许本次公开读取。');
    const target = validatePublicUrl(response.url);
    if (!target.hash) target.hash = original.hash;
    this.rejectVideo(target);
    const type = response.headers['content-type']?.toLowerCase() ?? '';
    if (type.includes('application/pdf') || response.body.subarray(0, 5).toString() === '%PDF-') {
      const rendered = await this.renderer.pdf(response.body, operation, options);
      return { kind: 'page', key: pageKey(input), source: target.href, title: 'PDF',
        scope: { kind: 'pdf', page: options.page, pages: rendered.pages }, pdf: response.body,
        units: [{ kind: 'text', text: rendered.text || '本页未提取到文字。' }],
        ...(rendered.image ? { image: { bytes: rendered.image, mime: 'image/png', name: `page-${options.page}.png`,
          fallbackText: `PDF 第 ${options.page}/${rendered.pages} 页；来源 ${target.href}` } } : {}) };
    }
    const imageMime = directImageMime(response.body);
    if (imageMime) {
      if (options.mode === 'text') throw new ReadError('content_unavailable', '图片直链没有文字提取结果，请使用 auto 或 visual 模式。');
      if (options.page !== 1) throw new ReadError('invalid_input', '图片直链只有第 1 页。');
      return { kind: 'page', key: pageKey(input), source: target.href, title: '图片', scope: { kind: 'image' }, units: [],
        image: { bytes: response.body, mime: imageMime, name: 'image', fallbackText: `原始图片；来源 ${target.href}` } };
    }
    if (type.startsWith('image/')) throw new ReadError('content_unavailable', '此图片格式尚不支持；支持 PNG、JPEG、WebP 和 GIF。');
    if (options.page !== 1 && options.mode !== 'visual') throw new ReadError('invalid_input', '网页按屏读取需使用 visual 模式。');
    const prefix = response.body.subarray(0,8192).toString('latin1');
    const bom = response.body[0]===255 && response.body[1]===254 ? 'utf-16le'
      : response.body[0]===254 && response.body[1]===255 ? 'utf-16be' : undefined;
    const charset = bom ?? type.match(/charset\s*=\s*["']?([^\s;"']+)/)?.[1]
      ?? prefix.match(/<meta\b[^>]*\bcharset\s*=\s*["']?([a-z0-9._-]+)/i)?.[1] ?? 'utf-8';
    let html: string;
    try { html = new TextDecoder(charset).decode(response.body); }
    catch { throw new ReadError('protocol_error', '网页使用了不支持的文字编码。'); }
    const plainText = type.startsWith('text/plain') || type.startsWith('text/markdown');
    if (plainText && options.mode !== 'visual') {
      if (!html.trim()) throw new ReadError('content_unavailable', '未取得网页正文。');
      return {
      kind: 'page', key: pageKey(input), source: target.href, title: '公开文本', scope: { kind: 'web-page', extraction: 'text' },
      units: [{ kind: 'text', text: html }],
      };
    }
    if (type && !plainText && !type.includes('text/html') && !type.includes('application/xhtml+xml'))
      throw new ReadError('content_unavailable', '支持网页、公开文本、PNG/JPEG/WebP/GIF 图片和 PDF，未提取此文件格式。');
    if (options.mode === 'visual') {
      const rendered = await this.renderer.render(target.href, operation, maxBytes, response, options, async () => true);
      return screenshotMaterial(input, rendered, options.steps);
    }
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
        let rendered: RenderedPage;
        let localMaterial: Material | undefined;
        let provider = 'chromium';
        try { rendered = await this.renderer.render(target.href, operation, maxBytes, response, options,
          options.mode === 'auto' ? async (html, url) => {
            try { localMaterial = await extract(html, url, operation.signal); return false; }
            catch (error) { if (!target.hash && error instanceof ReadError && error.kind === 'content_unavailable') return true; throw error; }
          } : undefined); }
        catch (error) {
          if (operation.signal.aborted || !(error instanceof ReadError) || error.kind !== 'browser_unavailable') throw error;
          rendered = await this.microlink.render(target.href, operation, maxBytes);
          provider = 'microlink';
        }
        this.rejectVideo(validatePublicUrl(rendered.url));
        if (rendered.image) return screenshotMaterial(input, rendered);
        material = localMaterial ?? await extract(rendered.html, rendered.url, operation.signal);
        delete material.scope.mayNeedRendering;
        material.scope.extraction = 'rendered-html';
        material.scope.renderingProvider = provider;
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

function directImageMime(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return undefined;
}

interface RenderedPage {
  html: string; url: string;
  image?: { bytes: Uint8Array; page: number; pages: number; y: number; title: string; buttons: VisualButton[] };
}

function screenshotMaterial(input: string, rendered: RenderedPage, steps: VisualStep[] = []): Material {
  const image = rendered.image!;
  return { kind: 'page', key: pageKey(input), source: rendered.url, title: image.title || '网页截图',
    visual: { entry: input, steps, buttons: image.buttons, page: image.page },
    units: image.buttons.length ? [{kind: 'text', text: image.buttons.map((b,i) => `[B${i+1}] ${b.label}`).join('\n')}] : [],
    scope: { kind: 'web-page', extraction: 'screenshot', page: image.page, pages: image.pages, y: image.y },
    image: { bytes: image.bytes, mime: 'image/png', name: `screen-${image.page}.png`,
      fallbackText: `网页第 ${image.page}/${image.pages} 屏，纵向位置 ${image.y} 像素；来源 ${rendered.url}` } };
}

/** Each read owns its browser; webpages use a checked proxy and PDFs have no network access. */
export class Renderer {
  private readonly closers = new Set<() => Promise<void>>();

  constructor(private readonly launchBrowser: typeof chromium.launch = options=>chromium.launch(options)) {}

  private launch() {
    const proxy = createServer(socket => socket.destroy());
    const browser = (async () => {
      await new Promise<void>((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
      const port = (proxy.address() as { port: number }).port;
      try {
        return await this.launchBrowser({ headless: true, chromiumSandbox: true, timeout: 10000,
          proxy: { server: `http://127.0.0.1:${port}`, bypass: '<-loopback>' },
          args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--disable-background-networking', '--disable-component-update',
            '--disable-sync', '--disable-extensions', '--disable-default-apps', '--disable-features=DnsOverHttps,WebTransport',
            '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
        });
      } catch {
        throw new ReadError('browser_unavailable', '动态网页读取需要 Chromium Headless Shell；在网上冲浪配置页安装，或在扩展目录执行 pnpm install:browser 后重试。');
      }
    })();
    let closing: Promise<void> | undefined;
    const close = () => closing ??= (async () => {
      await browser.then(value => value.close()).catch(() => {});
      await new Promise<void>(resolve => proxy.close(() => resolve()));
      this.closers.delete(close);
    })();
    this.closers.add(close);
    return { browser, close };
  }

  private async withContext<T>(operation: ReadOperation, run: (context: BrowserContext, browser: Browser) => Promise<T>, proxy?: string): Promise<T> {
    let context: BrowserContext | undefined;
    let browser: Browser | undefined;
    if (operation.signal.aborted) throw asReadError(operation.signal.reason);
    const session = this.launch();
    const abort = () => { void context?.close().catch(() => {}); };
    try {
      browser = await waitWithSignal(session.browser, operation.signal);
      operation.signal.throwIfAborted();
      const opening = browser.newContext({ acceptDownloads: false, serviceWorkers: 'block', storageState: undefined,
        ...(proxy ? { proxy: { server: proxy, bypass: '<-loopback>' } } : {}) });
      try { context = await waitWithSignal(opening, operation.signal); }
      catch (error) { void opening.then(value => value.close()).catch(() => {}); throw error; }
      operation.signal.addEventListener('abort', abort, { once: true });
      operation.signal.throwIfAborted();
      return await run(context, browser);
    }
    catch (error) { throw asReadError(operation.signal.aborted ? operation.signal.reason : error); }
    finally {
      operation.signal.removeEventListener('abort', abort);
      await context?.close().catch(() => {});
      if (browser) await session.close(); else void session.close();
    }
  }

  async pdf(bytes: Uint8Array, operation: ReadOperation, options: PageReadOptions) {
    return this.withContext(operation, context => renderPdf(context, bytes, options.page, options.maxImageDimension, options.mode !== 'text'));
  }

  async render(input: string, operation: ReadOperation, maxBytes: number, initialDocument?: PublicResponse,
    options = defaultOptions, capture?: (html: string, url: string) => Promise<boolean>): Promise<RenderedPage> {
    const original = validatePublicUrl(input);
    operation.signal.throwIfAborted();
    const document = initialDocument ?? await operation.get(original.href);
    if (document.status!==200) throw new ReadError('access_denied','网页未允许本次公开渲染。');
    const target = validatePublicUrl(document.url);
    if (!target.hash) target.hash = original.hash;
    const proxy = await createBrowserProxy(operation);
    try { return await this.withContext(operation, async (context, browser) => {
    let navigationError: ReadError | undefined;
    let initialNavigation = false;
    const entry = new URL(target); entry.hash = '';
    try {
      operation.signal.throwIfAborted();
      await attachBrowserNetwork(browser, operation, error => {
        navigationError = error; void context.close().catch(() => {});
      }, !!options.steps?.length);
      await context.addInitScript(`
        for (const key of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport']) {
          Object.defineProperty(globalThis, key, { value: undefined, configurable: false, writable: false });
        }
        for (const key of ['submit','requestSubmit']) {
          Object.defineProperty(HTMLFormElement.prototype,key,{value:()=>{},configurable:false,writable:false});
        }
        const preventDefault = Function.prototype.call.bind(Event.prototype.preventDefault);
        window.addEventListener('submit',event=>preventDefault(event),true);
      `);
      const page = await context.newPage();
      await context.route('**/*', async route => {
        const request = route.request();
        if (capture && youtubeWatchPage(target) && youtubeContinuation(request)) {
          try {
            if (request.frame() !== page.mainFrame() || !youtubeWatchPage(new URL(page.url()))) { await route.abort(); return; }
            await answerYouTubeComments(route, operation);
          } catch (error) {
            if (error instanceof ReadError && error.kind === 'source_limit') {
              navigationError = error; void context.close().catch(() => {});
            }
            await route.abort().catch(() => {});
          }
          return;
        }
        if (request.method() !== 'GET' || !['document', 'script', 'stylesheet', 'xhr', 'fetch', ...(capture ? ['image', 'font'] : [])].includes(request.resourceType())) {
          await route.abort().catch(() => {}); return;
        }
        try {
          validatePublicUrl(request.url());
          if (request.resourceType()==='document') {
            const first = !initialNavigation && request.frame().parentFrame()===null && request.url()===entry.href;
            if (!first && !(request.redirectedFrom() && request.frame().parentFrame()===null))
              throw new ReadError('access_denied','动态读取仅允许入口页面和 HTTP 重定向；需要其他页面时单独读取其链接。');
            initialNavigation = true;
          }
          await route.fallback();
        } catch (error) {
          if (request.isNavigationRequest() && request.frame().parentFrame() === null) navigationError = asReadError(error);
          await route.abort().catch(() => {});
        }
      });
      if (capture) await page.setViewportSize({ width: options.maxImageDimension, height: Math.round(options.maxImageDimension * 0.75) });
      await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 0 });
      await page.waitForLoadState('networkidle', { timeout: 0 });
      operation.signal.throwIfAborted();
      const html = await page.content();
      const finalUrl = validatePublicUrl(page.url()).href;
      if (Buffer.byteLength(html) > maxBytes) throw new ReadError('source_limit', '渲染后的 HTML 超出单次读取上限。');
      if (capture && await capture(html, finalUrl)) {
        const image = await captureScreen(page, options.page, options.steps ?? [], !!options.afterClick);
        if (navigationError) throw navigationError;
        return { html, url: finalUrl, image };
      }
      return { html, url: finalUrl };
    } catch (error) {
      if (operation.signal.aborted) throw asReadError(operation.signal.reason);
      throw navigationError ?? asReadError(error);
    }
    }, proxy.server); }
    finally { await proxy.close(); }
  }

  async stop(): Promise<void> {
    await Promise.all([...this.closers].map(close => close()));
  }
}
