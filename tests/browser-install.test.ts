import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { BrowserInstaller } from '../src/browser-install.ts';

test('并发安装共用一个下载进程，安装后浏览器可启动', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfing-install-'));
  const ready = join(dir, 'ready');
  const starts = join(dir, 'starts');
  const script = join(dir, 'installer.cjs');
  writeFileSync(script, String.raw`const fs = require('node:fs');
fs.appendFileSync(process.argv[2], 'start\n');
console.log('Downloading headless shell');
setTimeout(() => { fs.writeFileSync(process.argv[3], 'ready'); }, 100);
`);
  const installer = new BrowserInstaller(async () => { if (!existsSync(ready)) throw new Error('Missing browser'); },
    [process.execPath, script, starts, ready]);
  try {
    expect((await installer.state()).status).toBe('missing');
    const states = await Promise.all([installer.install(), installer.install()]);
    expect(states.map(state => state.status)).toEqual(['installing', 'installing']);
    await vi.waitFor(async () => expect((await installer.state()).status).toBe('ready'));
    expect(readFileSync(starts, 'utf8')).toBe('start\n');
    expect((await installer.state()).log).toContain('Downloading headless shell');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('下载失败保留日志，重试后重新确认浏览器可启动', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfing-install-'));
  const ready = join(dir, 'ready');
  const script = join(dir, 'installer.cjs');
  writeFileSync(script, "console.error('Download unavailable'); process.exitCode = 1;");
  const installer = new BrowserInstaller(async () => { if (!existsSync(ready)) throw new Error('Missing browser'); },
    [process.execPath, script, ready]);
  try {
    await installer.install();
    await vi.waitFor(async () => expect((await installer.state()).status).toBe('failed'));
    expect((await installer.state()).log).toContain('Download unavailable');
    expect((await installer.state()).error?.message).toContain('Download unavailable');
    writeFileSync(script, "require('node:fs').writeFileSync(process.argv[2], 'ready');");
    expect((await installer.install()).error).toBeUndefined();
    await vi.waitFor(async () => expect((await installer.state()).status).toBe('ready'));
    expect((await installer.state()).error).toBeUndefined();
    expect((await installer.state()).progress).toBeUndefined();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('下载成功但浏览器缺少系统库时仍显示失败原因', async () => {
  const installer = new BrowserInstaller(async () => { throw new Error('Missing shared library'); },
    [process.execPath, '-e', 'process.exitCode = 0']);
  await installer.install();
  await vi.waitFor(async () => expect((await installer.state()).status).toBe('failed'));
  expect((await installer.state()).log).toContain('Missing shared library');
  expect((await installer.state()).error?.hint).toContain('pnpm exec playwright install-deps chromium');
});

test('分块下载输出显示当前组件进度，辅助组件重新计数，下载后等待启动检查', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfing-progress-'));
  const ready = join(dir, 'ready');
  const script = join(dir, 'installer.cjs');
  let finishProbe!: () => void;
  const checking = new Promise<void>(resolve => { finishProbe = resolve; });
  writeFileSync(script, String.raw`const fs = require('node:fs');
const path = require('node:path');
const dir = process.argv[2];
const gate = name => new Promise(resolve => {
  const timer = setInterval(() => { if (fs.existsSync(path.join(dir, name))) { clearInterval(timer); resolve(); } }, 10);
});
(async () => {
  console.log('Downloading Chromium Headless Shell 1 (playwright chromium-headless-shell v1) from https://example.org/browser.zip');
  process.stdout.write('|■■■■| 40% of 12');
  await gate('complete-line');
  console.log('0 MiB');
  await gate('download-complete');
  console.log('|■■■■■■■■| 100% of 120 MiB');
  await gate('next-component');
  console.log('Chromium Headless Shell downloaded to fixture');
  console.log('Downloading FFmpeg (playwright ffmpeg v1) from https://example.org/helper.zip');
  console.log('|■| 10% of 2 MiB');
  await gate('finish');
  fs.writeFileSync(path.join(dir, 'ready'), 'ready');
})();
`);
  const installer = new BrowserInstaller(async () => {
    if (!existsSync(ready)) throw new Error("Executable doesn't exist at fixture");
    await checking;
  }, [process.execPath, script, dir]);
  try {
    expect((await installer.state()).error).toBeUndefined();
    await installer.install();
    await vi.waitFor(async () => expect((await installer.state()).log).toContain('40% of 12'));
    expect((await installer.state()).progress).toEqual({ label: '正在下载 Chromium Headless Shell 1' });
    writeFileSync(join(dir, 'complete-line'), '');
    await vi.waitFor(async () => expect((await installer.state()).progress).toMatchObject({ percent: 40, totalMiB: 120 }));
    writeFileSync(join(dir, 'download-complete'), '');
    await vi.waitFor(async () => expect((await installer.state()).progress).toEqual({ label: '正在安装 Chromium Headless Shell 1…' }));
    writeFileSync(join(dir, 'next-component'), '');
    await vi.waitFor(async () => expect((await installer.state()).progress).toEqual({ label: '正在下载 FFmpeg', percent: 10, totalMiB: 2 }));
    writeFileSync(join(dir, 'finish'), '');
    await vi.waitFor(async () => expect((await installer.state()).progress).toEqual({ label: '正在检查浏览器…' }));
    expect((await installer.state()).status).toBe('installing');
    finishProbe();
    await vi.waitFor(async () => expect((await installer.state()).status).toBe('ready'));
    expect((await installer.state()).progress).toBeUndefined();
  } finally {
    finishProbe();
    for (const name of ['complete-line', 'download-complete', 'next-component', 'finish']) writeFileSync(join(dir, name), '');
    await vi.waitFor(async () => expect((await installer.state()).status).toBe('ready'));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('已下载浏览器缺系统库时给出库名和安装命令', async () => {
  const installer = new BrowserInstaller(async () => {
    throw new Error('Host system is missing dependencies to run browsers.\nMissing libraries:\n libnss3.so\n libatk-1.0.so.0');
  });
  const state = await installer.state();
  expect(state.status).toBe('missing');
  expect(state.error?.message).toContain('libnss3.so');
  expect(state.error?.message).toContain('libatk-1.0.so.0');
  expect(state.error?.hint).toContain('pnpm exec playwright install-deps chromium');
});

test('Windows 缺运行库时保留对应修复方法，不显示 Linux 安装命令', async () => {
  const installer = new BrowserInstaller(async () => {
    throw new Error('Host system is missing dependencies!\nSome of the Universal C Runtime files cannot be found\nSome of the Media Foundation files cannot be found\nFull list of missing libraries:\nvcruntime140.dll\nmfplat.dll');
  });
  const state = await installer.state();
  expect(state.error?.message).toContain('vcruntime140.dll');
  expect(state.error?.hint).toContain('Microsoft Visual C++ Redistributable');
  expect(state.error?.hint).toContain('Install-WindowsFeature Server-Media-Foundation');
  expect(state.error?.hint).not.toContain('install-deps');
});

test.each([
  'Chromium sandboxing failed!\nlaunch the browser with chromiumSandbox: false option',
  'Running as root without --no-sandbox is not supported',
  'No usable sandbox!',
  'Failed to move to new namespace: Operation not permitted',
])('沙箱失败给出非 root 与命名空间处理方法：%s', async error => {
  const installer = new BrowserInstaller(async () => { throw new Error(error); });
  const state = await installer.state();
  expect(state.error?.message).toBe('Chromium 沙箱无法启动。');
  expect(state.error?.hint).toContain('非 root');
  expect(state.error?.hint).toContain('clone、setns、unshare');
  expect(JSON.stringify(state.error)).not.toContain('chromiumSandbox: false');
  expect(JSON.stringify(state.error)).not.toContain('--no-sandbox');
});
