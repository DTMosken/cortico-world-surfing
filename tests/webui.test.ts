import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { expect, test, vi } from 'vitest';
import type { WorldContext } from 'cortico/world.ts';
import { secretReader } from 'cortico/core/secrets.ts';
import type { WebUi, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import { h } from 'cortico/web/client/ui/dom.ts';
import { field, input } from 'cortico/web/client/ui/fields.ts';
import { button, foldSheet, msgline, pill, rowbar, sheet } from 'cortico/web/client/ui/sheet.ts';
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
    foldSheet: (id, opts) => foldSheet(doc, { get: (_, fallback) => fallback, set() {} }, signal, id, opts),
    field: (label, control) => field(doc, label, control),
    button: (text, opts) => button(doc, signal, text, opts), msgline: (text, bad) => msgline(doc, text, bad),
    pill: (text, tone) => pill(doc, text, tone), rowbar: () => rowbar(doc), input: opts => input(doc, signal, opts),
  } satisfies Pick<WebUi, 'h' | 'sheet' | 'foldSheet' | 'field' | 'button' | 'msgline' | 'pill' | 'rowbar' | 'input'>;
  const root = doc.querySelector<HTMLElement>('#root')!;
  const invoke = <T>(method: string, args: unknown[] = []) => world.webUi().invoke!('config', method, args) as Promise<T>;
  const ctx = { root, ui, signal, invoke, async refresh() {} } as WebUiPanelContext;
  try {
    await client.panels.config.mount(ctx);
    await run({ root, world, cfg, opened: () => opened, invoke, persisted, window: dom.window });
  } finally { controller.abort(); dom.window.close(); await world.stop(); rmSync(dir, { recursive: true, force: true }); }
}

test('配置面板合并全部设置，Microlink 步骤写明 API Key 的控制台路径', () => withPanel(async ({ root }) => {
  const sections = [...root.querySelectorAll('h3')].map(element => element.textContent);
  expect(sections).toEqual(['阅读与字幕', '站点搜索', '获取与缓存限制', 'Microlink 远程渲染', '如何取得 API Key']);
  expect(root.querySelectorAll('input[type=number]')).toHaveLength(10);
  expect([...root.querySelectorAll('.segwrap button')].map(button => [button.textContent, button.getAttribute('aria-pressed')]))
    .toEqual(['B站', '贴吧', '萌娘百科', '百度百科'].map(source => [source, 'true']));
  expect(root.textContent).toContain('用于 surfing_all 及其贴吧续搜，下次调用生效。');
  expect(root.querySelector('a')?.href).toBe('https://dashboard.microlink.io/signup');
  const steps = [...root.querySelectorAll('ol li')].map(element => element.textContent);
  expect(steps).toHaveLength(5);
  expect(steps[0]).toContain('注册账号并登录');
  expect(steps[1]).toContain('左侧选择「Overview」，点击「Usage」标签');
  expect(steps[2]).toContain('「Development」标签右上角的「…」，复制 API Key');
  expect(steps[3]).toContain(`${SURFING_MICROLINK_SECRET}=`);
}));

test('数值按显示单位编辑，按存储单位校验并写回', () => withPanel(async ({ root, cfg, persisted, window }) => {
  const control = (label: string) => [...root.querySelectorAll('input')].find(input => input.labels?.[0]?.textContent === label)!;
  const edit = (field: HTMLInputElement, value: string) => { field.value = value; field.dispatchEvent(new window.Event('change')); };
  const timeout = control('单次读取超时（秒）');
  expect(timeout.value).toBe('20');
  edit(timeout, '30');
  await vi.waitFor(() => expect(root.textContent).toContain('已保存：单次读取超时'));
  expect(cfg.network.requestTimeoutMs).toBe(30000);
  expect(persisted).toEqual([{ network: { requestTimeoutMs: 30000 } }]);

  const tokens = control('单次返回上限（估算 token）');
  edit(tokens, '1');
  await vi.waitFor(() => expect(root.querySelector('.msgline.bad')?.textContent).toContain('单次返回上限'));
  expect(cfg.reading.maxResponseEstimatedTokens).toBe(SURFING_DEFAULTS.reading.maxResponseEstimatedTokens);
  edit(tokens, '2048.5');
  await vi.waitFor(() => expect(tokens.value).toBe('2048'));
  expect(cfg.reading.maxResponseEstimatedTokens).toBe(2048);
  expect(root.querySelector('.msgline.bad')).toBeNull();
}));

test('站点搜索开关和条数写回配置', () => withPanel(async ({ root, cfg, persisted, window }) => {
  const source = (name: string) => [...root.querySelectorAll<HTMLButtonElement>('.segwrap button')].find(button => button.textContent === name)!;
  source('萌娘百科').click();
  await vi.waitFor(() => expect(root.textContent).toContain('已保存：萌娘百科'));
  expect(cfg.search.moegirl).toBe(false);
  expect(source('萌娘百科').getAttribute('aria-pressed')).toBe('false');
  expect(source('贴吧').getAttribute('aria-pressed')).toBe('true');
  source('贴吧').click();
  expect(source('贴吧').getAttribute('aria-pressed')).toBe('false');
  source('贴吧').click();
  expect(source('贴吧').getAttribute('aria-pressed')).toBe('true');
  await vi.waitFor(() => expect(persisted).toHaveLength(3));
  expect(cfg.search.tieba).toBe(true);
  const count = [...root.querySelectorAll('input')].find(input => input.labels?.[0]?.textContent === '每源显示条数（条）')!;
  expect(count.value).toBe('5');
  count.value = '2'; count.dispatchEvent(new window.Event('change'));
  await vi.waitFor(() => expect(root.textContent).toContain('已保存：每源显示条数'));
  expect(cfg.search.maxResults).toBe(2);
  expect(persisted).toEqual([{ search: { moegirl: false } }, { search: { tieba: false } }, { search: { tieba: true } }, { search: { maxResults: 2 } }]);
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
