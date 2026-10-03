import type { ConsoleClientBundle } from 'cortico/web/shared/client-panel.ts';
import type { BiliLoginState } from '../bili-login.ts';

const labels: Record<BiliLoginState['kind'], string> = {
  anonymous: '未登录，使用匿名读取', unverified: '登录状态待验证', logged_in: '已登录',
  waiting_scan: '等待扫码', waiting_confirm: '请在手机上确认登录', qr_expired: '二维码已过期，请重新生成',
  expired: '登录已失效，使用匿名读取；请重新登录',
};

export default {
  panels: {
    login: {
      async mount(ctx) {
        const { ui } = ctx;
        const card = ui.sheet({ title: 'B站登录' });
        const status = ui.msgline('正在读取登录状态');
        const image = ui.h('img');
        image.alt = 'B站登录二维码'; image.width = 240; image.height = 240; image.hidden = true;
        image.style.maxWidth = '100%';
        const help = ui.h('p', null, '用 B站 App 扫码并确认。凭证保存在本机部署中，退出登录会清除凭证。');
        const actions = ui.actions();
        const start = ui.button('扫码登录', { variant: 'primary', onClick: () => void run('start') });
        const logout = ui.button('退出登录', { onClick: () => void run('logout') });
        actions.append(start, logout);
        card.body.append(status, image, help, actions); ctx.root.append(card.el);
        let state: BiliLoginState = { kind: 'anonymous' };
        let busy = false;

        async function run(method: string) {
          if (busy || ctx.signal.aborted) return;
          busy = true; start.disabled = logout.disabled = true;
          try {
            const next = await ctx.invoke<BiliLoginState>(method);
            if (ctx.signal.aborted) return;
            state = next;
            status.textContent = labels[next.kind] + (next.username ? '：' + next.username : '');
            status.classList.remove('bad');
            image.hidden = !next.qrImage;
            if (next.qrImage) image.src = next.qrImage; else image.removeAttribute('src');
            start.textContent = next.qrImage ? '重新生成二维码' : '扫码登录';
          } catch (error) {
            if (!ctx.signal.aborted) {
              status.textContent = error instanceof Error ? error.message : '登录操作失败。';
              status.classList.add('bad');
            }
          } finally { busy = false; start.disabled = logout.disabled = false; }
        }

        await run('state');
        ctx.interval(() => void run(state.qrImage ? 'poll' : 'state'), 2000);
      },
    },
  },
} satisfies ConsoleClientBundle;
