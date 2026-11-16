import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { BrowserContext } from 'playwright';
import { ReadError } from './network.ts';

const require = createRequire(import.meta.url);
const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'));

/** PDF.js and its fonts are served locally; the document cannot fetch remote resources. */
export async function renderPdf(context: BrowserContext, bytes: Uint8Array, number: number, maxDimension: number, visual: boolean) {
  const origin = 'https://surfing.invalid';
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { await route.abort(); return; }
    if (url.pathname === '/') {
      await route.fulfill({ contentType: 'text/html', body: '<!doctype html><canvas></canvas><script type="module">import * as pdfjs from "/build/pdf.mjs"; globalThis.pdfjs = pdfjs;</script>' });
    } else if (/^\/(build|cmaps|standard_fonts|wasm)\/[\w.-]+$/.test(url.pathname)) {
      const body = await readFile(join(pdfRoot, url.pathname.slice(1)));
      await route.fulfill({ contentType: url.pathname.endsWith('.mjs') ? 'text/javascript'
        : url.pathname.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream', body });
    } else await route.abort();
  });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 0 });
  await page.waitForFunction(() => 'pdfjs' in globalThis, undefined, { timeout: 0 });
  const result = await page.evaluate(async ({ data, number, maxDimension, visual }) => {
    const pdfjs = (globalThis as unknown as { pdfjs: typeof import('pdfjs-dist') }).pdfjs;
    pdfjs.GlobalWorkerOptions.workerSrc = '/build/pdf.worker.mjs';
    let doc;
    try {
      doc = await pdfjs.getDocument({
        data: Uint8Array.from(atob(data), char => char.charCodeAt(0)),
        cMapUrl: '/cmaps/', cMapPacked: true, standardFontDataUrl: '/standard_fonts/', wasmUrl: '/wasm/',
        isEvalSupported: false,
      }).promise;
      if (number > doc.numPages) return { error: `PDF 共 ${doc.numPages} 页，请提供范围内的页码。` };
      const pdfPage = await doc.getPage(number);
      const content = await pdfPage.getTextContent();
      const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
      let image: string | undefined;
      if (visual) {
        const original = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: maxDimension / Math.max(original.width, original.height) });
        const canvas = document.querySelector('canvas')!;
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        await pdfPage.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
        image = canvas.toDataURL('image/png').split(',')[1];
      }
      return { pages: doc.numPages as number, text, image };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    } finally { await doc?.destroy(); }
  }, { data: Buffer.from(bytes).toString('base64'), number, maxDimension, visual });
  if (result.error) throw new ReadError('content_unavailable', `PDF 读取失败：${result.error}`);
  return { pages: result.pages!, text: result.text!, image: result.image ? Buffer.from(result.image, 'base64') : undefined };
}
