import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, expect, test, vi } from 'vitest';
import { parseAddressRanges } from '../src/address-ranges.ts';
import { PublicClient, type Address, type NetworkLimits } from '../src/network.ts';

const connections = vi.hoisted(() => [] as { address: string; family: number }[]);
vi.mock('node:http', async original => ({
  ...await original<typeof import('node:http')>(),
  request: (_url: URL, options: { lookup: Function }, respond: (response: Readable) => void) => {
    const request = Object.assign(new EventEmitter(), {
      destroy(error: Error) { request.emit('error', error); },
      end() {
        options.lookup('', {}, (_error: null, address: string, family: number) => {
          connections.push({ address, family });
          request.emit('socket', { remoteAddress: address });
          respond(Object.assign(Readable.from([Buffer.from('正文')]), { statusCode: 200, headers: {} }));
        });
      },
    });
    return request;
  },
}));

const OFF_HINT = '这个网址解析到了代理常用的虚拟地址，所以没有读取。如果正在使用 Clash 等代理，可以在网上冲浪设置中开启代理兼容模式后重试。';
const ON_HINT = '这个网址解析到了未放行的内网或保留地址，所以没有读取。只有确认这是你改过的代理地址池时，才需要把它加入自定义地址范围；否则请检查网址和代理设置。';
const GENERIC = '域名未解析到允许的公网地址。';
const v4 = (address: string): Address => ({ address, family: 4 });
const v6 = (address: string): Address => ({ address, family: 6 });

async function read(addresses: Address[], limits: Partial<NetworkLimits> = {}) {
  const operation = new PublicClient(async () => addresses)
    .operation({ requestTimeoutMs: 1000, maxDownloadBytes: 4096, ...limits });
  try { return await operation.get('http://example.org/'); }
  finally { operation.close(); }
}

beforeEach(() => { connections.length = 0; });

test.each([
  ['IPv4', [v4('198.18.2.27')], v4('198.18.2.27')],
  ['IPv4 上限', [v4('198.19.255.254')], v4('198.19.255.254')],
  ['IPv6 常见池', [v6('fdfe:dcba:9876::4')], v6('fdfe:dcba:9876::4')],
  ['另一个 IPv6 常见池', [v6('2001:2::1')], v6('2001:2::1')],
  ['IPv4 与 IPv6 混合', [v6('fdfe:dcba:9876::4'), v4('198.18.2.27')], v4('198.18.2.27')],
  ['虚拟地址与公网地址混合', [v6('2606:4700:4700::1111'), v4('198.18.2.27')], v4('198.18.2.27')],
  ['IPv4 映射写法', [v6('::ffff:198.18.2.27')], v6('::ffff:198.18.2.27')],
])('开启后连接内置范围：%s', async (_name, addresses, selected) => {
  expect((await read(addresses, { proxyCompatibility: true })).body.toString()).toBe('正文');
  expect(connections).toEqual([selected]);
});

test.each([
  ['关闭时内置 IPv4', [v4('198.18.2.27')], {}, OFF_HINT],
  ['关闭时内置 IPv6', [v6('fdfe:dcba:9876::4')], {}, OFF_HINT],
  ['关闭时混有内网地址', [v4('198.18.2.27'), v4('10.0.0.1')], {}, GENERIC],
  ['关闭时其他 ULA', [v6('fd00::1')], {}, GENERIC],
  ['关闭时自定义范围不生效', [v4('172.19.0.1')], { customProxyRanges: '172.19.0.0/16' }, GENERIC],
  ['开启时混有内网地址', [v4('198.18.2.27'), v4('10.0.0.1')], { proxyCompatibility: true }, ON_HINT],
  ['开启时其他 ULA', [v6('fd00::1')], { proxyCompatibility: true }, ON_HINT],
  ['开启时无解析结果', [], { proxyCompatibility: true }, GENERIC],
] as [string, Address[], Partial<NetworkLimits>, string][])('不发起连接并给出对应提示：%s', async (_name, addresses, limits, message) => {
  await expect(read(addresses, limits)).rejects.toMatchObject({ kind: 'address_denied', message });
  expect(connections).toEqual([]);
});

test('自定义范围补充内置范围，按地址族匹配', async () => {
  const limits = { proxyCompatibility: true, customProxyRanges: ' 172.19.0.0/16 \r\n\r\nfd00:1234::/64\r\n' };
  await read([v4('172.19.0.1')], limits);
  await read([v6('fd00:1234::1')], limits);
  await read([v4('198.18.0.1')], limits);
  expect(connections.map(connection => connection.address)).toEqual(['172.19.0.1', 'fd00:1234::1', '198.18.0.1']);
  await expect(read([v4('172.20.0.1')], limits)).rejects.toMatchObject({ message: ON_HINT });
  await expect(read([v6('fd00:1235::1')], limits)).rejects.toMatchObject({ message: ON_HINT });
});

test.each([
  ['172.19.0.0', 1], ['172.19.0.0/33', 1], ['\n\n代理', 3], ['172.19.0.0/16\r\nfd00::/129', 2],
])('无效范围指出行号和写法：%j', (text, line) => {
  expect(() => parseAddressRanges(text)).toThrow(new RegExp(`第 ${line} 行.*例如 172\\.19\\.0\\.0/16`));
});
