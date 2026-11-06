import type { WebUiClientBundle, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import { PROXY_MODE_PATH, PROXY_RANGES_PATH, SURFING_CONFIG_GROUPS, SURFING_LIMITS_CONFIG_GROUP, SURFING_MICROLINK_SECRET, SURFING_PROXY_CONFIG_GROUP } from '../config.ts';

type ConfigValue = number | boolean | string;
interface ConfigState { values: Record<string, ConfigValue>; keySet: boolean }

const errorText = (error: unknown): string => error instanceof Error ? error.message : '操作失败';
const showPressed = (toggle: HTMLButtonElement, enabled: boolean): void => {
  toggle.classList.toggle('active', enabled);
  toggle.setAttribute('aria-pressed', String(enabled));
};

async function mount(ctx: WebUiPanelContext): Promise<void> {
  const { ui } = ctx;
  const state = await ctx.invoke<ConfigState>('state');
  const layout = ui.h('div');
  layout.style.cssText = 'display:grid;gap:20px;max-width:960px;margin:auto';
  let saves: Promise<void> = Promise.resolve();
  const saveValue = (path: string, title: string, saved: HTMLElement, value: ConfigValue, apply?: (next: ConfigValue) => void): void => {
    saves = saves.then(async () => {
      const next = (await ctx.invoke<ConfigState>('save', [path, value])).values[path]!;
      apply?.(next);
      saved.textContent = `已保存：${title}`; saved.classList.remove('bad');
      void ctx.refresh().catch(() => undefined);
    }).catch(error => { saved.textContent = errorText(error); saved.classList.add('bad'); });
  };
  const proxySheet = (): HTMLElement => {
    const { schema } = SURFING_PROXY_CONFIG_GROUP;
    const mode = schema.properties[PROXY_MODE_PATH]!;
    const ranges = schema.properties[PROXY_RANGES_PATH]!;
    const sheet = ui.sheet({ title: schema.title, desc: schema.description });
    const saved = ui.msgline('');
    const toggle = ui.h('input', 'connection-switch');
    toggle.type = 'checkbox';
    toggle.setAttribute('role', 'switch');
    toggle.checked = state.values[PROXY_MODE_PATH] === true;
    toggle.addEventListener('click', event => {
      event.preventDefault();
      saveValue(PROXY_MODE_PATH, mode.title, saved, toggle.checked, next => { toggle.checked = next === true; });
    }, { signal: ctx.signal });
    const note = ui.h('small', 'muted', mode.description);
    note.id = 'surfing-proxy-mode-note';
    toggle.setAttribute('aria-describedby', note.id);
    const field = ui.field(mode.title, toggle);
    field.classList.add('connection-toggle');
    field.querySelector<HTMLElement>('.fieldlabel')!.style.color = 'var(--warn)';
    const row = ui.h('div', 'connection-step');
    row.append(field, note);

    const advanced = ui.foldSheet('surfing-proxy-advanced', { title: '高级设置', defaultOpen: false });
    const rangesSaved = ui.msgline('');
    const input = ui.textarea({ cls: 'mono', rows: 4, value: String(state.values[PROXY_RANGES_PATH]),
      onChange: value => saveValue(PROXY_RANGES_PATH, ranges.title, rangesSaved, value) });
    const rangesNote = ui.h('small', 'muted', ranges.description);
    rangesNote.id = 'surfing-proxy-ranges-note';
    input.setAttribute('aria-describedby', rangesNote.id);
    const rangesField = ui.field(ranges.title, input);
    rangesField.querySelector<HTMLElement>('.fieldlabel')!.style.color = 'var(--warn)';
    advanced.body.append(rangesField, rangesNote, rangesSaved);
    sheet.body.append(row, saved, advanced.el);
    return sheet.el;
  };
  for (const group of SURFING_CONFIG_GROUPS) {
    if (group === SURFING_PROXY_CONFIG_GROUP) { layout.append(proxySheet()); continue; }
    const sheet = group === SURFING_LIMITS_CONFIG_GROUP
      ? ui.foldSheet('surfing-limits', { title: group.schema.title, defaultOpen: false })
      : ui.sheet({ title: group.schema.title });
    const grid = ui.h('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:16px 24px';
    const saved = ui.msgline('');
    const toggles = ui.h('div', 'segwrap umulti');
    toggles.style.flexWrap = 'wrap';
    for (const [path, property] of Object.entries(group.schema.properties)) {
      const save = (value: number | boolean, apply?: (next: ConfigValue) => void): void => saveValue(path, property.title, saved, value, apply);
      if (property.type === 'boolean') {
        const toggle = ui.h('button', 'seg', property.title);
        toggle.type = 'button';
        toggle.style.whiteSpace = 'nowrap';
        showPressed(toggle, state.values[path] === true);
        toggle.addEventListener('click', () => {
          const value = !toggle.classList.contains('active');
          showPressed(toggle, value);
          save(value);
        }, { signal: ctx.signal });
        toggles.append(toggle);
        continue;
      }
      const note = ui.h('small', 'muted', property.description);
      note.id = path;
      const scale = property['x-scale'] ?? 1;
      const input = ui.input({ type: 'number', value: String(Number(state.values[path]) / scale), onChange: value => {
        save(Number(value) * scale, next => { if (input.value === value) input.value = String(Number(next) / scale); });
      } });
      input.min = String(property.minimum! / scale);
      input.max = String(property.maximum! / scale);
      input.setAttribute('aria-describedby', note.id);
      const row = ui.h('div');
      row.append(ui.field(`${property.title}（${property['x-suffix']}）`, input), note);
      grid.append(row);
    }
    if (toggles.children.length) {
      const caption = ui.h('span', 'fieldlabel', '来源');
      caption.id = `${group.id}:sources`;
      toggles.setAttribute('role', 'group');
      toggles.setAttribute('aria-labelledby', caption.id);
      const note = ui.h('small', 'muted', group.schema.description);
      note.id = `${group.id}:sources-note`;
      toggles.setAttribute('aria-describedby', note.id);
      const field = ui.h('div', 'fieldrow');
      field.append(caption, toggles);
      const row = ui.h('div');
      row.append(field, note);
      grid.append(row);
    }
    sheet.body.append(grid, saved);
    layout.append(sheet.el);
  }

  const anchor = (text: string, href: string): HTMLAnchorElement => {
    const link = ui.h('a', null, text);
    link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    return link;
  };
  const keyStatus = ui.msgline('');
  let keyPill = ui.pill('', 'off');
  const showKey = (keySet: boolean): void => {
    const next = ui.pill(keySet ? 'API Key 已配置' : '免 Key', keySet ? 'on' : 'off');
    keyPill.replaceWith(next); keyPill = next;
  };
  async function keyAction(run: () => Promise<string>): Promise<void> {
    try { keyStatus.textContent = await run(); keyStatus.classList.remove('bad'); }
    catch (error) { keyStatus.textContent = errorText(error); keyStatus.classList.add('bad'); }
  }
  const keyBar = ui.rowbar();
  keyBar.append(keyPill,
    ui.button('打开密钥文件', { onClick: () => { void keyAction(async () => { await ctx.invoke('openKeyFile'); return '已打开密钥文件'; }); } }),
    ui.button('刷新密钥状态', { onClick: () => { void keyAction(async () => {
      showKey((await ctx.invoke<ConfigState>('state')).keySet);
      void ctx.refresh().catch(() => undefined);
      return '已刷新密钥状态';
    }); } }), keyStatus);
  showKey(state.keySet);

  const steps = ui.h('ol');
  steps.style.cssText = 'list-style:decimal;padding-left:24px;margin:6px 0;line-height:1.8';
  const secret = ui.h('code', 'mono', `${SURFING_MICROLINK_SECRET}=`);
  for (const parts of [
    ['打开', anchor('Microlink 注册页', 'https://dashboard.microlink.io/signup'), '，注册账号并登录，无需购买付费套餐。'],
    ['在控制台左侧选择「Overview」，点击「Usage」标签。'],
    ['点击「Development」标签右上角的「…」，复制 API Key。'],
    ['点击「打开密钥文件」，将 Key 填在 ', secret, ' 后面，不加引号，保存文件。'],
    ['保存后，下次远程读取使用该 Key 的额度。点击「刷新密钥状态」可查看配置状态。清空 Key 的值并保存可恢复免 Key 调用。'],
  ]) {
    const step = ui.h('li');
    step.append(...parts);
    steps.append(step);
  }
  const limits = ui.h('p', 'muted');
  limits.append('免 Key 和免费 Key 的额度不同，当前限制见', anchor('Microlink 额度说明', 'https://microlink.io/docs/api/basics/rate-limit'), '。');
  const microlink = ui.sheet({
    title: 'Microlink 远程渲染',
    desc: '本机 Chromium 不可用时，将网页 URL 交给 Microlink 渲染。API Key 可选，留空使用免 Key 额度。',
  });
  const help = ui.foldSheet('surfing-microlink-key', { title: '如何取得 API Key', defaultOpen: false });
  help.body.append(steps, limits);
  microlink.body.append(keyBar, help.el);
  layout.append(microlink.el);
  ctx.root.replaceChildren(layout);
}

export default { panels: { config: { mount } } } satisfies WebUiClientBundle;
