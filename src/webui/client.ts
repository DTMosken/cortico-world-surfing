import type { WebUiClientBundle, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import { SURFING_CONFIG_GROUPS, SURFING_LIMITS_CONFIG_GROUP, SURFING_MICROLINK_SECRET } from '../config.ts';

interface ConfigState { values: Record<string, number>; keySet: boolean }

const errorText = (error: unknown): string => error instanceof Error ? error.message : '操作失败';

async function mount(ctx: WebUiPanelContext): Promise<void> {
  const { ui } = ctx;
  const state = await ctx.invoke<ConfigState>('state');
  const layout = ui.h('div');
  layout.style.cssText = 'display:grid;gap:20px;max-width:960px;margin:auto';
  let saves: Promise<void> = Promise.resolve();
  for (const group of SURFING_CONFIG_GROUPS) {
    const sheet = group === SURFING_LIMITS_CONFIG_GROUP
      ? ui.foldSheet('surfing-limits', { title: group.schema.title, defaultOpen: false })
      : ui.sheet({ title: group.schema.title });
    const grid = ui.h('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:16px 24px';
    const saved = ui.msgline('');
    for (const [path, property] of Object.entries(group.schema.properties)) {
      const scale = property['x-scale'] ?? 1;
      const input = ui.input({ type: 'number', value: String(state.values[path]! / scale), onChange: value => {
        saves = saves.then(async () => {
          const next = await ctx.invoke<ConfigState>('save', [path, Number(value) * scale]);
          if (input.value === value) input.value = String(next.values[path]! / scale);
          saved.textContent = `已保存：${property.title}`; saved.classList.remove('bad');
          void ctx.refresh().catch(() => undefined);
        }).catch(error => { saved.textContent = errorText(error); saved.classList.add('bad'); });
      } });
      input.min = String(property.minimum! / scale);
      input.max = String(property.maximum! / scale);
      const field = ui.field(`${property.title}（${property['x-suffix']}）`, input);
      const note = ui.h('small', 'muted', property.description);
      note.id = path;
      input.setAttribute('aria-describedby', note.id);
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
