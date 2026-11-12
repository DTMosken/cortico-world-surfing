import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { expect, test, vi } from 'vitest';
import type { WorldContext } from 'cortico/world.ts';
import { secretReader } from 'cortico/core/secrets.ts';
import type { WebUi, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import { h } from 'cortico/web/client/ui/dom.ts';
import { field, input, textarea } from 'cortico/web/client/ui/fields.ts';
import { button, foldSheet, msgline, pill, rowbar, sheet } from 'cortico/web/client/ui/sheet.ts';
import { SURFING_DEFAULTS, type SurfingConfigSection } from '../src/config.ts';
import { SurfingWorld } from '../src/world.ts';
import client from '../src/webui/client.ts';

async function withPanel(run: (panel: {
  root: HTMLElement; world: SurfingWorld; cfg: SurfingConfigSection;
  invoke: WebUiPanelContext['invoke']; persisted: unknown[]; window: JSDOM['window']; failSaves: (failing: boolean) => void;
}) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'surfing-webui-'));
  const dom = new JSDOM('<div id="root"></div>');
  const doc = dom.window.document;
  const controller = new dom.window.AbortController();
  const signal = controller.signal as unknown as AbortSignal;
  const cfg = structuredClone(SURFING_DEFAULTS);
  const persisted: unknown[] = [];
  let failing = false;
  const context: WorldContext<SurfingConfigSection> = {
    id: 'surfing', cfg, botName: 'fixture', botDir: dir,
    dataDir: dir, packageDir: dir, repoRoot: dir, timezone: 'UTC', secret: secretReader(join(dir, '.env')),
    storeSecret(name, value) { writeFileSync(join(dir, '.env'), `${name}=${value}\n`); },
    persist(patch) {
      for (const [section, values] of Object.entries(patch)) Object.assign(cfg[section as keyof SurfingConfigSection] as object, values);
      if (failing) throw new Error('配置文件无法写入。');
      persisted.push(patch);
    },
    async restart() {},
  };
  const world = new SurfingWorld(context);
  const ui = {
    h: (tag, cls, text) => h(doc, tag, cls, text),
    sheet: opts => sheet(doc, opts),
    foldSheet: (id, opts) => foldSheet(doc, { get: (_, fallback) => fallback, set() {} }, signal, id, opts),
    field: (label, control) => field(doc, label, control),
    button: (text, opts) => button(doc, signal, text, opts), msgline: (text, bad) => msgline(doc, text, bad),
    pill: (text, tone) => pill(doc, text, tone), rowbar: () => rowbar(doc), input: opts => input(doc, signal, opts),
    textarea: opts => textarea(doc, signal, opts),
  } satisfies Pick<WebUi, 'h' | 'sheet' | 'foldSheet' | 'field' | 'button' | 'msgline' | 'pill' | 'rowbar' | 'input' | 'textarea'>;
  const root = doc.querySelector<HTMLElement>('#root')!;
  const invoke = <T>(method: string, args: unknown[] = []) => world.webUi().invoke!('config', method, args) as Promise<T>;
  const ctx = { root, ui, signal, invoke, async refresh() {} } as WebUiPanelContext;
  try {
    await client.panels.config.mount(ctx);
    await run({ root, world, cfg, invoke, persisted, window: dom.window, failSaves: next => { failing = next; } });
  } finally { controller.abort(); dom.window.close(); await world.stop(); rmSync(dir, { recursive: true, force: true }); }
}

test('配置面板合并全部设置，Microlink 步骤写明 API Key 的控制台路径', () => withPanel(async ({ root }) => {
  const sections = [...root.querySelectorAll('h3')].map(element => element.textContent);
  expect(sections).toEqual(['阅读与字幕', '站点搜索', '代理', '高级设置', '获取与缓存限制', 'Microlink 远程渲染', '如何取得 API Key']);
  expect(root.querySelectorAll('input[type=number]')).toHaveLength(10);
  expect([...root.querySelectorAll('[aria-labelledby="world:surfing:search:sources"] button')].map(button => [button.textContent, button.getAttribute('aria-pressed')]))
    .toEqual(['B站', '贴吧', '萌娘百科', '百度百科', '缩写释义'].map(source => [source, 'true']));
  expect(root.textContent).toContain('用于 surfing_search_all 及其贴吧续搜，下次调用生效。');
  expect(root.querySelector('a')?.href).toBe('https://dashboard.microlink.io/signup');
  const steps = [...root.querySelectorAll('ol li')].map(element => element.textContent);
  expect(steps).toHaveLength(4);
  expect(steps[0]).toContain('注册账号并登录');
  expect(steps[1]).toContain('左侧选择「Overview」，点击「Usage」标签');
  expect(steps[2]).toContain('「Development」标签右上角的「…」，复制 API Key');
  expect(steps[3]).toContain('输入框');
}));

test('代理兼容模式默认关闭，保存成功后才显示开启，失败时保持原状态', () => withPanel(async ({ root, cfg, failSaves }) => {
  expect(root.textContent).toContain('正在使用 Clash 等代理？');
  expect(root.textContent).toContain('可能包括本机或内网服务');
  const toggle = root.querySelector<HTMLInputElement>('.connection-step input[role=switch]')!;
  const message = () => toggle.closest('.sheet')!.querySelector('.msgline')!;
  expect(toggle.labels?.[0]?.textContent).toBe('代理兼容模式');
  expect(toggle.getAttribute('aria-describedby')).toBe('surfing-proxy-mode-note');
  expect(toggle.checked).toBe(false);

  failSaves(true);
  toggle.click();
  await vi.waitFor(() => expect(message().textContent).toBe('配置文件无法写入。'));
  expect(message().classList.contains('bad')).toBe(true);
  expect(toggle.checked).toBe(false);
  expect(cfg.network.proxyCompatibility).toBe(false);

  failSaves(false);
  toggle.click();
  expect(toggle.checked).toBe(false);
  await vi.waitFor(() => expect(message().textContent).toBe('已保存：代理兼容模式'));
  expect(toggle.checked).toBe(true);
  expect(cfg.network.proxyCompatibility).toBe(true);

  failSaves(true);
  toggle.click();
  await vi.waitFor(() => expect(message().classList.contains('bad')).toBe(true));
  expect(toggle.checked).toBe(true);
  expect(cfg.network.proxyCompatibility).toBe(true);
}));

test('自定义地址范围默认为空，无效内容提示行号且不写入', () => withPanel(async ({ root, cfg, persisted, window, failSaves }) => {
  const box = root.querySelector('textarea')!;
  const message = () => box.closest('details')!.querySelector('.msgline')!;
  const edit = (value: string) => { box.value = value; box.dispatchEvent(new window.Event('change')); };
  expect(box.closest('details')?.open).toBe(false);
  expect(box.value).toBe('');
  edit('172.19.0.0/16\n代理');
  await vi.waitFor(() => expect(message().textContent).toContain('第 2 行'));
  expect(message().classList.contains('bad')).toBe(true);
  expect(persisted).toEqual([]);
  edit('172.19.0.0/16\nfd00:1234::/64');
  await vi.waitFor(() => expect(message().textContent).toBe('已保存：自定义地址范围（可选）'));
  expect(cfg.network.customProxyRanges).toBe('172.19.0.0/16\nfd00:1234::/64');
  expect(cfg.network.proxyCompatibility).toBe(false);
  failSaves(true);
  edit('10.0.0.0/8');
  await vi.waitFor(() => expect(message().textContent).toBe('配置文件无法写入。'));
  expect(cfg.network.customProxyRanges).toBe('172.19.0.0/16\nfd00:1234::/64');
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

test('保存 Microlink 密钥后清空输入框，状态只显示是否已配置', () => withPanel(async ({ root, invoke }) => {
  const input = root.querySelector<HTMLInputElement>('input[type=password]')!;
  input.value = 'fixture-credential';
  [...root.querySelectorAll('button')].find(button => button.textContent === '保存密钥')!.click();
  await vi.waitFor(() => expect(root.querySelector('.pill')?.textContent).toBe('API Key 已配置'));
  expect(input.value).toBe('');
  expect(JSON.stringify(await invoke('saveKey', ['']))).not.toContain('fixture-credential');
  expect(await invoke('state')).toMatchObject({ keySet: true });
}));
