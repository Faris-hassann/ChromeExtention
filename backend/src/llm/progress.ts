export interface ProviderProgress {
  provider: 'azure';
  phase: 'started' | 'succeeded' | 'failed' | 'waiting';
  model: string;
  elapsedMs?: number;
  message: string;
  status?: number;
  code?: string;
}
export type ProgressListener = (progress: ProviderProgress) => void;

export class ProviderError extends Error {
  constructor(message: string, readonly code: string, readonly status?: number, readonly retryAfterMs?: number, readonly skipped = false) { super(message); this.name = 'ProviderError'; }
}

export function providerFailure(error: unknown) {
  if (error instanceof ProviderError) return { message: error.message, code: error.code, status: error.status, retryAfterMs: error.retryAfterMs };
  // Do not display upstream response bodies, URLs or credentials.
  const message = error instanceof Error ? error.message : '';
  const status = Number(message.match(/HTTP (\d{3})/)?.[1]) || undefined;
  return { message: status ? `HTTP ${status}` : /timed out|timeout/i.test(message) ? 'Request timed out' : /invalid|tool call/i.test(message) ? 'Invalid model decision' : 'Provider unavailable', code: status ? 'HTTP_ERROR' : /timed out|timeout/i.test(message) ? 'TIMEOUT' : 'PROVIDER_ERROR', status, retryAfterMs: undefined };
}
