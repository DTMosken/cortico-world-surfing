import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export interface BrowserInstallState {
  status: 'missing' | 'installing' | 'ready' | 'failed';
  log: string;
}

async function probeBrowser(): Promise<void> {
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: 10000 });
  await browser.close();
}

/** Installation belongs to the server user and continues when the panel closes. */
export class BrowserInstaller {
  private current: BrowserInstallState = { status: 'missing', log: '' };
  private initial?: Promise<void>;

  constructor(
    private readonly probe = probeBrowser,
    private readonly command = [process.execPath, fileURLToPath(new URL('../scripts/install-browser.mjs', import.meta.url))],
  ) {}

  async state(): Promise<BrowserInstallState> {
    this.initial ??= this.probe().then(
      () => { this.current = { status: 'ready', log: '' }; },
      error => { this.current = { status: 'missing', log: String(error) }; },
    );
    await this.initial;
    return { ...this.current };
  }

  async install(): Promise<BrowserInstallState> {
    await this.state();
    if (this.current.status === 'installing' || this.current.status === 'ready') return { ...this.current };
    this.current = { status: 'installing', log: '' };
    const append = (text: string): void => { this.current.log = (this.current.log + text).slice(-8000); };
    const child = spawn(this.command[0], this.command.slice(1), {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    child.stdout.setEncoding('utf8').on('data', append);
    child.stderr.setEncoding('utf8').on('data', append);
    child.once('error', error => { append(error.message); this.current.status = 'failed'; });
    child.once('close', async code => {
      if (this.current.status === 'failed') return;
      if (code !== 0) {
        append(`\n安装进程退出：${code}`);
        this.current.status = 'failed';
        return;
      }
      try { await this.probe(); this.current.status = 'ready'; }
      catch (error) { append(`\n${String(error)}`); this.current.status = 'failed'; }
    });
    return { ...this.current };
  }
}
