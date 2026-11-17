import { createServer, request } from 'node:http';
import type { Socket } from 'node:net';
import { validatePublicUrl, type ReadOperation } from './network.ts';

/** HTTPS stays encrypted between Chromium and the origin; DNS and sockets belong to one read. */
export async function createBrowserProxy(operation: ReadOperation) {
  const sockets = new Set<Socket>();
  const track = (socket: Socket): Socket => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
    return socket;
  };
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      if (incoming.method !== 'GET') { outgoing.writeHead(405).end(); return; }
      const url = validatePublicUrl(incoming.url!);
      const socket = track(await operation.connect(url.href));
      const headers = { ...incoming.headers };
      delete headers['proxy-connection'];
      delete headers['proxy-authorization'];
      const upstream = request(url, { headers, createConnection: () => socket, signal: operation.signal }, response => {
        outgoing.writeHead(response.statusCode!, response.headers);
        response.pipe(outgoing);
        response.on('error', () => outgoing.destroy());
      });
      upstream.on('error', () => outgoing.destroy());
      outgoing.once('close', () => upstream.destroy());
      upstream.end();
    })().catch(() => outgoing.destroy());
  });
  server.on('connection', track);
  server.on('connect', (incoming, downstream, head) => {
    void (async () => {
      const upstream = track(await operation.connect(`https://${incoming.url}`));
      if (downstream.destroyed) { upstream.destroy(); return; }
      downstream.once('close', () => upstream.destroy());
      upstream.once('close', () => downstream.destroy());
      downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      downstream.pipe(upstream);
      upstream.pipe(downstream);
    })().catch(() => downstream.destroy());
  });
  const abort = () => { for (const socket of sockets) socket.destroy(); };
  operation.signal.addEventListener('abort', abort, { once: true });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    server: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    async close() {
      operation.signal.removeEventListener('abort', abort);
      abort();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
