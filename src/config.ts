import type { ConfigGroup } from 'cortico/core/types.ts';

export const SURFING_BILI_SECRET = 'CORTICO_SURFING_BILI_SESSION';

export interface SurfingConfigSection {
  enabled: boolean;
  reading: { maxResponseEstimatedTokens: number; maxSourceChars: number };
  bili: { subtitleGroupSec: number; maxSubtitleRetries: number; subtitleRetryDelayMs: number };
  network: { maxDownloadBytes: number; requestTimeoutMs: number };
  cache: { ttlMs: number; maxBytes: number };
}

export const SURFING_DEFAULTS: SurfingConfigSection = {
  enabled: false,
  reading: { maxResponseEstimatedTokens: 4096, maxSourceChars: 300000 },
  bili: { subtitleGroupSec: 30, maxSubtitleRetries: 2, subtitleRetryDelayMs: 1000 },
  network: { maxDownloadBytes: 8 * 1024 * 1024, requestTimeoutMs: 20000 },
  cache: { ttlMs: 900000, maxBytes: 32 * 1024 * 1024 },
};

export const SURFING_CONFIG_GROUP: ConfigGroup = {
  id: 'world:surfing', owner: 'world:surfing',
  schema: { type: 'object', title: '阅读返回量', properties: {
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

export const SURFING_LIMITS_CONFIG_GROUP: ConfigGroup = {
  id: 'world:surfing:limits', owner: 'world:surfing',
  schema: { type: 'object', title: '获取与缓存限制', properties: {
    'worlds.surfing.reading.maxSourceChars': {
      type: 'integer', title: '单份材料保留上限', minimum: 10000, maximum: 2000000,
      'x-suffix': '字符', description: '正文和搜索结果合计；触限时标明材料不完整。新读取生效。',
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

export function applyBiliDefaults(config: SurfingConfigSection): void {
  if (config.bili.maxSubtitleRetries === undefined) config.bili.maxSubtitleRetries = SURFING_DEFAULTS.bili.maxSubtitleRetries;
  if (config.bili.subtitleRetryDelayMs === undefined) config.bili.subtitleRetryDelayMs = SURFING_DEFAULTS.bili.subtitleRetryDelayMs;
}

export function validateConfig(config: SurfingConfigSection): void {
  applyBiliDefaults(config);
  for (const group of [SURFING_CONFIG_GROUP, SURFING_LIMITS_CONFIG_GROUP]) {
    for (const [path, schema] of Object.entries(group.schema.properties)) {
      const value = path.split('.').slice(2).reduce<unknown>((part, key) => (part as Record<string, unknown>)?.[key], config);
      if (typeof value !== 'number' || !Number.isInteger(value) || value < schema.minimum! || value > schema.maximum!)
        throw new Error(`${schema.title}超出配置范围。`);
    }
  }
}
