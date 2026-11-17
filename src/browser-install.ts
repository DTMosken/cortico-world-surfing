import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export interface BrowserInstallState {
  status: 'missing' | 'installing' | 'ready' | 'failed';
  log: string;
  progress?: { label: string; percent?: number; totalMiB?: number };
  error?: { message: string; hint?: string };
}

function installError(log: string): BrowserInstallState['error'] {
  const windowsLibraries = [...new Set(log.match(/\b[\w.-]+\.dll\b/gi) ?? [])];
  if (windowsLibraries.length && /Host system is missing dependencies/i.test(log)) {
    const hints = [];
    if (/Universal C Runtime|Visual C\+\+|vcruntime|msvcp140|api-ms-win-crt/i.test(log)) hints.push('安装 Microsoft Visual C++ Redistributable（x64）：https://support.microsoft.com/help/2977003');
    if (/Media Foundation|\b(?:mf|mfplat|msmpeg2vdec|evr|avrt)\.dll/i.test(log)) hints.push('Windows N 安装媒体功能包；Windows Server 请在管理员 PowerShell 运行：\nInstall-WindowsFeature Server-Media-Foundation');
    return { message: `缺少 Windows 运行库：${windowsLibraries.slice(0, 4).join('、')}。`, hint: hints.join('\n') || '补齐列出的运行库后重试。' };
  }
  if (/Host system is missing dependencies|Missing libraries:|Missing system dependencies required|error while loading shared libraries|cannot open shared object file|Missing shared library/i.test(log)) {
    const libraries = [...new Set(log.match(/\blib[\w.+-]+\.so(?:\.\d+)*/g) ?? [])];
    return { message: `缺少 Chromium 运行所需的系统库${libraries.length ? `：${libraries.slice(0, 4).join('、')}` : ''}。`,
      hint: '在此扩展目录的命令行运行（需要管理员权限）：\npnpm exec playwright install-deps chromium\n安装完成后重试。该命令适用于 Playwright 支持的 Debian / Ubuntu。' };
  }
  if (/Chromium sandboxing failed|No usable sandbox|Running as root without --no-sandbox|Failed to move to new namespace|Failed to unshare|SUID sandbox|(?:user namespace|userns).*?(?:disabled|denied|not permitted|AppArmor)/i.test(log)) {
    return { message: 'Chromium 沙箱无法启动。',
      hint: '使用非 root 用户运行 Cortico，并确认系统允许非特权用户创建用户命名空间；若被 AppArmor 拒绝，请管理员为浏览器配置对应策略。Docker 还需使用允许 clone、setns、unshare 的 seccomp 配置。\n配置方法：https://playwright.dev/docs/docker#crawling-and-scraping\n调整后重试。' };
  }
  if (/Executable doesn't exist at/i.test(log)) return undefined;
  const lines = log.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const reason = lines.find(line => /(?:error:|EACCES|ENOSPC|ENOTFOUND|ECONN|ETIMEDOUT|Download unavailable)/i.test(line)
    && !/^(?:Error: )?Failed to install browsers/.test(line)) ?? lines.at(-1);
  return { message: (reason ?? '浏览器安装未完成。').replace(/^Error:\s*/, '').slice(0, 300) };
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
      error => { this.current = { status: 'missing', log: String(error), error: installError(String(error)) }; },
    );
    await this.initial;
    return { ...this.current };
  }

  async install(): Promise<BrowserInstallState> {
    await this.state();
    if (this.current.status === 'installing' || this.current.status === 'ready') return { ...this.current };
    this.current = { status: 'installing', log: '', progress: { label: '正在准备下载…' } };
    const append = (text: string): void => { this.current.log = (this.current.log + text).slice(-8000); };
    let component = 'Chromium Headless Shell';
    const readLine = (line: string): void => {
      const download = line.match(/^Downloading (.+?) from /);
      if (download) {
        component = download[1].replace(/\s+\(playwright.*$/, '');
        this.current.progress = { label: `正在下载 ${component}` };
      }
      const progress = line.match(/\|\s+(\d+)% of ([\d.]+) MiB/);
      if (progress) {
        const percent = Number(progress[1]);
        this.current.progress = percent === 100 ? { label: `正在安装 ${component}…` }
          : { label: `正在下载 ${component}`, percent, totalMiB: Number(progress[2]) };
      }
      if (line.includes(' downloaded to ')) this.current.progress = { label: '正在完成安装…' };
    };
    let pending = '';
    const stdout = (text: string): void => {
      append(text);
      const lines = (pending + text).split(/\r?\n/);
      pending = lines.pop()!;
      for (const line of lines) readLine(line);
    };
    const fail = (fallback: string): void => {
      this.current.status = 'failed';
      this.current.progress = undefined;
      this.current.error = installError(this.current.log) ?? { message: fallback };
    };
    const child = spawn(this.command[0], this.command.slice(1), {
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      env: { ...process.env, FORCE_COLOR: '0', PLAYWRIGHT_DOWNLOAD_NO_PROGRESS: '0', npm_config_loglevel: 'info' },
    });
    child.stdout.setEncoding('utf8').on('data', stdout);
    child.stderr.setEncoding('utf8').on('data', append);
    child.once('error', error => { append(error.message); fail(error.message); });
    child.once('close', async code => {
      if (this.current.status === 'failed') return;
      if (pending) readLine(pending);
      if (code !== 0) {
        append(`\n安装进程退出：${code}`);
        fail(`安装进程退出：${code}`);
        return;
      }
      this.current.progress = { label: '正在检查浏览器…' };
      try { await this.probe(); this.current = { status: 'ready', log: this.current.log }; }
      catch (error) {
        append(`\n${String(error)}`);
        this.current = { status: 'failed', log: this.current.log, error: installError(String(error)) ?? { message: '浏览器安装后仍无法启动。' } };
      }
    });
    return { ...this.current };
  }
}
