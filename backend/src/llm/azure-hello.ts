import { requestTracker, type MetricsListener } from './metrics.js';
import { config } from '../config.js';
import { azureConfiguration, azureHttpFailure, azureRequestUrl, type AzureSettings } from './provider.js';
import { ProviderError } from './progress.js';

/** Standalone access check: one greeting request, no browser actions or retries. */
export async function azureHello(settings: AzureSettings = config, request: typeof fetch = fetch, signal?: AbortSignal, onMetrics?: MetricsListener) {
  if (signal?.aborted) throw new DOMException('Test cancelled', 'AbortError');
  const configuration = azureConfiguration(settings);
  if (!configuration.configured) throw new ProviderError(configuration.reason, 'CONFIGURATION');
  const started = performance.now();
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), settings.azureTimeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  const tracker = requestTracker(settings.azureDeployment, null, onMetrics);
  let outcome: 'succeeded' | 'failed' | 'cancelled' = 'failed';
  try {
    const response = await request(azureRequestUrl(settings), {
      method: 'POST', redirect: 'error', signal: requestSignal,
      headers: { 'api-key': settings.azureApiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], max_completion_tokens: settings.azureMaxTokens, stream: false }),
    });
    if (!response.ok) {
      let code: unknown;
      try { const errorBody = await response.json(); tracker.capture(errorBody, settings.azureApiKey); code = errorBody?.error?.code; } catch { /* Never print upstream error bodies. */ }
      throw azureHttpFailure(response.status, code);
    }
    let body: { error?: { code?: unknown }; choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }> };
    try { body = await response.json(); } catch { throw new ProviderError('Azure returned malformed JSON.', 'INVALID_RESPONSE'); }
    tracker.capture(body, settings.azureApiKey);
    requestSignal.throwIfAborted();
    if (!body || typeof body !== 'object') throw new ProviderError('Azure returned an invalid response.', 'INVALID_RESPONSE');
    if (body.error) throw azureHttpFailure(response.status, body.error.code);
    const choice = body.choices?.[0];
    if (choice?.finish_reason === 'content_filter') throw new ProviderError('Azure filtered the response under its content policy.', 'CONTENT_FILTER');
    if (choice?.finish_reason === 'length') throw new ProviderError('Azure reached the completion token limit. Increase AZURE_OPENAI_MAX_COMPLETION_TOKENS and rerun the test.', 'OUTPUT_LIMIT');
    const text = choice?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new ProviderError('Azure returned no text reply. Check the deployment and completion token budget.', 'EMPTY_RESPONSE');
    outcome = 'succeeded';
    return { text: text.replaceAll(settings.azureApiKey, '[REDACTED]'), elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    if (signal?.aborted) { outcome = 'cancelled'; throw new DOMException('Test cancelled', 'AbortError'); }
    if (timeout.signal.aborted) throw new ProviderError(`Azure test timed out after ${settings.azureTimeoutMs}ms. Check the endpoint and network access.`, 'TIMEOUT');
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('Azure could not be reached. Check the endpoint and network access.', 'NETWORK_ERROR');
  } finally { clearTimeout(timer); tracker.finish(outcome); }
}
