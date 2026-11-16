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
    writeFileSync(script, "require('node:fs').writeFileSync(process.argv[2], 'ready');");
    await installer.install();
    await vi.waitFor(async () => expect((await installer.state()).status).toBe('ready'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('下载成功但浏览器缺少系统库时仍显示失败原因', async () => {
  const installer = new BrowserInstaller(async () => { throw new Error('Missing shared library'); },
    [process.execPath, '-e', 'process.exitCode = 0']);
  await installer.install();
  await vi.waitFor(async () => expect((await installer.state()).status).toBe('failed'));
  expect((await installer.state()).log).toContain('Missing shared library');
});
