import qrcode from 'qrcode-generator';
import { SURFING_BILI_SECRET } from './config.ts';
import { ReadError, type ReadOperation } from './network.ts';

export interface BiliLoginState {
  kind: 'anonymous' | 'unverified' | 'logged_in' | 'waiting_scan' | 'waiting_confirm' | 'qr_expired' | 'expired';
  username?: string; qrImage?: string;
}
interface SecretStore { secret(name: string): string | undefined; storeSecret(name: string, value: string): void }
const PASSPORT = 'https://passport.bilibili.com/x/passport-login/web/qrcode/';

function session(value: unknown): string | undefined {
  return typeof value === 'string' && /^[\x21-\x3a\x3c-\x7e]+$/.test(value) ? value : undefined;
}

/** Credentials stay in the deployment secret store; panel state contains no session values. */
export class BiliLogin {
  private sessdata?: string;
  private current: BiliLoginState;
  private pending?: { key: string; image: string };
  private revision = 0;

  constructor(private readonly secrets: SecretStore) {
    const stored = secrets.secret(SURFING_BILI_SECRET);
    try { this.sessdata = session(stored ? JSON.parse(stored).SESSDATA : undefined); }
    catch { /* Invalid stored credentials require a new login. */ }
    this.current = { kind: this.sessdata ? 'unverified' : stored && stored !== '{}' ? 'expired' : 'anonymous' };
  }

  state(): BiliLoginState { return { ...this.current }; }

  async cookie(operation: ReadOperation): Promise<string | undefined> {
    if (!this.sessdata || this.current.kind === 'expired') return undefined;
    const cookie = 'SESSDATA=' + this.sessdata;
    const revision = this.revision;
    const { data, code } = await this.json(operation, 'https://api.bilibili.com/x/web-interface/nav', cookie);
    if (revision !== this.revision) return undefined;
    if (code === -101 || data?.isLogin === false) { this.expire(); return undefined; }
    if (code !== 0 || data?.isLogin !== true) throw new ReadError('access_denied', 'B站未允许本次登录状态验证。');
    if (!this.pending) this.current = { kind: 'logged_in', ...(typeof data.uname === 'string' ? { username: data.uname } : {}) };
    return cookie;
  }

  expire(cookie?: string): void {
    if (cookie && cookie !== 'SESSDATA=' + this.sessdata) return;
    this.current = { kind: 'expired' }; this.sessdata = undefined;
  }

  async start(operation: ReadOperation): Promise<BiliLoginState> {
    const revision = ++this.revision;
    this.pending = undefined;
    this.current = { kind: this.sessdata ? 'unverified' : 'anonymous' };
    const { data, code } = await this.json(operation, PASSPORT + 'generate');
    if (code !== 0 || typeof data?.qrcode_key !== 'string' || typeof data.url !== 'string')
      throw new ReadError('protocol_error', 'B站未返回可用的登录二维码。');
    let address: URL;
    try { address = new URL(data.url); }
    catch { throw new ReadError('protocol_error', 'B站登录二维码地址无效。'); }
    if (address.protocol !== 'https:' || address.hostname !== 'account.bilibili.com' || address.username || address.password || address.port)
      throw new ReadError('protocol_error', 'B站登录二维码地址无效。');
    const qr = qrcode(0, 'M'); qr.addData(address.href); qr.make();
    const image = 'data:image/svg+xml;base64,' + Buffer.from(qr.createSvgTag({ cellSize: 6, margin: 24, scalable: true })).toString('base64');
    operation.signal.throwIfAborted();
    if (revision !== this.revision) return this.state();
    this.pending = { key: data.qrcode_key, image };
    this.current = { kind: 'waiting_scan', qrImage: image };
    return this.state();
  }

  async poll(operation: ReadOperation): Promise<BiliLoginState> {
    const pending = this.pending;
    if (!pending) { await this.cookie(operation); return this.state(); }
    const { data, code, cookies } = await this.json(operation, PASSPORT + 'poll?qrcode_key=' + encodeURIComponent(pending.key));
    operation.signal.throwIfAborted();
    if (this.pending !== pending) return this.state();
    if (code !== 0 || typeof data?.code !== 'number') throw new ReadError('protocol_error', 'B站登录查询响应无效。');
    if (data.code === 86101 || data.code === 86090) {
      this.current = { kind: data.code === 86101 ? 'waiting_scan' : 'waiting_confirm', qrImage: pending.image };
    } else if (data.code === 86038) {
      this.pending = undefined; this.current = { kind: 'qr_expired' };
    } else if (data.code === 0) {
      const raw = cookies?.map(value => value.split(';', 1)[0]).find(value => value.startsWith('SESSDATA='));
      const value = session(raw?.slice('SESSDATA='.length));
      if (!value) throw new ReadError('protocol_error', '扫码已确认，但平台未返回登录凭证。');
      this.save(JSON.stringify({ SESSDATA: value }));
      this.pending = undefined; this.revision++; this.sessdata = value; this.current = { kind: 'unverified' };
      await this.cookie(operation);
    } else throw new ReadError('access_denied', 'B站未允许本次扫码登录。');
    return this.state();
  }

  logout(): BiliLoginState {
    this.save('{}');
    this.revision++; this.pending = undefined; this.sessdata = undefined; this.current = { kind: 'anonymous' };
    return this.state();
  }

  cancel(): void {
    this.revision++;
    if (!this.pending) return;
    this.pending = undefined;
    this.current = { kind: this.sessdata ? 'unverified' : 'anonymous' };
  }

  private save(value: string): void {
    try { this.secrets.storeSecret(SURFING_BILI_SECRET, value); }
    catch { throw new ReadError('access_denied', '无法更新本机登录凭证，请检查部署目录的写入权限。'); }
  }

  private async json(operation: ReadOperation, url: string, cookie?: string) {
    const response = await operation.get(url, {
      allowHost: host => host === 'passport.bilibili.com' || host === 'api.bilibili.com', followRedirects: false,
      headers: { referer: 'https://www.bilibili.com/' }, biliCookie: cookie, receiveBiliCookies: url.startsWith(PASSPORT + 'poll?'),
    });
    if (response.status !== 200) throw new ReadError('access_denied', `B站登录请求失败（HTTP ${response.status}）。`);
    try {
      const result = JSON.parse(response.body.toString('utf8'));
      if (!result || typeof result !== 'object' || typeof result.code !== 'number') throw new Error();
      return { code: result.code as number, data: result.data as Record<string, unknown> | undefined, cookies: response.biliCookies };
    } catch { throw new ReadError('protocol_error', 'B站登录响应无法解析。'); }
  }
}
