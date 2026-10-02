import type { ToolSpec } from 'cortico/core/types.ts';

const cursor = { type: 'string', maxLength: 256, description: '沿用上次返回的 nextCursor，并保持原目标参数。' };
export const SURFING_TOOL_DECLS: ToolSpec[] = [
  {
    name: 'surfing_read_page', tags: ['read'], description: '读取公开网页正文、目录和链接，返回预算内原文片段；可用 cursor 继续。URL 的章节锚点可定位长文。仅接受公开域名。',
    parameters: { type: 'object', additionalProperties: false, required: ['url'], properties: {
      url: { type: 'string', maxLength: 8192, description: '用户提供或搜索结果中需要打开的 HTTP(S) URL。' }, cursor,
    } },
  },
  {
    name: 'surfing_read_bili', tags: ['read'], description: '匿名读取 B站视频人工或 AI 字幕。提供 BV 即可；可指定 cid 或 URL 中的 p 选择分P。回执为字幕原文片段，缺字幕不代表无音频。',
    parameters: { type: 'object', additionalProperties: false, anyOf: [{ required: ['bvid'] }, { required: ['aid'] }, { required: ['url'] }], properties: {
      bvid: { type: 'string', pattern: '^BV[0-9A-Za-z]{10}$', description: '视频 BV号。' },
      aid: { type: 'integer', minimum: 1, description: '稿件 aid；不知道时只给 BV 或 URL。' },
      cid: { type: 'integer', minimum: 1, description: '特定分P的 cid；省略时按 URL 的 p 或第1P读取。' },
      url: { type: 'string', maxLength: 8192, description: 'B站视频长链或 b23.tv 短链。' }, cursor,
    } },
  },
  {
    name: 'surfing_search_bili', tags: ['read'], description: '独立搜索 B站视频，返回标题、BV、链接、UP主与时长。明确要求找视频时调用；查梗或概念可使用“关键词 梗知识”。可用 cursor 继续。',
    parameters: { type: 'object', additionalProperties: false, required: ['query'], properties: {
      query: { type: 'string', minLength: 1, maxLength: 240 }, cursor,
    } },
  },
];
