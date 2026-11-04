import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { secretReader } from 'cortico/core/secrets.ts';
import { SURFING_MICROLINK_SECRET } from '../src/config.ts';
import { prepareKeyFile } from '../src/secret-file.ts';

test('密钥文件创建可选空值，保留其他配置和已有凭据', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfing-key-'));
  try {
    const file = prepareKeyFile(dir);
    const secret = secretReader(file);
    expect(secret(SURFING_MICROLINK_SECRET)).toBe('');
    writeFileSync(file, 'CORTICO_OTHER=value\n' + SURFING_MICROLINK_SECRET + '=fixture-credential\n');
    prepareKeyFile(dir);
    expect(secret(SURFING_MICROLINK_SECRET)).toBe('fixture-credential');
    expect(readFileSync(file, 'utf8')).toBe('CORTICO_OTHER=value\n' + SURFING_MICROLINK_SECRET + '=fixture-credential\n');
    writeFileSync(file, SURFING_MICROLINK_SECRET + '=\n');
    expect(secret(SURFING_MICROLINK_SECRET)).toBe('');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('现有密钥文件末尾无换行时追加独立的可选 Key 行', () => {
  const dir = mkdtempSync(join(tmpdir(), 'surfing-key-'));
  try {
    writeFileSync(join(dir, '.env'), 'CORTICO_OTHER=value');
    const file = prepareKeyFile(dir);
    expect(readFileSync(file, 'utf8')).toBe(`CORTICO_OTHER=value\n${SURFING_MICROLINK_SECRET}=\n`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
