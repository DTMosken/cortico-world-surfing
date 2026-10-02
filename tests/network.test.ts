import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, test } from 'vitest';
import { PublicClient, validatePublicUrl, isPublicAddress } from '../src/network.ts';

test('拒绝 IP、账号 URL 和本地域名的规范化变体', () => {
  for (const url of ['http://localhost/', 'http://x.localhost/', 'http://127.1/', 'http://2130706433/',
    'http://0x7f000001/', 'http://[::1]/', 'http://example.local/', 'https://user:password@example.org/'])
    expect(() => validatePublicUrl(url)).toThrow();
  expect(validatePublicUrl('https://example.org/a').hostname).toBe('example.org');
});

test('任一 DNS 结果为内网时拒绝整个目标', async () => {
  const operation = new PublicClient(async()=>[{address:'1.1.1.1',family:4},{address:'10.0.0.1',family:4}])
    .operation({requestTimeoutMs:1000,maxDownloadBytes:4096});
  try { await expect(operation.get('https://example.org/')).rejects.toMatchObject({kind:'address_denied'}); }
  finally { operation.close(); }
});

test('整个操作的时限覆盖未返回的 DNS 请求', async () => {
  const operation = new PublicClient(()=>new Promise(()=>{})).operation({requestTimeoutMs:30,maxDownloadBytes:4096});
  try { await expect(operation.get('https://example.org/')).rejects.toMatchObject({kind:'timeout'}); }
  finally { operation.close(); }
});

test('公网判断排除保留地址、映射地址与隧道地址', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.0.2.1', '100.64.0.1',
    '0.0.0.0', '240.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1', '2002:7f00:1::'])
    expect(isPublicAddress(address), address).toBe(false);
  expect(isPublicAddress('1.1.1.1')).toBe(true);
  expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
});

test('对正在监听的本地服务也不建立连接', async () => {
  let connections = 0;
  const server = createServer((_req, res) => res.end('private'));
  server.on('connection', () => connections++);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const port = (server.address() as { port: number }).port;
    const operation = new PublicClient().operation({ requestTimeoutMs: 1000, maxDownloadBytes: 4096 });
    await expect(operation.get(`http://127.0.0.1:${port}/`)).rejects.toMatchObject({ kind: 'address_denied' });
    expect(connections).toBe(0);
    operation.close();
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
