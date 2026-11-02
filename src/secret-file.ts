import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SURFING_MICROLINK_SECRET } from './config.ts';

export function prepareKeyFile(botDir: string): string {
  const file = join(botDir, '.env');
  const contents = existsSync(file) ? readFileSync(file, 'utf8') : '';
  if (!new RegExp(`^${SURFING_MICROLINK_SECRET}=`, 'm').test(contents)) {
    const line = `${contents && !contents.endsWith('\n') ? '\n' : ''}${SURFING_MICROLINK_SECRET}=\n`;
    if (existsSync(file)) appendFileSync(file, line);
    else writeFileSync(file, line, { mode: 0o600 });
  }
  return file;
}

export function openSecretFile(file: string): Promise<void> {
  const command = process.platform === 'win32' ? 'notepad.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  return new Promise((resolve, reject) => {
    const child = spawn(command, [file], { detached: true, stdio: 'ignore' });
    child.once('error', () => reject(new Error('无法打开密钥文件。')));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
