import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test } from 'vitest';
import type { WorldContext } from 'cortico/world.ts';
import { PROXY_MODE_PATH, PROXY_RANGES_PATH, SURFING_DEFAULTS, validateConfig, type SurfingConfigSection } from '../src/config.ts';
import { PublicClient, type Address } from '../src/network.ts';
import { SurfingWorld } from '../src/world.ts';

const PAGE = '<main><p>页面正在加载</p><p id="text"></p></main><script>fetch("/data").then(r=>r.json()).then(d=>document.querySelector("#text").textContent=d.text)</script>';

function context(): WorldContext<SurfingConfigSection> {
  const cfg = structuredClone(SURFING_DEFAULTS);
  return { id: 'surfing', cfg, timezone: 'UTC', botName: 'test', botDir: '.', packageDir: '.', dataDir: '.', repoRoot: '.',
    secret: () => '', storeSecret() {}, async restart() {},
    persist(patch) { for (const [section, values] of Object.entries(patch)) Object.assign(cfg[section as keyof SurfingConfigSection] as object, values); } };
}

async function withWorld(run: (panel: {
  ctx: WorldContext<SurfingConfigSection>; requests: string[];
  read: (path: string, host?: string) => Promise<{ text: string; failed?: boolean }>;
  save: (path: string, value: unknown) => Promise<unknown>;
}) => Promise<void>): Promise<void> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url!);
    const port = (server.address() as AddressInfo).port;
    if (request.url === '/data') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ text: '动态正文已经加载。' })); return; }
    if (request.url === '/to-allowed') { response.writeHead(302, { location: `http://next.example.org:${port}/` }).end(); return; }
    if (request.url === '/to-denied') { response.writeHead(302, { location: `http://denied.example.org:${port}/` }).end(); return; }
    response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(PAGE);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const dns: Record<string, Address[]> = { 'denied.example.org': [{ address: '10.0.0.1', family: 4 }] };
  const client = new PublicClient(async hostname => dns[hostname] ?? [{ address: '127.0.0.1', family: 4 }]);
  const ctx = context();
  const world = new SurfingWorld(ctx, client);
  const tool = world.tools().find(candidate => candidate.name === 'surfing_read_page')!;
  try {
    await run({ ctx, requests,
      read: async (path, host = 'example.org') => await tool.handler({ url: `http://${host}:${(server.address() as AddressInfo).port}${path}` }, {} as never) as { text: string; failed?: boolean },
      save: (path, value) => world.webUi().invoke!('config', 'save', [path, value]) });
  } finally { await world.stop(); server.close(); }
}

test('开关对下一次读取生效，开启后的网页经过静态读取和 Chromium 渲染', () => withWorld(async ({ read, save, requests }) => {
  await save(PROXY_RANGES_PATH, '127.0.0.0/8');
  expect(await read('/page')).toMatchObject({ failed: true, text: '[tool failed] 域名未解析到允许的公网地址。' });
  expect(requests).toEqual([]);

  await save(PROXY_MODE_PATH, true);
  const page = await read('/page');
  expect(page.failed).toBeUndefined();
  expect(page.text).toContain('动态正文已经加载。');
  expect(page.text).not.toMatch(/代理|127\.0\.0/);
  expect(requests).toEqual(expect.arrayContaining(['/page', '/data']));

  requests.length = 0;
  await save(PROXY_MODE_PATH, false);
  expect((await read('/page', 'again.example.org')).failed).toBe(true);
  expect(requests).toEqual([]);
}));

test('开启后每次跳转都重新核对地址', () => withWorld(async ({ read, save, requests }) => {
  await save(PROXY_MODE_PATH, true);
  await save(PROXY_RANGES_PATH, '127.0.0.0/8');
  expect((await read('/to-allowed')).text).toContain('动态正文已经加载。');
  requests.length = 0;
  expect((await read('/to-denied')).text).toContain('[tool failed] 这个网址解析到了未放行的内网或保留地址');
  expect(requests).toEqual(['/to-denied']);
}));

test('无效范围不写入配置，保存错误指出行号', () => withWorld(async ({ ctx, save }) => {
  await save(PROXY_RANGES_PATH, '172.19.0.0/16');
  await expect(save(PROXY_RANGES_PATH, '172.19.0.0/16\n192.0.2.1')).rejects.toThrow('第 2 行');
  expect(ctx.cfg.network.customProxyRanges).toBe('172.19.0.0/16');
}));

test('旧配置缺少新字段时按关闭处理，手改的无效范围在启动检查时报告', () => {
  const ctx = context();
  ctx.cfg.network = { maxDownloadBytes: 1048576, requestTimeoutMs: 3000 } as SurfingConfigSection['network'];
  new SurfingWorld(ctx);
  expect(ctx.cfg.network).toEqual({ maxDownloadBytes: 1048576, requestTimeoutMs: 3000, proxyCompatibility: false, customProxyRanges: '' });
  ctx.cfg.network.customProxyRanges = 'bad';
  expect(() => validateConfig(ctx.cfg)).toThrow('第 1 行');
});
