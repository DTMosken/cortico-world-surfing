import { Worker } from 'node:worker_threads';
import { ReadError, asReadError, type FailureKind } from './errors.ts';
import { validatePublicUrl, type ReadOperation } from './network.ts';
import { Renderer } from './renderer.ts';
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
  private readonly renderer = new Renderer();

  async read(input: string, operation: ReadOperation, maxBytes: number): Promise<Material> {
    const original = validatePublicUrl(input);
    this.rejectVideo(original);
    const response = await operation.get(original.href);
    if (response.status !== 200) throw new ReadError(response.status === 404 ? 'not_found' : 'access_denied', '网页未允许本次公开读取。');
    const target = validatePublicUrl(response.url);
    if (!target.hash) target.hash = original.hash;
    this.rejectVideo(target);
    const type = response.headers['content-type']?.toLowerCase() ?? '';
    const charset = type.match(/charset\s*=\s*["']?([^\s;"']+)/)?.[1] ?? 'utf-8';
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
    try { material = await extract(html, target.href, operation.signal); }
    catch (error) {
      if (!(error instanceof ReadError) || error.kind !== 'content_unavailable') throw error;
      const rendered = await this.renderer.render(target.href, operation, maxBytes);
      material = await extract(rendered.html, rendered.url, operation.signal);
      material.scope.extraction = 'rendered-html';
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
