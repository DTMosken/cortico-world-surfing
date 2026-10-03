import { mkdtempSync, readFileSync, writeFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { secretReader } from 'cortico/core/secrets.ts';
import { h } from 'cortico/web/client/ui/dom.ts';
import { sheet, actions, button, msgline } from 'cortico/web/client/ui/sheet.ts';
import type { ConsolePanelContext, ConsoleUi } from 'cortico/web/shared/client-panel.ts';
import type { WorldContext } from 'cortico/world.ts';
import { BiliLogin } from '../src/bili-login.ts';
import { SURFING_DEFAULTS, SURFING_BILI_SECRET, type SurfingConfigSection } from '../src/config.ts';
import { SurfingWorld } from '../src/world.ts';
import bundle from '../src/console/client.ts';
import { PublicClient, type GetOptions, type PublicResponse } from '../src/network.ts';
import { PlatformFixture } from './platform-fixture.ts';

const files: string[] = [];
beforeEach(() => vi.stubEnv(SURFING_BILI_SECRET, ''));
afterEach(() => {
  vi.unstubAllEnvs();
  for (const file of files.splice(0)) { rmSync(join(file, '.env'), { force: true }); rmdirSync(file); }
});
function store(initial = '{}') {
  const dir = mkdtempSync(join(tmpdir(), 'surfing-login-')); files.push(dir);
  const file = join(dir, '.env');
  writeFileSync(file, `${SURFING_BILI_SECRET}=${initial}\nCORTICO_FIXTURE_OTHER=fixture-other\n`);
  return {
    secret: secretReader(file),
    storeSecret(name: string, value: string) {
      const lines = readFileSync(file, 'utf8').split('\n').filter(line => !line.startsWith(name + '=') && line);
      writeFileSync(file, [name + '=' + value, ...lines, ''].join('\n'));
    },
  };
}
class LoginFixture extends PlatformFixture {
  codes = [86101, 86090, 0];
  omitSession = false;
  pollGate?: Promise<void>;
  constructor() { super(); this.acceptedSession = 'fixture-session'; }
  override async get(url: string, options: GetOptions = {}): Promise<PublicResponse> {
    const target = new URL(url);
    if (target.pathname.endsWith('/qrcode/generate')) return { url, status: 200, headers: {}, body: Buffer.from(JSON.stringify({
      code: 0, data: { url: 'https://account.bilibili.com/h5/account-h5/auth/scan-web?key=fixture-key', qrcode_key: 'fixture-key' },
    })) };
    if (target.pathname.endsWith('/qrcode/poll')) {
      await this.pollGate;
      const code = this.codes.length > 1 ? this.codes.shift()! : this.codes[0];
      return { url, status: 200, headers: {}, body: Buffer.from(JSON.stringify({ code: 0, data: { code } })),
        ...(code === 0 && !this.omitSession && options.receiveBiliCookies
          ? { biliCookies: ['SESSDATA=fixture-session; Domain=.bilibili.com; HttpOnly; Secure'] } : {}),
      };
    }
    return super.get(url, options);
  }
}

test('扫码、手机确认和本机持久化后，重建登录对象仍可读取账号状态', async () => {
  const secrets = store(); const fixture = new LoginFixture(); const login = new BiliLogin(secrets);
  expect((await login.start(fixture)).kind).toBe('waiting_scan');
  expect(login.state().qrImage).toMatch(/^data:image\/svg\+xml;base64,/);
  expect((await login.poll(fixture)).kind).toBe('waiting_scan');
  expect((await login.poll(fixture)).kind).toBe('waiting_confirm');
  expect(await login.poll(fixture)).toEqual({ kind: 'logged_in', username: '测试用户' });
  expect(JSON.parse(secrets.secret(SURFING_BILI_SECRET)).SESSDATA).toBe(fixture.acceptedSession);
  expect(secrets.secret(SURFING_BILI_SECRET)).not.toMatch(/\s/);
  const restored = new BiliLogin(secrets);
  expect(await restored.cookie(fixture)).toBe('SESSDATA=' + fixture.acceptedSession);
  expect(restored.state().kind).toBe('logged_in');
  expect(JSON.stringify(login.state())).not.toMatch(/fixture-session|SESSDATA|qrcode_key/);
});

test('退出清除持久凭证，后面的环境变量不会被当作登录态', () => {
  const secrets = store(JSON.stringify({ SESSDATA: 'fixture-session' }));
  const login = new BiliLogin(secrets);
  expect(login.logout()).toEqual({ kind: 'anonymous' });
  expect(secrets.secret(SURFING_BILI_SECRET)).toBe('{}');
  expect(new BiliLogin(secrets).state()).toEqual({ kind: 'anonymous' });
  expect(secrets.secret('CORTICO_FIXTURE_OTHER')).toBe('fixture-other');
});

test('二维码过期后允许重新生成，不保存等待状态为登录凭证', async () => {
  const secrets = store(); const fixture = new LoginFixture(); fixture.codes = [86038];
  const login = new BiliLogin(secrets); await login.start(fixture);
  expect(await login.poll(fixture)).toEqual({ kind: 'qr_expired' });
  expect(secrets.secret(SURFING_BILI_SECRET)).toBe('{}');
  expect((await login.start(fixture)).kind).toBe('waiting_scan');
});

test('确认登录但缺少凭证时失败，保留重新扫码入口', async () => {
  const secrets = store(); const fixture = new LoginFixture(); fixture.codes = [0]; fixture.omitSession = true;
  const login = new BiliLogin(secrets); await login.start(fixture);
  await expect(login.poll(fixture)).rejects.toMatchObject({ kind: 'protocol_error' });
  expect(secrets.secret(SURFING_BILI_SECRET)).toBe('{}');
  expect((await login.start(fixture)).kind).toBe('waiting_scan');
});

test('退出期间迟到的扫码成功响应不能重新保存凭证', async () => {
  const secrets = store(); const fixture = new LoginFixture(); fixture.codes = [0];
  let finish!: () => void; fixture.pollGate = new Promise(resolve => { finish = resolve; });
  const login = new BiliLogin(secrets); await login.start(fixture);
  const pending = login.poll(fixture);
  login.logout(); finish();
  expect(await pending).toEqual({ kind: 'anonymous' });
  expect(new BiliLogin(secrets).state()).toEqual({ kind: 'anonymous' });
});

test('无法保存凭证时不给出登录已完成的状态', async () => {
  const secrets = store(); const fixture = new LoginFixture(); fixture.codes = [0];
  const login = new BiliLogin({ ...secrets, storeSecret() { throw new Error('fixture permission denied'); } });
  await login.start(fixture);
  await expect(login.poll(fixture)).rejects.toMatchObject({ kind: 'access_denied', message: expect.stringContaining('无法更新本机登录凭证') });
  expect(login.state().kind).toBe('waiting_scan');
  expect(secrets.secret(SURFING_BILI_SECRET)).toBe('{}');
});

test('损坏或带头部控制字符的保存值不作为 Cookie 使用', async () => {
  for (const value of ['invalid-json', JSON.stringify({ SESSDATA: 'bad\r\nheader' })]) {
    const login = new BiliLogin(store(value));
    expect(await login.cookie(new LoginFixture())).toBeUndefined();
    expect(login.state().kind).toBe('expired');
  }
});

test('World 停用时取消扫码但保留凭证，面板仍可退出并清除凭证', async () => {
  const secrets = store(JSON.stringify({SESSDATA:'fixture-session'})); const fixture = new LoginFixture();
  class FixtureClient extends PublicClient { override operation() { return fixture; } }
  const world = new SurfingWorld({ ...secrets, id:'surfing', cfg:structuredClone(SURFING_DEFAULTS), timezone:'UTC', botName:'test',
    botDir:'.', packageDir:'.', dataDir:'.', repoRoot:'.', persist(){}, async restart(){} }, new FixtureClient());
  await world.console().invoke!('login','start',[]);
  await world.stop(); fixture.offline = true;
  expect(await world.console().invoke!('login','state',[])).toEqual({kind:'unverified'});
  expect(JSON.parse(secrets.secret(SURFING_BILI_SECRET)).SESSDATA).toBe(fixture.acceptedSession);
  expect(await world.console().invoke!('login','logout',[])).toEqual({kind:'anonymous'});
  expect(secrets.secret(SURFING_BILI_SECRET)).toBe('{}');
});

test('登录面板展示扫码、确认、登录和退出；卸载后不再请求', async () => {
  const secrets = store(); const fixture = new LoginFixture(); fixture.codes = [86090, 0];
  class FixtureClient extends PublicClient { override operation() { return fixture; } }
  const context = { ...secrets, id:'surfing', cfg:structuredClone(SURFING_DEFAULTS), timezone:'UTC', botName:'test',
    botDir:'.', packageDir:'.', dataDir:'.', repoRoot:'.', persist(){}, async restart(){} } satisfies WorldContext<SurfingConfigSection>;
  const world = new SurfingWorld(context, new FixtureClient());
  const dom = new JSDOM('<main></main>'); const doc = dom.window.document;
  const life = new dom.window.AbortController(); const root = doc.querySelector('main')!;
  const ui = { h:(tag,cls,text)=>h(doc,tag,cls,text), sheet:opts=>sheet(doc,opts), actions:()=>actions(doc),
    button:(label,opts)=>button(doc,life.signal,label,opts), msgline:(text,bad)=>msgline(doc,text,bad) } as ConsoleUi;
  let tick:()=>void = ()=>{};
  let calls = 0;
  const panel: Pick<ConsolePanelContext, 'root' | 'ui' | 'signal' | 'invoke' | 'interval'> = {
    root, ui, signal:life.signal,
    invoke<T>(method:string){calls++;return world.console().invoke!('login',method,[]) as Promise<T>},
    interval(fn:()=>void){tick=fn;return{dispose(){}}},
  };
  try {
    await bundle.panels.login.mount(panel as ConsolePanelContext);
    expect(root.textContent).toContain('未登录');
    root.querySelector<HTMLButtonElement>('button')!.click();
    await vi.waitFor(()=>expect(root.textContent).toContain('等待扫码'));
    expect(root.querySelector('img')?.hidden).toBe(false);
    expect(root.querySelector('img')?.src).toMatch(/^data:image\/svg\+xml;base64,/);
    tick(); await vi.waitFor(()=>expect(root.textContent).toContain('请在手机上确认登录'));
    tick(); await vi.waitFor(()=>expect(root.textContent).toContain('已登录：测试用户'));
    expect(root.querySelector('img')?.hidden).toBe(true);
    expect(root.innerHTML).not.toContain(fixture.acceptedSession);
    root.querySelectorAll<HTMLButtonElement>('button')[1].click();
    await vi.waitFor(()=>expect(root.textContent).toContain('未登录'));
    expect(secrets.secret(SURFING_BILI_SECRET)).toBe('{}');
    const count = calls; life.abort(); tick();
    await new Promise(resolve=>setTimeout(resolve,20)); expect(calls).toBe(count);
  } finally { life.abort(); dom.window.close(); await world.stop(); }
});
