import { expect, test } from 'vitest';
import { SURFING_DEFAULTS } from '../src/config.ts';
import { PageReader, type PageReadOptions } from '../src/page-reader.ts';
import { SnapshotCache } from '../src/snapshots.ts';
import { png, pdfFixture, visualOperation } from './visual-fixture.ts';

const url = 'https://example.org/document';
const options: PageReadOptions = { mode: 'visual', page: 1, maxImageDimension: 800 };
const imageSize = (bytes: Uint8Array) => ({ width: Buffer.from(bytes).readUInt32BE(16), height: Buffer.from(bytes).readUInt32BE(20) });

test('图片直链按文件内容识别，缓存回执保留原图且按字节计入缓存', async () => {
  const reader = new PageReader();
  const operation = visualOperation({ [url]: { body: png, type: 'application/octet-stream' } });
  try {
    const material = await reader.read(url, operation, 10000);
    const cache = new SnapshotCache();
    const config = structuredClone(SURFING_DEFAULTS);
    const cursor = cache.put(material, config);
    const result = cache.read(cursor, material.key, config);
    expect(result.blobs?.[0]).toMatchObject({ mime: 'image/png' });
    expect(Buffer.from((result.blobs![0] as { bytes: Uint8Array }).bytes)).toEqual(png);
    expect(cache.sizeBytes).toBeGreaterThan(png.length);
    expect(result.text).toContain('本次附带一张图片');
    expect(cache.read(cursor, material.key, config).blobs).toEqual(result.blobs);
    config.cache.maxBytes = png.length;
    expect(() => cache.put(material, config)).toThrow('缓存上限');
    await expect(reader.read(url, operation, 10000, { ...options, mode: 'text' })).rejects.toThrow('图片直链');
  } finally { await reader.stop(); }
});

test('网页截图加载图片，按屏读取得到不同画面', async () => {
  const reader = new PageReader();
  const operation = visualOperation({
    [url]: { type: 'text/html', body: '<style>body{margin:0}section{height:600px}img{width:200px;height:200px}</style><section style="background:red"><img src="/picture"></section><section style="background:blue"></section>' },
    'https://example.org/picture': { type: 'image/png', body: png },
  });
  try {
    const first = await reader.read(url, operation, 100000, options);
    const second = await reader.read(url, operation, 100000, { ...options, page: 2 });
    expect(first.scope).toMatchObject({ extraction: 'screenshot', page: 1, pages: 2, y: 0 });
    expect(second.scope).toMatchObject({ page: 2, y: 600 });
    expect(imageSize(first.image!.bytes)).toEqual({ width: 800, height: 600 });
    expect(Buffer.from(first.image!.bytes).equals(Buffer.from(second.image!.bytes))).toBe(false);
    expect(operation.requests).toContain('https://example.org/picture');
    await expect(reader.read(url, operation, 100000, { ...options, page: 3 })).rejects.toThrow('共 2 屏');
  } finally { await reader.stop(); }
});

test('Canvas 无正文时 auto 返回画面，text 不返回图片', async () => {
  const reader = new PageReader();
  const operation = visualOperation({ [url]: { type: 'text/html', body: '<canvas></canvas><script>const c=document.querySelector("canvas").getContext("2d");c.fillStyle="green";c.fillRect(0,0,300,150)</script>' } });
  try {
    const result = await reader.read(url, operation, 100000, { ...options, mode: 'auto' });
    expect(result.scope.extraction).toBe('screenshot');
    expect(result.image!.bytes.byteLength).toBeGreaterThan(100);
    await expect(reader.read(url, operation, 100000, { ...options, mode: 'text' })).rejects.toThrow();
  } finally { await reader.stop(); }
});

test('PDF 按页渲染，文字和无文字页面都保留图片，缓存原件可离线翻页', async () => {
  const reader = new PageReader();
  const source = pdfFixture();
  const operation = visualOperation({ [url]: { type: 'application/octet-stream', body: source } });
  try {
    const first = await reader.read(url, operation, 100000, options);
    expect(first.units).toEqual([{ kind: 'text', text: 'Page One' }]);
    expect(first.scope).toMatchObject({ kind: 'pdf', page: 1, pages: 2 });
    expect(imageSize(first.image!.bytes)).toEqual({ width: 800, height: 800 });
    const cache = new SnapshotCache();
    const config = structuredClone(SURFING_DEFAULTS);
    const ref = cache.put(first, config);
    expect(cache.sizeBytes).toBeGreaterThan(source.length + first.image!.bytes.byteLength);
    const saved = cache.source(ref, config);
    const offline = visualOperation({});
    const second = await reader.read(saved.url, offline, 100000, { ...options, page: 2 }, saved.pdf);
    expect(second.units).toEqual([{ kind: 'text', text: '本页未提取到文字。' }]);
    expect(Buffer.from(first.image!.bytes).equals(Buffer.from(second.image!.bytes))).toBe(false);
    expect(offline.requests).toEqual([]);
    const text = await reader.read(url, offline, 100000, { ...options, mode: 'text' }, saved.pdf);
    expect(text.image).toBeUndefined();
    expect(text.units).toEqual(first.units);
    await expect(reader.read(url, offline, 100000, { ...options, page: 3 }, saved.pdf)).rejects.toThrow('共 2 页');
  } finally { await reader.stop(); }
});

test('无效 PDF 返回格式错误，取消截图会终止浏览器上下文', async () => {
  const reader = new PageReader();
  try {
    await expect(reader.read(url, visualOperation({ [url]: { type: 'application/pdf', body: 'invalid' } }), 10000, options)).rejects.toThrow('PDF');
    const controller = new AbortController();
    const operation = visualOperation({ [url]: { type: 'text/html', body: '<canvas></canvas>' } }, controller.signal);
    const reading = reader.read(url, operation, 10000, options);
    controller.abort();
    await expect(reading).rejects.toThrow();
  } finally { await reader.stop(); }
});
