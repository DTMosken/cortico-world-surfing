import { parentPort, workerData } from 'node:worker_threads';
import { extractHtml } from './page.ts';
import { asReadError } from './network.ts';

try { parentPort!.postMessage({ material: extractHtml(workerData.html, workerData.url) }); }
catch (error) { const failure = asReadError(error); parentPort!.postMessage({ error: { kind: failure.kind, message: failure.message } }); }
