import { afterEach, describe, expect, it, vi } from 'vitest';
import { FallbackProvider, OpenRouterProvider } from './provider.js';
import { decisionContext } from './ollama.js';
import { sanitizeLogData } from '../logger.js';
import type { BrowserObservation } from '../types.js';

const observation: BrowserObservation = { observationId: 'o', taskId: 't', timestamp: '', tabId: '1', url: 'https://google.com/', title: 'Google', loadingState: 'complete', interactiveElements: [] };
const decision = { type: 'tool_request' as const, tool: 'navigate' as const, arguments: { url: 'https://chatgpt.com/' } };
const goodResponse = () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'navigate', arguments: JSON.stringify(decision.arguments) } }] } }], model: 'test:free' }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('OpenRouter and fallback', () => {
  it('requests a free model with native tools and validates its decision', async () => {
    const fetchMock = vi.fn().mockResolvedValue(goodResponse()); vi.stubGlobal('fetch', fetchMock);
    expect(await new OpenRouterProvider('secret-key').decide('open ChatGPT', observation, {})).toMatchObject(decision);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.model).toBe('openrouter/free'); expect(body.tool_choice).toBe('required');
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
