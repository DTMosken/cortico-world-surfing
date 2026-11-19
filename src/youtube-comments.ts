import { gunzipSync } from 'node:zlib';
import type { Request, Route } from 'playwright';
import type { ReadOperation } from './network.ts';

const origin = 'https://www.youtube.com';
const endpoint = origin + '/youtubei/v1/next';
const maxBodyBytes = 64 * 1024;

export function youtubeWatchPage(url: URL): boolean {
  return url.origin === origin && url.pathname === '/watch' && /^[\w-]{11}$/.test(url.searchParams.get('v') ?? '');
}

/** Only the fixed anonymous read query is sent. Browser headers, URL parameters and extra JSON fields stay local. */
export function commentQuery(body: Buffer) {
  if (!body.length || body.length > maxBodyBytes) return;
  try {
    const json = body[0] === 0x1f && body[1] === 0x8b ? gunzipSync(body, { maxOutputLength: maxBodyBytes }) : body;
    const data = JSON.parse(json.toString('utf8'));
    const client = data?.context?.client;
    if (client?.clientName !== 'WEB' || typeof client.clientVersion !== 'string' || !/^[\d.]{1,48}$/.test(client.clientVersion) ||
        typeof data.continuation !== 'string' || !/^[\w%+.=/\-]{1,16384}$/.test(data.continuation)) return;
    return {context: {client: {clientName: 'WEB', clientVersion: client.clientVersion}}, continuation: data.continuation};
  } catch { return; }
}

export function youtubeContinuation(request: Request): boolean {
  const url = new URL(request.url());
  return request.method() === 'POST' && url.origin === origin && url.pathname === '/youtubei/v1/next' &&
    ['xhr', 'fetch'].includes(request.resourceType());
}

export async function answerYouTubeComments(route: Route, operation: ReadOperation): Promise<void> {
  const body = route.request().postDataBuffer();
  const query = body && commentQuery(body);
  if (!query) { await route.abort(); return; }
  const reply = await operation.postJson(endpoint, query, hostname => hostname === 'www.youtube.com');
  if (reply.status !== 200) { await route.abort(); return; }
  await route.fulfill({status: 200, contentType: 'application/json', body: reply.body});
}
