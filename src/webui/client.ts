import type { WebUiClientBundle, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import { SURFING_MICROLINK_SECRET } from '../config.ts';

async function mount(ctx: WebUiPanelContext): Promise<void> {
  const { ui } = ctx;
  const sheet = ui.sheet({ title: 'Microlink（可选）' });
  sheet.el.style.cssText = 'max-width:960px;margin:auto';
  sheet.body.append(ui.h('p', null, '网页先提取静态正文，再尝试本机 Chromium；本机浏览器不可用时，将网页 URL 交给 Microlink 远程渲染。'));
  sheet.body.append(ui.h('p', null, 'API Key 可选。留空使用免 Key 接口；配置后使用该 Key 的额度。保存后下次远程读取生效。'));
  const buttons = ui.rowbar();
  const status = ui.msgline('');
  let keyStatus = ui.pill('免 Key', 'off');
  async function refresh(): Promise<void> {
    const state = await ctx.invoke<{ keySet: boolean }>('state');
    const next = ui.pill(state.keySet ? 'API Key 已配置' : '免 Key', state.keySet ? 'on' : 'off');
    keyStatus.replaceWith(next); keyStatus = next;
    await ctx.refresh();
  }
  async function action(method: string): Promise<void> {
    try {
      if (method === 'openKeyFile') {
        await ctx.invoke(method); status.textContent = '已打开密钥文件';
      } else { await refresh(); status.textContent = '已刷新密钥状态'; }
      status.classList.remove('bad');
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '操作失败'; status.classList.add('bad');
    }
  }
  buttons.append(keyStatus,
    ui.button('打开密钥文件', { onClick: () => { void action('openKeyFile'); } }),
    ui.button('刷新密钥状态', { onClick: () => { void action('state'); } }), status);
  sheet.body.append(buttons);
  const help = ui.foldSheet('surfing-microlink-registration', { title: '如何取得可选 API Key', defaultOpen: false });
  const link = ui.h('a', null, '注册 Microlink 账号');
  link.href = 'https://dashboard.microlink.io/signup'; link.target = '_blank'; link.rel = 'noopener noreferrer';
  const steps = ui.h('ol');
  steps.style.cssText = 'padding-left:24px;line-height:1.8';
  for (const text of [
    '打开注册链接，按页面提示注册并登录。',
    '在 Microlink 控制台取得并复制免费 API Key，无需购买付费套餐。',
    `点击「打开密钥文件」，将 Key 填在 ${SURFING_MICROLINK_SECRET}= 后面，不加引号，保存文件。`,
    '点击「刷新密钥状态」查看配置状态。删除 Key 的值并保存即可恢复免 Key 调用。',
  ]) steps.append(ui.h('li', null, text));
  const limits = ui.h('a', null, 'Microlink 额度说明');
  limits.href = 'https://microlink.io/docs/api/basics/rate-limit'; limits.target = '_blank'; limits.rel = 'noopener noreferrer';
  help.body.append(link, steps, limits);
  sheet.body.append(help.el);
  ctx.root.replaceChildren(sheet.el);
  await refresh();
}

export default { panels: { microlink: { mount } } } satisfies WebUiClientBundle;
