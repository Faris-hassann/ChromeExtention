import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FallbackProvider, OpenRouterProvider } from './provider.js';
import { decisionContext } from './ollama.js';
import { sanitizeLogData } from '../logger.js';
import type { BrowserObservation } from '../types.js';
import type { ProviderProgress } from './progress.js';
import { config } from '../config.js';
import { OpenRouterStatusService } from './openrouter-status.js';

const observation: BrowserObservation = { observationId: 'o', taskId: 't', timestamp: '', tabId: '1', url: 'https://google.com/', title: 'Google', loadingState: 'complete', interactiveElements: [] };
const decision = { type: 'tool_request' as const, tool: 'navigate' as const, arguments: { url: 'https://chatgpt.com/' } };
const goodResponse = () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'navigate', arguments: JSON.stringify(decision.arguments) } }] } }], model: 'test:free' }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
beforeEach(() => {
  vi.spyOn(OpenRouterStatusService.prototype, 'status').mockImplementation(async function(this: any) { return this.effective({ configured: true, credentialValidity: 'valid', availability: 'unknown', reason: 'Quota unknown', checkedAt: new Date().toISOString() }); });
  vi.spyOn(OpenRouterStatusService.prototype, 'models').mockResolvedValue([]);
});

describe('OpenRouter and fallback', () => {
  it.each(['openai/gpt-4o', 'openrouter/auto', 'openrouter/auto:free'])('rejects paid or billing-router configuration %s before any requests', async model => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(new OpenRouterProvider('key', model).decide('Read', observation, {})).rejects.toThrow('disabled');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reports the actual successful OpenRouter model and never calls local fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(goodResponse()));
    const local = { decide: vi.fn() }; const events: ProviderProgress[] = [];
    await new FallbackProvider(new OpenRouterProvider('secret-key'), local).decide('open ChatGPT', observation, {}, undefined, event => events.push(event));
    expect(events.map(event => event.phase)).toEqual(['started', 'model_selected', 'succeeded']);
    expect(events.at(-1)).toMatchObject({ provider: 'openrouter', model: 'test:free' });
    expect(JSON.stringify(events)).not.toContain('secret-key'); expect(local.decide).not.toHaveBeenCalled();
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
    expect(body.max_tokens).toBe(config.openrouterMaxTokens);
    expect(body.provider.sort).toBe('latency');
  });
  it('reports rate limiting and cooldown, then retries OpenRouter when the cooldown ends', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('sensitive response', { status: 429, headers: { 'retry-after': '2' } })).mockResolvedValue(goodResponse());
    vi.stubGlobal('fetch', fetchMock);
    const local = { decide: vi.fn().mockResolvedValue(decision) }; const events: ProviderProgress[] = [];
    const provider = new FallbackProvider(new OpenRouterProvider('secret-key'), local);
    const report = (event: ProviderProgress) => events.push(event);
    await provider.decide('open ChatGPT', observation, {}, undefined, report);
    expect(events.map(event => event.phase)).toEqual(['started', 'failed', 'fallback', 'started', 'succeeded']);
    expect(events[1]).toMatchObject({ status: 429, code: 'RATE_LIMIT' });
    expect(events[1]!.message).toContain('Rate limit');
    await provider.decide('open ChatGPT', observation, {}, undefined, report);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(events.some(event => /Rate limit/.test(event.message))).toBe(true);
    await vi.advanceTimersByTimeAsync(2100);
    await provider.decide('open ChatGPT', observation, {}, undefined, report);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(events)).not.toContain('sensitive response'); expect(JSON.stringify(events)).not.toContain('secret-key');
  });
  it('makes missing credentials visible and reports both providers failing', async () => {
    const events: ProviderProgress[] = [];
    const local = { decide: vi.fn().mockRejectedValue(new Error('Ollama offline')) };
    await expect(new FallbackProvider(null, local).decide('open ChatGPT', observation, {}, undefined, event => events.push(event))).rejects.toThrow('offline');
    expect(events[0]).toMatchObject({ phase: 'skipped' });
    expect(events.at(-1)).toMatchObject({ provider: 'ollama', phase: 'failed' });
  });
  it('sends elapsed waiting updates and removes the timer when finished', async () => {
    vi.useFakeTimers(); let finish!: (decision: any) => void;
    const primary = { decide: vi.fn(() => new Promise<any>(resolve => { finish = resolve; })) };
    const events: ProviderProgress[] = [];
    const pending = new FallbackProvider(primary).decide('open ChatGPT', observation, {}, undefined, event => events.push(event));
    await vi.advanceTimersByTimeAsync(5000);
    expect(events.at(-1)).toMatchObject({ phase: 'waiting', elapsedMs: 5000 });
    finish(decision); await pending;
    const count = events.length; await vi.advanceTimersByTimeAsync(10000);
    expect(events).toHaveLength(count);
  });
  it('requests a free model with native tools and validates its decision', async () => {
    const fetchMock = vi.fn().mockResolvedValue(goodResponse()); vi.stubGlobal('fetch', fetchMock);
    expect(await new OpenRouterProvider('secret-key').decide('open ChatGPT', observation, {})).toMatchObject(decision);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.model).toBe('openrouter/free'); expect(body.tool_choice).toBe('required');
    expect(body.models).toEqual(['openrouter/free']);
    expect(body.provider.require_parameters).toBe(true);
    expect(body.reasoning).toBeUndefined(); expect(body.parallel_tool_calls).toBeUndefined();
    expect(body.tools.some((t: any) => t.function.name === 'navigate')).toBe(true);
  });
  it('uses local decisions directly without a key', async () => {
    const local = { decide: vi.fn().mockResolvedValue(decision) };
    expect(await new FallbackProvider(null, local).decide('open ChatGPT', observation, {})).toBe(decision);
    expect(local.decide).toHaveBeenCalledTimes(1);
  });
  it.each([401, 429, 503])('falls back once on HTTP %s with identical task memory', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private upstream body', { status })));
    const local = { decide: vi.fn().mockResolvedValue(decision) }; const memory = { textSlots: { answer: 'verbatim private answer' } };
    expect(await new FallbackProvider(new OpenRouterProvider('key'), local).decide('open ChatGPT', observation, memory)).toBe(decision);
    expect(local.decide).toHaveBeenCalledExactlyOnceWith('open ChatGPT', observation, memory, undefined);
  });
  it('falls back on malformed or absent tool calls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'invalid secret' } }] }))));
    const local = { decide: vi.fn().mockResolvedValue(decision) };
    await new FallbackProvider(new OpenRouterProvider('key'), local).decide('open ChatGPT', observation, {});
    expect(local.decide).toHaveBeenCalledTimes(1);
  });
  it('times out and uses the local model', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('timeout'))))));
    const local = { decide: vi.fn().mockResolvedValue(decision) };
    await new FallbackProvider(new OpenRouterProvider('key', 'openrouter/free', 10), local).decide('open ChatGPT', observation, {});
    expect(local.decide).toHaveBeenCalledTimes(1);
  });
  it('never starts local fallback after user cancellation', async () => {
    const controller = new AbortController();
    const primary = { decide: vi.fn(async () => { controller.abort(); throw new DOMException('cancelled', 'AbortError'); }) };
    const local = { decide: vi.fn() };
    await expect(new FallbackProvider(primary, local).decide('open ChatGPT', observation, {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(local.decide).not.toHaveBeenCalled();
  });
  it('reports both provider failures', async () => {
    const primary = { decide: vi.fn().mockRejectedValue(new Error('OpenRouter HTTP 429')) };
    const local = { decide: vi.fn().mockRejectedValue(new Error('Ollama offline')) };
    await expect(new FallbackProvider(primary, local).decide('open ChatGPT', observation, {})).rejects.toThrow('OpenRouter HTTP 429; local fallback failed: Ollama offline');
  });
  it('redacts secrets and never includes saved answer contents in model memory', () => {
    const secret = 'never-log-this';
    expect(JSON.stringify(sanitizeLogData({ apiKey: secret, capturedText: secret, value: secret, prompt: secret }))).not.toContain(secret);
    expect(JSON.stringify(decisionContext('paste answer', observation, { textSlots: { answer: secret } }))).not.toContain(secret);
  });
});
