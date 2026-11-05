import type { ConfigGroup } from 'cortico/core/types.ts';
import { parseAddressRanges } from './address-ranges.ts';

export const SURFING_MICROLINK_SECRET = 'CORTICO_SURFING_MICROLINK_API_KEY';
export const PROXY_MODE_PATH = 'worlds.surfing.network.proxyCompatibility';
export const PROXY_RANGES_PATH = 'worlds.surfing.network.customProxyRanges';

export interface SurfingConfigSection {
  enabled: boolean;
  reading: { maxResponseEstimatedTokens: number; maxSourceChars: number };
  bili: { subtitleGroupSec: number; maxSubtitleRetries: number; subtitleRetryDelayMs: number };
  network: { maxDownloadBytes: number; requestTimeoutMs: number; proxyCompatibility: boolean; customProxyRanges: string };
  cache: { ttlMs: number; maxBytes: number };
  search: { bili: boolean; tieba: boolean; moegirl: boolean; baike: boolean; maxResults: number };
}

export const SURFING_DEFAULTS: SurfingConfigSection = {
  enabled: false,
  reading: { maxResponseEstimatedTokens: 3000, maxSourceChars: 300000 },
  bili: { subtitleGroupSec: 30, maxSubtitleRetries: 2, subtitleRetryDelayMs: 1000 },
  network: { maxDownloadBytes: 8 * 1024 * 1024, requestTimeoutMs: 20000, proxyCompatibility: false, customProxyRanges: '' },
  cache: { ttlMs: 900000, maxBytes: 32 * 1024 * 1024 },
  search: { bili: true, tieba: true, moegirl: true, baike: true, maxResults: 5 },
};

export const SURFING_CONFIG_GROUP: ConfigGroup = {
  id: 'world:surfing', owner: 'world:surfing',
  schema: { type: 'object', title: '阅读与字幕', properties: {
    'worlds.surfing.reading.maxResponseEstimatedTokens': {
      type: 'integer', title: '单次返回上限', minimum: 1024, maximum: 32768,
      'x-suffix': '估算 token', 'x-hot': true,
      description: '包含正文和续读信息；下次调用生效。连续续读会累积上下文。',
    },
    'worlds.surfing.bili.subtitleGroupSec': {
      type: 'integer', title: '字幕时间分组', minimum: 1, maximum: 120,
      'x-suffix': '秒', 'x-hot': true, description: '合并显示时间戳，保留原句；新读取生效。',
    },
    'worlds.surfing.bili.maxSubtitleRetries': {
      type: 'integer', title: '空字幕重试次数', minimum: 0, maximum: 5,
      'x-suffix': '次', 'x-hot': true, description: '首次为空后额外重试；0 表示关闭。新读取生效。',
    },
    'worlds.surfing.bili.subtitleRetryDelayMs': {
      type: 'integer', title: '首次重试等待', minimum: 100, maximum: 10000,
      'x-scale': 1000, 'x-suffix': '秒', 'x-hot': true,
      description: '后续每次等待翻倍，重试共用单次读取超时。新读取生效。',
    },
  } },
};

export const SURFING_SEARCH_CONFIG_GROUP: ConfigGroup = {
  id: 'world:surfing:search', owner: 'world:surfing',
  schema: { type: 'object', title: '站点搜索', description: '用于 surfing_search_all 及其贴吧续搜，下次调用生效。', properties: {
    'worlds.surfing.search.maxResults': {
      type: 'integer', title: '每源显示条数', minimum: 1, maximum: 10,
      'x-suffix': '条', 'x-hot': true, description: '作用于 B站和贴吧。',
    },
    'worlds.surfing.search.bili': { type: 'boolean', title: 'B站', 'x-hot': true },
    'worlds.surfing.search.tieba': { type: 'boolean', title: '贴吧', 'x-hot': true },
    'worlds.surfing.search.moegirl': { type: 'boolean', title: '萌娘百科', 'x-hot': true },
    'worlds.surfing.search.baike': { type: 'boolean', title: '百度百科', 'x-hot': true },
  } },
};

export const SURFING_PROXY_CONFIG_GROUP: ConfigGroup = {
  id: 'world:surfing:proxy', owner: 'world:surfing',
  schema: { type: 'object', title: '代理', description: '正在使用 Clash 等代理？如果网页和B站读取都提示地址错误，可以尝试开启代理兼容模式。', properties: {
    [PROXY_MODE_PATH]: {
      type: 'boolean', title: '代理兼容模式', 'x-hot': true, 'x-warning': true,
      description: '开启后，实际访问哪里由代理决定，可能包括本机或内网服务。请只在信任当前代理时开启，下次读取生效。',
    },
    [PROXY_RANGES_PATH]: {
      type: 'string', title: '自定义地址范围（可选）', 'x-hot': true, 'x-warning': true,
      description: '常见地址已内置，只有改过代理的地址池才需要填写。每行一个，例如 172.19.0.0/16。',
    },
  } },
};

export const SURFING_LIMITS_CONFIG_GROUP: ConfigGroup = {
  id: 'world:surfing:limits', owner: 'world:surfing',
  schema: { type: 'object', title: '获取与缓存限制', properties: {
    'worlds.surfing.reading.maxSourceChars': {
      type: 'integer', title: '单份材料保留上限', minimum: 10000, maximum: 2000000,
      'x-suffix': '字符', description: '正文、链接地址和搜索结果合计；触限时标明材料不完整。新读取生效。',
    },
    'worlds.surfing.network.maxDownloadBytes': {
      type: 'integer', title: '单次读取下载上限', minimum: 1048576, maximum: 67108864,
      'x-scale': 1048576, 'x-suffix': 'MiB', description: '按解压后数据累计，包含重定向及渲染请求。',
    },
    'worlds.surfing.network.requestTimeoutMs': {
      type: 'integer', title: '单次读取超时', minimum: 3000, maximum: 120000,
      'x-scale': 1000, 'x-suffix': '秒', description: '整次读取共用时限；下次调用生效。',
    },
    'worlds.surfing.cache.ttlMs': {
      type: 'integer', title: '续读保留时间', minimum: 60000, maximum: 7200000,
      'x-scale': 60000, 'x-suffix': '分钟', description: '到期需重新读取；新快照生效。',
    },
    'worlds.surfing.cache.maxBytes': {
      type: 'integer', title: '文本缓存上限', minimum: 8388608, maximum: 268435456,
      'x-scale': 1048576, 'x-suffix': 'MiB', description: '按保存的数据大小核算，超限淘汰最久未读的材料。',
    },
  } },
};

export const SURFING_CONFIG_GROUPS = [SURFING_CONFIG_GROUP, SURFING_SEARCH_CONFIG_GROUP, SURFING_PROXY_CONFIG_GROUP, SURFING_LIMITS_CONFIG_GROUP];

export function configValue(config: SurfingConfigSection, path: string): unknown {
  return path.split('.').slice(2).reduce<unknown>((part, key) => (part as Record<string, unknown>)?.[key], config);
}

export function applyConfigDefaults(config: SurfingConfigSection): void {
  config.search = { ...SURFING_DEFAULTS.search, ...config.search };
  config.network = { ...SURFING_DEFAULTS.network, ...config.network };
  if (config.bili.maxSubtitleRetries === undefined) config.bili.maxSubtitleRetries = SURFING_DEFAULTS.bili.maxSubtitleRetries;
  if (config.bili.subtitleRetryDelayMs === undefined) config.bili.subtitleRetryDelayMs = SURFING_DEFAULTS.bili.subtitleRetryDelayMs;
}

export function validateConfig(config: SurfingConfigSection): void {
  applyConfigDefaults(config);
  for (const group of SURFING_CONFIG_GROUPS) {
    for (const [path, schema] of Object.entries(group.schema.properties)) {
      const value = configValue(config, path);
      if (schema.type === 'boolean') {
        if (typeof value !== 'boolean') throw new Error(`${schema.title}超出配置范围。`);
        continue;
      }
      if (schema.type === 'string') {
        if (typeof value !== 'string') throw new Error(`${schema.title}超出配置范围。`);
        parseAddressRanges(value);
        continue;
      }
      if (typeof value !== 'number' || !Number.isInteger(value) || value < schema.minimum! || value > schema.maximum!)
        throw new Error(`${schema.title}超出配置范围。`);
    }
  }
}
