export type FailureKind = 'invalid_input' | 'address_denied' | 'access_denied' | 'not_found'
  | 'no_subtitle' | 'timeout' | 'network_error' | 'protocol_error' | 'source_limit'
  | 'cursor_expired' | 'cursor_mismatch' | 'content_unavailable' | 'browser_unavailable';

export class ReadError extends Error {
  constructor(readonly kind: FailureKind, message: string) { super(message); }
}

export function asReadError(error: unknown): ReadError {
  if (error instanceof ReadError) return error;
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
    return new ReadError('timeout', '读取已取消或超时。');
  return new ReadError('network_error', '读取失败，未取得可用文本。');
}
