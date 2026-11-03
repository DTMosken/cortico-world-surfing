import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { expect, test, vi } from 'vitest';
import type { WorldContext } from 'cortico/world.ts';
import { secretReader } from 'cortico/core/secrets.ts';
import type { WebUi, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import { h } from 'cortico/web/client/ui/dom.ts';
import { input } from 'cortico/web/client/ui/fields.ts';
import { button, msgline, pill, rowbar, sheet } from 'cortico/web/client/ui/sheet.ts';
import { SURFING_DEFAULTS, SURFING_MICROLINK_SECRET, type SurfingConfigSection } from '../src/config.ts';
import { SurfingWorld } from '../src/world.ts';
import client from '../src/webui/client.ts';

async function withPanel(run: (panel: {
  root: HTMLElement; world: SurfingWorld; cfg: SurfingConfigSection; opened: () => string;
  invoke: WebUiPanelContext['invoke']; persisted: unknown[]; window: JSDOM['window'];
}) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'surfing-webui-'));
  const dom = new JSDOM('<div id="root"></div>');
  const doc = dom.window.document;
  const controller = new dom.window.AbortController();
  const signal = controller.signal as unknown as AbortSignal;
  const cfg = structuredClone(SURFING_DEFAULTS);
  const persisted: unknown[] = [];
  let opened = '';
  const context: WorldContext<SurfingConfigSection> = {
    id: 'surfing', cfg, botName: 'fixture', botDir: dir,
    dataDir: dir, packageDir: dir, repoRoot: dir, timezone: 'UTC', secret: secretReader(join(dir, '.env')),
    storeSecret() { throw new Error('Keys are edited in the file'); },
    persist(patch) {
      persisted.push(patch);
      for (const [section, values] of Object.entries(patch)) Object.assign(cfg[section as keyof SurfingConfigSection] as object, values);
    },
    async restart() {},
  };
  const world = new SurfingWorld(context, undefined, async file => { opened = file; });
  const ui = {
    h: (tag, cls, text) => h(doc, tag, cls, text),
    sheet: opts => sheet(doc, opts),
    button: (text, opts) => button(doc, signal, text, opts), msgline: (text, bad) => msgline(doc, text, bad),
    pill: (text, tone) => pill(doc, text, tone), rowbar: () => rowbar(doc), input: opts => input(doc, signal, opts),
  } satisfies Pick<WebUi, 'h' | 'sheet' | 'button' | 'msgline' | 'pill' | 'rowbar' | 'input'>;
  const root = doc.querySelector<HTMLElement>('#root')!;
  const invoke = <T>(method: string, args: unknown[] = []) => world.webUi().invoke!('config', method, args) as Promise<T>;
  const ctx = { root, ui, invoke, async refresh() {} } as WebUiPanelContext;
  try {
    await client.panels.config.mount(ctx);
    await run({ root, world, cfg, opened: () => opened, invoke, persisted, window: dom.window });
  } finally { controller.abort(); dom.window.close(); await world.stop(); rmSync(dir, { recursive: true, force: true }); }
}

test('配置面板合并全部设置，Microlink 步骤写明 API Key 的控制台路径', () => withPanel(async ({ root }) => {
  const sections = [...root.querySelectorAll('.tsection')].map(element => element.textContent);
  expect(sections).toEqual(['阅读返回量', '获取与缓存限制', 'Microlink 远程渲染（可选）']);
  expect(root.querySelectorAll('.trow')).toHaveLength(9);
  expect(root.querySelector('a')?.href).toBe('https://dashboard.microlink.io/signup');
  const steps = [...root.querySelectorAll('ol li')].map(element => element.textContent);
  expect(steps).toHaveLength(5);
  expect(steps[0]).toContain('注册账号并登录');
  expect(steps[1]).toContain('左侧选择「Overview」，点击「Usage」标签');
  expect(steps[2]).toContain('「Development」标签右上角的「…」，复制 API Key');
  expect(steps[3]).toContain(`${SURFING_MICROLINK_SECRET}=`);
}));

test('数值按显示单位编辑，按存储单位校验并写回', () => withPanel(async ({ root, cfg, persisted, window }) => {
  const row = (title: string) => [...root.querySelectorAll('.trow')].find(element => element.querySelector('.tlabel')?.textContent === title)!;
  const edit = (field: HTMLInputElement, value: string) => { field.value = value; field.dispatchEvent(new window.Event('change')); };
  const timeout = row('单次读取超时').querySelector('input')!;
  expect(timeout.value).toBe('20');
  expect(row('单次读取超时').querySelector('.tunit')?.textContent).toBe('秒');
  edit(timeout, '30');
  await vi.waitFor(() => expect(root.textContent).toContain('已保存：单次读取超时'));
  expect(cfg.network.requestTimeoutMs).toBe(30000);
  expect(persisted).toEqual([{ network: { requestTimeoutMs: 30000 } }]);

  const tokens = row('单次返回上限').querySelector('input')!;
  edit(tokens, '1');
  await vi.waitFor(() => expect(root.querySelector('.msgline.bad')?.textContent).toContain('单次返回上限'));
  expect(cfg.reading.maxResponseEstimatedTokens).toBe(SURFING_DEFAULTS.reading.maxResponseEstimatedTokens);
  edit(tokens, '2048.5');
  await vi.waitFor(() => expect(tokens.value).toBe('2048'));
  expect(cfg.reading.maxResponseEstimatedTokens).toBe(2048);
  expect(root.querySelector('.msgline.bad')).toBeNull();
}));

test('保存只接受声明过的配置项', () => withPanel(async ({ invoke, cfg, persisted }) => {
  await expect(invoke('save', ['worlds.surfing.enabled', true])).rejects.toThrow('未知配置项');
  await expect(invoke('save', [42, 1])).rejects.toThrow('未知配置项');
  expect(cfg.enabled).toBe(false);
  expect(persisted).toEqual([]);
}));

test('打开真实部署密钥文件并刷新编辑状态，不返回密钥', () => withPanel(async ({ root, opened, invoke }) => {
  const findButton = (text: string) => [...root.querySelectorAll('button')].find(element => element.textContent === text)!;
  expect(root.querySelector('.pill')?.textContent).toBe('免 Key');
  findButton('打开密钥文件').click();
  await vi.waitFor(() => expect(root.textContent).toContain('已打开密钥文件'));
  expect(readFileSync(opened(), 'utf8')).toContain(`${SURFING_MICROLINK_SECRET}=\n`);
  writeFileSync(opened(), `${SURFING_MICROLINK_SECRET}=fixture-credential\n`);
  findButton('刷新密钥状态').click();
  await vi.waitFor(() => expect(root.querySelector('.pill')?.textContent).toBe('API Key 已配置'));
  expect(root.textContent).not.toContain('fixture-credential');
  expect(JSON.stringify(await invoke('state'))).not.toContain('fixture-credential');
  expect(await invoke<{ keySet: boolean }>('state')).toMatchObject({ keySet: true });
  writeFileSync(opened(), `${SURFING_MICROLINK_SECRET}=\n`);
  findButton('刷新密钥状态').click();
  await vi.waitFor(() => expect(root.querySelector('.pill')?.textContent).toBe('免 Key'));
}));
