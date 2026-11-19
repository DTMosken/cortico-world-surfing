import type { Page, Request, Response } from 'playwright';
import { ReadError, type ReadOperation } from './network.ts';

export interface ShortVideo { site: 'TikTok' | '抖音'; id: string }
export interface CommentBatch { text: string; next?: number }

export function shortVideo(url: URL): ShortVideo | undefined {
  const tiktok = url.origin === 'https://www.tiktok.com' && /^\/@[^/]+\/video\/(\d{15,22})\/?$/.exec(url.pathname);
  if (tiktok) return {site: 'TikTok', id: tiktok[1]};
  const douyin = url.origin === 'https://www.douyin.com' && /^\/video\/(\d{15,22})\/?$/.exec(url.pathname);
  if (douyin) return {site: '抖音', id: douyin[1]};
}

export function parseCommentBatch(body: Buffer, position: number, seen?: Set<string>): CommentBatch {
  if (!body.length) throw new ReadError('content_unavailable','网站返回了空响应，未取得评论。');
  let data;
  try { data = JSON.parse(body.toString('utf8')); }
  catch { throw new ReadError('protocol_error','网站未返回有效的评论列表。'); }
  if (data?.status_code !== 0 || !Array.isArray(data.comments))
    throw new ReadError('content_unavailable','网站未返回公开评论。');
  const more = data.has_more;
  if (![0,1,false,true].includes(more) || (more && (!Number.isSafeInteger(data.cursor) || data.cursor <= position)))
    throw new ReadError('protocol_error','网站未返回有效的评论分页标记。');
  const lines: string[] = [];
  for (const item of data.comments) {
    if (!item || typeof item.text !== 'string') throw new ReadError('protocol_error','评论格式发生变化。');
    if (seen && typeof item.cid === 'string') {
      if (seen.has(item.cid)) continue;
      seen.add(item.cid);
    }
    lines.push(`${item.user?.nickname || '用户'}：${item.text || '（无文字）'}`);
  }
  return {text: lines.join('\n\n'), next: more ? data.cursor : undefined};
}

export async function tiktokList(video: ShortVideo, cursor: number, operation: ReadOperation) {
  const url = new URL('https://www.tiktok.com/api/comment/list/');
  url.search = new URLSearchParams({aid:'1988', aweme_id:video.id, cursor:String(cursor), count:'20'}).toString();
  const response = await operation.get(url.href, {allowHost: hostname => hostname === url.hostname});
  if (response.status !== 200) throw new ReadError('content_unavailable', 'TikTok 未提供公开评论。');
  return response.body;
}

export function tiktokListPosition(request: Request, video: ShortVideo): number | undefined {
  const url = new URL(request.url());
  if (request.method() !== 'GET' || !['xhr','fetch'].includes(request.resourceType()) ||
    url.origin !== 'https://www.tiktok.com' || url.pathname !== '/api/comment/list/' ||
    url.searchParams.get('aweme_id') !== video.id) return;
  const position = url.searchParams.get('cursor') ?? '0';
  if (/^\d+$/.test(position) && Number.isSafeInteger(Number(position))) return Number(position);
}

/** Anonymous rankings can change on reload. Keep the batches from one visit together. */
export async function douyinComments(page: Page, video: ShortVideo, reveal: boolean): Promise<string[]> {
  const responses = new Map<number, Response>();
  function remember(reply: Response) {
    const url = new URL(reply.url());
    if ((url.origin !== 'https://www.douyin.com' && url.origin !== 'https://www-hj.douyin.com') ||
      url.pathname !== '/aweme/v1/web/comment/list/' || reply.request().method() !== 'GET' ||
      url.searchParams.get('aweme_id') !== video.id || reply.frame() !== page.mainFrame() ||
      new URL(page.url()).origin !== 'https://www.douyin.com' || shortVideo(new URL(page.url()))?.id !== video.id) return;
    responses.set(Number(url.searchParams.get('cursor') ?? 0), reply);
  }
  page.on('response', remember);
  const batches: string[] = [];
  const seen = new Set<string>();
  let position = 0;
  try {
    for (;;) {
      const cached = responses.get(position);
      const pending = cached ?? page.waitForResponse(r => responses.get(position) === r, {timeout: position ? 6000 : 0});
      if (reveal && !cached) {
        const item = position ? page.locator('[data-e2e="comment-item"]').last() : page.locator('[data-e2e="comment-list"]').first();
        void item.scrollIntoViewIfNeeded({timeout:0}).catch(() => {});
      }
      let reply: Response;
      try { reply = await pending; }
      catch (error) {
        if (!position || !(error instanceof Error && error.name === 'TimeoutError')) throw error;
        if (batches.length) batches[batches.length - 1] += '\n\n匿名页面未加载更多评论。';
        else batches.push('匿名页面未加载更多评论。');
        return batches;
      }
      if (reply.status() !== 200) throw new ReadError('content_unavailable','抖音未提供公开评论。');
      const batch = parseCommentBatch(await reply.body(), position, seen);
      if (batch.text) batches.push(batch.text);
      if (!reveal || batch.next === undefined) return batches;
      position = batch.next;
    }
  } finally { page.off('response', remember); }
}
