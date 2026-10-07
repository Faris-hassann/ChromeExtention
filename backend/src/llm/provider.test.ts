import { afterEach, describe, expect, it, vi } from 'vitest';
import { AzureOpenAIProvider, azureConfiguration, type AzureSettings } from './provider.js';
import type { BrowserObservation } from '../types.js';
import { sanitizeLogData } from '../logger.js';

const settings = (): AzureSettings => ({ azureEndpoint: 'https://example.openai.azure.com///', azureApiKey: 'secret-azure-key', azureDeployment: 'my deployment/mini', azureApiVersion: '2025-04-01-preview', azureTimeoutMs: 90000, azureMaxTokens: 4096 });
const observation: BrowserObservation = { observationId: 'o', taskId: 'task', timestamp: '', tabId: '1', url: 'https://example.com/', title: 'Example', loadingState: 'complete', interactiveElements: [] };
const response = (name = 'complete_task', args: unknown = { summary: 'Destination verified.' }, finishReason = 'tool_calls') => new Response(JSON.stringify({ model: 'gpt-5.4-mini', choices: [{ finish_reason: finishReason, message: { tool_calls: [{ function: { name, arguments: JSON.stringify(args) } }] } }] }), { status: 200 });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Azure OpenAI provider', () => {
  it('shares simultaneous connection checks and records their success', async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new AzureOpenAIProvider(settings());
    const first = provider.testAccess(); const second = provider.testAccess();
    expect(first).toBe(second);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    finish(new Response(JSON.stringify({ choices: [{ message: { content: 'Hi!' }, finish_reason: 'stop' }] })));
    expect(await first).toMatchObject({ text: 'Hi!' }); await second;
    expect(provider.status()).toMatchObject({ availability: 'available', lastRequest: { outcome: 'succeeded' } });
  });
  it('uses the configured deployment URL, encoded API version and API key without model substitution', async () => {
    const options = settings(); options.azureApiVersion = '2025-04-01-preview&extra=x';
    const fetchMock = vi.fn().mockResolvedValue(response()); vi.stubGlobal('fetch', fetchMock);
    const provider = new AzureOpenAIProvider(options); const events: any[] = [];
    expect(provider.status()).toMatchObject({ configured: true, availability: 'unverified' });
    expect(await provider.decide('Open example.com', observation, {}, undefined, event => events.push(event))).toEqual({ type: 'complete_request', summary: 'Destination verified.' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://example.openai.azure.com/openai/deployments/my%20deployment%2Fmini/chat/completions?api-version=2025-04-01-preview%26extra%3Dx');
    expect(request.headers).toEqual({ 'api-key': 'secret-azure-key', 'content-type': 'application/json' });
    expect(request.redirect).toBe('error');
    const body = JSON.parse(request.body);
    expect(body).toMatchObject({ tool_choice: 'required', parallel_tool_calls: false, max_completion_tokens: 4096, stream: false });
    expect(body.messages).toHaveLength(2); expect(body.tools.length).toBeGreaterThan(0);
    for (const field of ['model', 'models', 'temperature', 'max_tokens', 'provider']) expect(body).not.toHaveProperty(field);
    expect(events.map(event => event.phase)).toEqual(['started', 'succeeded']);
    expect(events.every(event => event.provider === 'azure' && event.model === options.azureDeployment)).toBe(true);
    expect(provider.status()).toMatchObject({ availability: 'available', lastRequest: { outcome: 'succeeded' } });
    expect(JSON.stringify(provider.status())).not.toContain(options.azureApiKey);
  });

  it.each([
    ['azureEndpoint', 'Azure_openAi_Endpoint'], ['azureApiKey', 'Azure_openAI_API_KEY'],
    ['azureDeployment', 'Azure_openai_deployment_Name'], ['azureApiVersion', 'azure_openai_API_version'],
  ] as const)('identifies missing %s and sends no requests', async (key, name) => {
    const options = settings(); options[key] = '';
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect(azureConfiguration(options)).toMatchObject({ configured: false, missing: [name] });
    const provider = new AzureOpenAIProvider(options);
    expect(provider.status().availability).toBe('unconfigured');
    await expect(provider.decide('Open example.com', observation, {})).rejects.toMatchObject({ code: 'CONFIGURATION' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['http://example.com', 'https://user:password@example.com', 'https://example.com/?key=secret', 'not-a-url'])('rejects invalid endpoint %s without displaying its value', async endpoint => {
    const options = settings(); options.azureEndpoint = endpoint;
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const provider = new AzureOpenAIProvider(options);
    await expect(provider.decide('Open example.com', observation, {})).rejects.toMatchObject({ code: 'CONFIGURATION' });
    expect(provider.status().reason).not.toContain(endpoint);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'Unauthorized', 'AUTHENTICATION'], [403, 'Forbidden', 'ACCESS_DENIED'],
    [404, 'DeploymentNotFound', 'DEPLOYMENT_NOT_FOUND'], [400, 'InvalidApiVersionParameter', 'API_VERSION'],
    [429, 'TooManyRequests', 'RATE_LIMIT'], [400, 'BadRequest', 'INVALID_REQUEST'],
    [400, 'content_filter', 'CONTENT_FILTER'], [503, 'Unavailable', 'HTTP_ERROR'],
  ])('classifies HTTP %s / %s safely and makes no retry or fallback', async (status, upstreamCode, code) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: upstreamCode, message: 'secret-azure-key upstream body' } }), { status: status as number }));
    vi.stubGlobal('fetch', fetchMock); const logs = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const provider = new AzureOpenAIProvider(settings()); const events: any[] = [];
    await expect(provider.decide('Open example.com', observation, {}, undefined, event => events.push(event))).rejects.toMatchObject({ code, status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events.map(event => event.phase)).toEqual(['started', 'failed']);
    expect(provider.status()).toMatchObject({ availability: 'unavailable', lastRequest: { outcome: 'failed', code } });
    expect(JSON.stringify([provider.status(), events, logs.mock.calls])).not.toContain('secret-azure-key');
  });

  it.each(['length', 'content_filter'])('rejects %s finishes without acting', async finishReason => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('complete_task', { summary: 'Done' }, finishReason)));
    await expect(new AzureOpenAIProvider(settings()).decide('Open example.com', observation, {})).rejects.toMatchObject({ code: finishReason === 'length' ? 'OUTPUT_LIMIT' : 'CONTENT_FILTER' });
  });

  it.each([
    { choices: [{ message: { tool_calls: [] } }] },
    { choices: [{ message: { tool_calls: [{ function: { name: 'navigate', arguments: '{}' } }, { function: { name: 'complete_task', arguments: '{"summary":"Done"}' } }] } }] },
    { choices: [{ message: { tool_calls: [{ function: { name: 'unknown_tool', arguments: '{}' } }] } }] },
    { choices: [{ message: { tool_calls: [{ function: { name: 'navigate', arguments: '{"url":"not-a-url"}' } }] } }] },
    { choices: [{ message: { tool_calls: [{ function: { name: 'complete_task', arguments: 'secret-azure-key malformed' } }] } }] },
  ])('rejects malformed or unavailable tool decisions without retry', async body => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body))); vi.stubGlobal('fetch', fetchMock);
    await expect(new AzureOpenAIProvider(settings()).decide('Open example.com', observation, {})).rejects.toMatchObject({ code: 'INVALID_DECISION' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('handles non-JSON responses and sanitizes network exceptions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('secret-azure-key')).mockRejectedValueOnce(new Error('request https://secret-azure-key@example.com')));
    const provider = new AzureOpenAIProvider(settings());
    await expect(provider.decide('Open example.com', observation, {})).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(provider.decide('Open example.com', observation, {})).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: 'Azure could not be reached. Check the endpoint and network access.' });
    expect(JSON.stringify(provider.status())).not.toContain('secret-azure-key');
  });

  it('times out a stalled request and clears waiting timers', async () => {
    vi.useFakeTimers(); const options = settings(); options.azureTimeoutMs = 10000;
    const fetchMock = vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })));
    vi.stubGlobal('fetch', fetchMock); const provider = new AzureOpenAIProvider(options); const events: any[] = [];
    const pending = provider.decide('Open example.com', observation, {}, undefined, event => events.push(event));
    const assertion = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(10000); await assertion;
    expect(events.some(event => event.phase === 'waiting')).toBe(true);
    expect(vi.getTimerCount()).toBe(0); expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('honours cancellation before requests and discards late successful responses', async () => {
    const before = new AbortController(); before.abort();
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const provider = new AzureOpenAIProvider(settings());
    await expect(provider.decide('Open example.com', observation, {}, before.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
    let finish!: (value: Response) => void;
    fetchMock.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const controller = new AbortController(); const events: any[] = [];
    const pending = provider.decide('Open example.com', observation, {}, controller.signal, event => events.push(event));
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); finish(response()); await assertion;
    expect(events.map(event => event.phase)).toEqual(['started']);
    expect(provider.status()).toMatchObject({ availability: 'unverified', lastRequest: { outcome: 'cancelled' } });
  });

  it('redacts Azure key names and headers in diagnostics', () => {
    expect(sanitizeLogData({ Azure_openAI_API_KEY: 'secret', azureApiKey: 'secret', headers: { 'api-key': 'secret' } })).toEqual({ Azure_openAI_API_KEY: '[REDACTED]', azureApiKey: '[REDACTED]', headers: { 'api-key': '[REDACTED]' } });
  });
});
