import type { Page, Request, Response } from 'playwright';
import { ReadError, type ReadOperation } from './network.ts';

const rules = [
  {site:'TikTok', origin:'https://www.tiktok.com', video:/^\/@[^/]+\/video\/(\d{15,22})\/?$/, list:'/api/comment/list/', method:'direct'},
  {site:'抖音', origin:'https://www.douyin.com', video:/^\/video\/(\d{15,22})\/?$/, list:'/aweme/v1/web/comment/list/', method:'browser',
    alternateOrigin:'https://www-hj.douyin.com', ignore:['/aweme/v1/web/aweme/related/'], container:'[data-e2e="comment-list"]', item:'[data-e2e="comment-item"]'}
] as const;
export type ShortVideo = typeof rules[number] & {id:string};
export interface CommentBatch { text: string; next?: number }
export function shortVideo(url: URL): ShortVideo | undefined {
  for (const rule of rules) {
    const match = url.origin === rule.origin && rule.video.exec(url.pathname);
    if (match) return {...rule,id:match[1]};
  }
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
  const url = new URL(video.list,video.origin);
  url.search = new URLSearchParams({aid:'1988', aweme_id:video.id, cursor:String(cursor), count:'20'}).toString();
  const response = await operation.get(url.href, {allowHost: hostname => hostname === url.hostname});
  if (response.status !== 200) throw new ReadError('content_unavailable', 'TikTok 未提供公开评论。');
  return response.body;
}

export function tiktokListPosition(request: Request, video: ShortVideo): number | undefined {
  const url = new URL(request.url());
  if (request.method() !== 'GET' || !['xhr','fetch'].includes(request.resourceType()) ||
    url.origin !== video.origin || url.pathname !== video.list ||
    url.searchParams.get('aweme_id') !== video.id) return;
  const position = url.searchParams.get('cursor') ?? '0';
  if (/^\d+$/.test(position) && Number.isSafeInteger(Number(position))) return Number(position);
}

/** Anonymous rankings can change on reload. Keep the batches from one visit together. */
export async function douyinComments(page: Page, video: Extract<ShortVideo,{method:'browser'}>, reveal: boolean): Promise<{batches:string[]; incomplete?:boolean}> {
  const responses = new Map<number, Response>();
  function remember(reply: Response) {
    const url = new URL(reply.url());
    if ((url.origin !== video.origin && url.origin !== video.alternateOrigin) ||
      url.pathname !== video.list || reply.request().method() !== 'GET' ||
      url.searchParams.get('aweme_id') !== video.id || reply.frame() !== page.mainFrame() ||
      new URL(page.url()).origin !== video.origin || shortVideo(new URL(page.url()))?.id !== video.id) return;
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
        const item = position ? page.locator(video.item).last() : page.locator(video.container).first();
        void item.scrollIntoViewIfNeeded({timeout:0}).catch(() => {});
      }
      let reply: Response;
      try { reply = await pending; }
      catch (error) {
        if (!position || !(error instanceof Error && error.name === 'TimeoutError')) throw error;
        return {batches, incomplete:true};
      }
      if (reply.status() !== 200) throw new ReadError('content_unavailable','抖音未提供公开评论。');
      const batch = parseCommentBatch(await reply.body(), position, seen);
      if (batch.text) batches.push(batch.text);
      if (!reveal || batch.next === undefined) return {batches};
      position = batch.next;
    }
  } finally { page.off('response', remember); }
}
