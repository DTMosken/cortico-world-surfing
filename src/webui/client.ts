import type { WebUiClientBundle, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import { SURFING_CONFIG_GROUPS, SURFING_MICROLINK_SECRET } from '../config.ts';

interface ConfigState { values: Record<string, number>; keySet: boolean }

const errorText = (error: unknown): string => error instanceof Error ? error.message : '操作失败';

async function mount(ctx: WebUiPanelContext): Promise<void> {
  const { ui } = ctx;
  const state = await ctx.invoke<ConfigState>('state');
  const sheet = ui.sheet({ title: '配置', en: 'config', desc: '修改后自动保存，无需重启。' });

  const saved = ui.msgline('');
  let saves: Promise<void> = Promise.resolve();
  for (const group of SURFING_CONFIG_GROUPS) {
    sheet.body.append(ui.h('div', 'tsection', group.schema.title));
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
      const field = ui.h('div', 'tfield');
      field.append(input, ui.h('span', 'tunit', property['x-suffix']));
      const row = ui.h('div', 'trow');
      row.append(ui.h('span', 'tlabel', property.title), field, ui.h('span', 'tdesc', property.description));
      sheet.body.append(row);
    }
  }
  sheet.body.append(saved);

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
    ['点击「刷新密钥状态」，状态变为「API Key 已配置」。清空 Key 的值并保存可恢复免 Key 调用。'],
  ]) {
    const step = ui.h('li');
    step.append(...parts);
    steps.append(step);
  }
  const limits = ui.h('div', 'tsecdesc');
  limits.append('免 Key 和免费 Key 的额度不同，当前限制见', anchor('Microlink 额度说明', 'https://microlink.io/docs/api/basics/rate-limit'), '。');
  sheet.body.append(
    ui.h('div', 'tsection', 'Microlink 远程渲染（可选）'),
    ui.h('div', 'tsecdesc', '本机 Chromium 不可用时，将网页 URL 交给 Microlink 渲染。API Key 可选：留空使用免 Key 接口，配置后使用该 Key 的额度，下次远程读取生效。'),
    keyBar, ui.h('div', 'tsecdesc', '取得 API Key：'), steps, limits,
  );
  ctx.root.replaceChildren(sheet.el);
}

export default { panels: { config: { mount } } } satisfies WebUiClientBundle;
