import { afterEach, describe, expect, it, vi } from 'vitest';
import { azureHello } from './azure-hello.js';
import type { AzureSettings } from './provider.js';

const settings: AzureSettings = { azureEndpoint: 'https://resource.openai.azure.com/', azureApiKey: 'private-api-key', azureDeployment: 'my-mini', azureApiVersion: '2025-04-01-preview', azureTimeoutMs: 90000, azureMaxTokens: 4096 };
const reply = (content: unknown = 'Hi! How can I help?') => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
afterEach(() => vi.useRealTimers());

describe('standalone Azure greeting', () => {
  it('sends hi once, waits for the response and returns its text', async () => {
    let finish!: (response: Response) => void;
    const request = vi.fn().mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const result = azureHello(settings, request);
    expect(request).toHaveBeenCalledTimes(1);
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe('https://resource.openai.azure.com/openai/deployments/my-mini/chat/completions?api-version=2025-04-01-preview');
    expect(init.headers['api-key']).toBe(settings.azureApiKey);
    expect(JSON.parse(init.body)).toEqual({ messages: [{ role: 'user', content: 'hi' }], max_completion_tokens: 4096, stream: false });
    finish(reply());
    expect(await result).toMatchObject({ text: 'Hi! How can I help?' });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects missing configuration without contacting Azure', async () => {
    const request = vi.fn();
    await expect(azureHello({ ...settings, azureApiKey: '' }, request)).rejects.toMatchObject({ code: 'CONFIGURATION' });
    expect(request).not.toHaveBeenCalled();
  });
  it('reports authentication failures without exposing upstream messages or secrets', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'Unauthorized', message: settings.azureApiKey } }), { status: 401 }));
    await expect(azureHello(settings, request)).rejects.toMatchObject({ code: 'AUTHENTICATION', status: 401, message: 'Azure authentication failed. Check Azure_openAI_API_KEY and the resource endpoint.' });
    expect(request).toHaveBeenCalledTimes(1);
    expect((await azureHello(settings, vi.fn().mockResolvedValue(reply(`Echo ${settings.azureApiKey}`)))).text).toBe('Echo [REDACTED]');
  });
  it('times out and clears its timer without retries', async () => {
    vi.useFakeTimers();
    const request = vi.fn((_url, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    const result = azureHello({ ...settings, azureTimeoutMs: 50 }, request);
    const assertion = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(50); await assertion;
    expect(request).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('discards a late reply after cancellation', async () => {
    const controller = new AbortController();
    let finish!: (response: Response) => void;
    const request = vi.fn().mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const result = azureHello(settings, request, controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); finish(reply()); await assertion;
  });
  it.each([null, '', '   ', 42])('rejects empty or non-text output (%s)', async content => {
    await expect(azureHello(settings, vi.fn().mockResolvedValue(reply(content)))).rejects.toMatchObject({ code: 'EMPTY_RESPONSE' });
  });
  it.each(['content_filter', 'length'])('reports %s output without printing a partial reply', async finishReason => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content: 'Partial reply' } }] })));
    await expect(azureHello(settings, request)).rejects.toMatchObject({ code: finishReason === 'length' ? 'OUTPUT_LIMIT' : 'CONTENT_FILTER' });
  });
});
