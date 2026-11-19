import type { Browser } from 'playwright';
import { ReadError, type ReadOperation } from './network.ts';

/** The browser belongs to one read; response interception includes nested and shared Workers. */
export async function attachBrowserNetwork(browser: Browser, operation: ReadOperation,
  onError: (error: ReadError) => void, interactive = false): Promise<void> {
  const session = await browser.newBrowserCDPSession();
  let closed = false;
  let failed = false;
  browser.once('disconnected', () => { closed = true; });
  session.on('Fetch.requestPaused', event => {
    void (async () => {
      if (interactive && !event.responseStatusCode && !event.responseErrorReason && event.request.method !== 'GET') {
        await session.send('Fetch.failRequest', {requestId: event.requestId, errorReason: 'BlockedByClient'});
        return;
      }
      if (event.responseErrorReason || !event.responseStatusCode
        || [204, 205, 301, 302, 303, 304, 307, 308].includes(event.responseStatusCode)) {
        await session.send('Fetch.continueRequest', { requestId: event.requestId });
        return;
      }
      const { stream } = await session.send('Fetch.takeResponseBodyAsStream', { requestId: event.requestId });
      const chunks: Buffer[] = [];
      try {
        for (;;) {
          const part = await session.send('IO.read', { handle: stream, size: 65536 });
          const chunk = Buffer.from(part.data, part.base64Encoded ? 'base64' : 'utf8');
          operation.accountBytes(chunk.length);
          chunks.push(chunk);
          if (part.eof) break;
        }
      } finally { await session.send('IO.close', { handle: stream }).catch(() => {}); }
      const headers = (event.responseHeaders ?? []).filter(header =>
        !['content-encoding', 'content-length', 'transfer-encoding'].includes(header.name.toLowerCase()));
      // Blob Workers inherit this policy; fetched Worker scripts receive it on their own response.
      headers.push({ name: 'Content-Security-Policy', value: 'connect-src http: https: data: blob:' });
      if (interactive && event.resourceType === 'Document')
        headers.push({name: 'Content-Security-Policy', value: 'sandbox allow-scripts allow-same-origin'});
      await session.send('Fetch.fulfillRequest', {
        requestId: event.requestId, responseCode: event.responseStatusCode,
        responseHeaders: headers, body: Buffer.concat(chunks).toString('base64'),
      });
    })().catch(async error => {
      if (closed || failed || operation.signal.aborted) return;
      if (error instanceof ReadError && error.kind === 'source_limit') {
        failed = true;
        onError(error);
      }
      await session.send('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Aborted' }).catch(() => {});
    });
  });
  await session.send('Fetch.enable', { patterns: interactive
    ? [{urlPattern: '*', requestStage: 'Request'}, {urlPattern: '*', requestStage: 'Response'}]
    : [{urlPattern: '*', requestStage: 'Response'}] });
}
