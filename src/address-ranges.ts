/** Imported by the browser panel through config.ts, so this module depends on ipaddr.js only. */
import ipaddr from 'ipaddr.js';

export type AddressRange = ReturnType<typeof ipaddr.parseCIDR>;

export function parseAddressRanges(text: string): AddressRange[] {
  return text.split('\n').flatMap((raw, index) => {
    const line = raw.trim();
    if (!line) return [];
    try { return [ipaddr.parseCIDR(line)]; }
    catch { throw new Error(`自定义地址范围第 ${index + 1} 行无法识别：${line}。每行填一个范围，例如 172.19.0.0/16 或 fd00:1234::/64。`); }
  });
}

export const commonProxyRanges = (): AddressRange[] => parseAddressRanges('198.18.0.0/15\nfdfe:dcba:9876::/64\n2001:2::/48');

export function inAddressRanges(address: string, ranges: AddressRange[]): boolean {
  const parsed = ipaddr.process(address);
  return ranges.some(([base, bits]) => base.kind() === parsed.kind() && parsed.match(base, bits));
}
