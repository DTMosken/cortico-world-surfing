import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { expect, test, vi } from 'vitest';
import type { WorldContext } from 'cortico/world.ts';
import { secretReader } from 'cortico/core/secrets.ts';
import type { WebUi, WebUiMemo, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import { h } from 'cortico/web/client/ui/dom.ts';
import { button, foldSheet, msgline, pill, rowbar, sheet } from 'cortico/web/client/ui/sheet.ts';
import { SURFING_DEFAULTS, SURFING_MICROLINK_SECRET, type SurfingConfigSection } from '../src/config.ts';
import { SurfingWorld } from '../src/world.ts';
import client from '../src/webui/client.ts';

test('可选 Key 面板打开真实部署密钥文件、刷新编辑状态并提供注册步骤，不返回密钥', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfing-webui-'));
  const dom = new JSDOM('<div id="root"></div>');
  const doc = dom.window.document;
  const controller = new dom.window.AbortController();
  const signal = controller.signal as unknown as AbortSignal;
  let opened = '';
  const context: WorldContext<SurfingConfigSection> = {
    id: 'surfing', cfg: structuredClone(SURFING_DEFAULTS), botName: 'fixture', botDir: dir,
    dataDir: dir, packageDir: dir, repoRoot: dir, timezone: 'UTC', secret: secretReader(join(dir, '.env')),
    storeSecret() { throw new Error('Keys are edited in the file'); }, persist() {}, async restart() {},
  };
  const world = new SurfingWorld(context, undefined, async file => { opened = file; });
  const values = new Map<string, unknown>();
  const memo: WebUiMemo = { get: <T>(key: string, fallback: T) => (values.get(key) ?? fallback) as T, set: (key, value) => { values.set(key, value); } };
  const ui = {
    h: (tag, cls, text) => h(doc, tag, cls, text),
    sheet: opts => sheet(doc, opts), foldSheet: (id, opts) => foldSheet(doc, memo, signal, id, opts),
    button: (text, opts) => button(doc, signal, text, opts), msgline: (text, bad) => msgline(doc, text, bad),
    pill: (text, tone) => pill(doc, text, tone), rowbar: () => rowbar(doc),
  } satisfies Pick<WebUi, 'h' | 'sheet' | 'foldSheet' | 'button' | 'msgline' | 'pill' | 'rowbar'>;
  const root = doc.querySelector<HTMLElement>('#root')!;
  const ctx = { root, ui, invoke: <T>(method: string, args: unknown[] = []) => world.webUi().invoke!('microlink', method, args) as Promise<T>, async refresh() {} } as WebUiPanelContext;
  try {
    await client.panels.microlink.mount(ctx);
    expect(root.textContent).toContain('免 Key');
    expect(root.textContent).toContain('API Key 可选');
    expect(root.querySelector('a')?.href).toBe('https://dashboard.microlink.io/signup');
    expect(root.querySelectorAll('ol li')).toHaveLength(4);
    const findButton = (text: string) => [...root.querySelectorAll('button')].find(element => element.textContent === text)!;
    findButton('打开密钥文件').click();
    await vi.waitFor(() => expect(root.textContent).toContain('已打开密钥文件'));
    expect(readFileSync(opened, 'utf8')).toContain(`${SURFING_MICROLINK_SECRET}=\n`);
    writeFileSync(opened, `${SURFING_MICROLINK_SECRET}=fixture-credential\n`);
    findButton('刷新密钥状态').click();
    await vi.waitFor(() => expect(root.textContent).toContain('API Key 已配置'));
    expect(root.textContent).not.toContain('fixture-credential');
    expect(await ctx.invoke('state')).toEqual({ keySet: true });
    writeFileSync(opened, `${SURFING_MICROLINK_SECRET}=\n`);
    findButton('刷新密钥状态').click();
    await vi.waitFor(() => expect(root.querySelector('.pill')?.textContent).toBe('免 Key'));
  } finally { controller.abort(); dom.window.close(); await world.stop(); rmSync(dir, { recursive: true, force: true }); }
});
