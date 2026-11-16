import type { PublicResponse, ReadOperation } from '../src/network.ts';

export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');

/** Two real PDF pages: vector artwork with text, then vector artwork without text. */
export function pdfFixture(): Buffer {
  const streams = ['1 0 0 rg 20 20 100 100 re f BT /F1 24 Tf 20 160 Td (Page One) Tj ET', '0 0 1 rg 30 30 120 120 re f'];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...streams.map(text => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`),
  ];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(text);
}

export function visualOperation(responses: Record<string, { body: Buffer | string; type: string }>, signal = new AbortController().signal) {
  const requests: string[] = [];
  const operation: ReadOperation & { requests: string[] } = {
    signal, requests, downloadedBytes: 0, close() {},
    async postJson() { throw new Error('No POST in visual fixtures'); },
    async get(url): Promise<PublicResponse> {
      requests.push(url);
      const response = responses[url];
      if (!response) throw new Error(`Unexpected request: ${url}`);
      return { url, status: 200, headers: { 'content-type': response.type }, body: Buffer.from(response.body) };
    },
  };
  return operation;
}
