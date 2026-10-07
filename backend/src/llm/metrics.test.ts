import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetricsStore, rate, requestTracker, type Pricing, type RequestMetrics } from './metrics.js';
import { AzureOpenAIProvider, type AzureSettings } from './provider.js';
import { AgentOrchestrator } from '../agent/orchestrator.js';
import { observe } from '../agent/test-events.js';
import type { BrowserObservation } from '../types.js';

const prices: Pricing = { input: 2, cached: 0.2, output: 8 };
const usage = { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100, prompt_tokens_details: { cached_tokens: 400 }, completion_tokens_details: { reasoning_tokens: 60 } };
const body = (extra: any = {}) => ({ model: 'gpt-5.4-mini-version', usage, choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ type: 'function', function: { name: 'complete_task', arguments: '{"summary":"Verified"}' } }] } }], ...extra });
const settings: AzureSettings = { azureEndpoint: 'https://example.openai.azure.com', azureApiKey: 'private-key', azureDeployment: 'mini', azureApiVersion: 'v', azureMaxTokens: 4096, azureTimeoutMs: 90000 };
const page = (taskId: string): BrowserObservation => ({ observationId: 'o', taskId, tabId: '1', timestamp: '', url: 'https://example.com', title: 'Example', loadingState: 'complete', interactiveElements: [] });
function measured(payload: any = body(), rates = prices) {
  const events: RequestMetrics[] = [];
  const tracker = requestTracker('mini', 'task', event => events.push(event), rates);
  tracker.capture(payload); tracker.finish('succeeded'); tracker.finish('failed');
  return { events, record: events[1]! };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Azure accounting', () => {
  it('counts cached and reasoning tokens as subsets and settles exactly once', () => {
    const { events, record } = measured();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ outcome: 'pending', inputTokens: null });
    expect(record).toMatchObject({ outcome: 'succeeded', inputTokens: 1000, outputTokens: 100, totalTokens: 1100, cachedInputTokens: 400, reasoningTokens: 60, toolCalls: 1, model: 'gpt-5.4-mini-version' });
    expect(record.estimatedCostUsd).toBeCloseTo(0.00208, 12);
    expect(record.latencyMs).toBeGreaterThanOrEqual(0);
  });
  it.each([undefined, '', ' ', '-1', 'NaN', 'Infinity'])('treats rate %s as unavailable', value => expect(rate(value)).toBeNull());
  it('accepts zero and fractional rates', () => { expect(rate('0')).toBe(0); expect(rate('0.125')).toBe(0.125); });
  it('redacts an echoed key and excludes response content and tool arguments from records', () => {
    const events: RequestMetrics[] = []; const tracker = requestTracker('mini', 'task', event => events.push(event));
    tracker.capture(body({ model: 'private-key', choices: [{ message: { content: 'private page contents', tool_calls: [{ type: 'function', function: { arguments: 'private arguments' } }] } }] }), 'private-key'); tracker.finish('failed');
    expect(events[1]?.model).toBe('[REDACTED]');
    expect(JSON.stringify(events)).not.toMatch(/private-key|private page contents|private arguments/);
  });
  it('does not round cost until display', () => expect(measured(body({ usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, prompt_tokens_details: { cached_tokens: 0 } } }), { input: .1234567, cached: null, output: .9876543 }).record.estimatedCostUsd).toBeCloseTo(.000001111111, 15));
  it('handles missing cached usage without inventing a zero', () => {
    const payload = body({ usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 } });
    expect(measured(payload).record).toMatchObject({ cachedInputTokens: null, reasoningTokens: null, estimatedCostUsd: null });
    expect(measured(payload, { input: 2, cached: 2, output: 8 }).record.estimatedCostUsd).toBeCloseTo(.0028);
  });
  it('needs no cached rate for explicit zero cache and accepts free pricing', () => {
    const payload = body({ usage: { ...usage, prompt_tokens_details: { cached_tokens: 0 } } });
    expect(measured(payload, { input: 2, cached: null, output: 8 }).record.estimatedCostUsd).toBeCloseTo(.0028);
    expect(measured(body(), { input: 0, cached: 0, output: 0 }).record.estimatedCostUsd).toBe(0);
    expect(measured(body(), { input: 2, cached: null, output: 8 }).record.estimatedCostUsd).toBeNull();
  });
  it.each([
    { ...usage, prompt_tokens: -1 }, { ...usage, completion_tokens: 1.5 }, { ...usage, total_tokens: 99 },
    { ...usage, prompt_tokens_details: { cached_tokens: 1001 } }, { ...usage, completion_tokens_details: { reasoning_tokens: 101 } },
  ])('rejects inconsistent usage for pricing without throwing', bad => {
    expect(measured(body({ usage: bad })).record).toMatchObject({ usageValid: false, estimatedCostUsd: null });
  });
  it('keeps unknown fields null and totals partial, rejects duplicate/stale records', () => {
    const store = new MetricsStore('task', prices); const { events } = measured();
    expect(store.accept(events[0]!)).toBe(true); expect(store.accept(events[0]!)).toBe(false);
    expect(store.accept(events[1]!)).toBe(true); expect(store.accept(events[1]!)).toBe(false); expect(store.accept(events[0]!)).toBe(false);
    expect(store.accept({ ...events[1]!, taskId: 'other', requestId: 'other' })).toBe(false);
    const unknown = measured({}).record; store.accept(unknown);
    const snapshot = store.snapshot();
    expect(snapshot).toMatchObject({ revision: 3, requestCount: 2, aggregates: { totalTokens: { value: 1100, partial: true }, estimatedCostUsd: { value: .00208, partial: true } } });
    expect(snapshot.averageLatencyMs).not.toBeNull();
    expect(JSON.stringify(snapshot)).not.toContain('private-key');
  });
  it.each(['content_filter', 'length', 'invalid', 'http', 'json'])('accounts for %s failures without replay', async kind => {
    const payload = body(kind === 'invalid' ? { choices: [{ message: { tool_calls: [] } }] } : { choices: [{ finish_reason: kind, message: {} }] });
    const response = kind === 'json' ? new Response('broken') : new Response(JSON.stringify(payload), { status: kind === 'http' ? 429 : 200 });
    const request = vi.fn().mockResolvedValue(response); vi.stubGlobal('fetch', request);
    const events: RequestMetrics[] = [];
    await expect(new AzureOpenAIProvider(settings).decide('Read page', page('task'), {}, undefined, undefined, event => events.push(event))).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1); expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ outcome: 'failed', totalTokens: kind === 'json' ? null : 1100 });
  });
  it('records timeout accounting and clears timers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))));
    const store = new MetricsStore('task');
    const result = new AzureOpenAIProvider({ ...settings, azureTimeoutMs: 20 }).decide('Read page', page('task'), {}, undefined, undefined, record => store.accept(record));
    const assertion = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(20); await assertion;
    expect(store.snapshot()).toMatchObject({ requestCount: 1, requests: [{ outcome: 'failed', inputTokens: null }] });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('counts no request for cancelled or unconfigured preflight', async () => {
    const events: RequestMetrics[] = []; const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController(); controller.abort();
    await expect(new AzureOpenAIProvider(settings).decide('Read', page('task'), {}, controller.signal, undefined, record => events.push(record))).rejects.toMatchObject({ name: 'AbortError' });
    await expect(new AzureOpenAIProvider({ ...settings, azureApiKey: '' }).decide('Read', page('task'), {}, undefined, undefined, record => events.push(record))).rejects.toMatchObject({ code: 'CONFIGURATION' });
    expect(events).toHaveLength(0); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['pause', 'stop', 'disconnect'] as const)('settles delayed accounting after %s without executing a decision', async action => {
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finish = resolve; })));
    const events: any[] = []; const agent = new AgentOrchestrator(new AzureOpenAIProvider(settings), undefined, event => events.push(event));
    const task = agent.create('Read page'); const pending = observe(agent, task.id, page(task.id));
    expect(task.metrics.snapshot().requestCount).toBe(1);
    if (action === 'disconnect') agent.disconnect(); else agent.control(task.id, action);
    finish(new Response(JSON.stringify(body()))); await pending;
    expect(task.state).toBe(action === 'stop' ? 'CANCELLED' : 'PAUSED');
    expect(task.metrics.snapshot()).toMatchObject({ requestCount: 1, requests: [{ outcome: 'cancelled', totalTokens: 1100 }] });
    expect(events.filter(event => event.event === 'server.task_metrics')).toHaveLength(2);
    expect(events.filter(event => event.event === 'server.action_request')).toHaveLength(0);
    if (action === 'stop') { agent.control(task.id, 'resume'); expect(task.state).toBe('CANCELLED'); }
  });
  it('preserves totals across pause/resume and verified completion', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(body({ choices: [{ message: { tool_calls: [{ type: 'function', function: { name: 'request_user_input', arguments: '{"question":"Continue?"}' } }] } }] })))).mockResolvedValueOnce(new Response(JSON.stringify(body())));
    vi.stubGlobal('fetch', request);
    const agent = new AgentOrchestrator(new AzureOpenAIProvider(settings)); const task = agent.create('Read example');
    await observe(agent, task.id, page(task.id)); expect(task.state).toBe('PAUSED');
    agent.control(task.id, 'resume'); await observe(agent, task.id, page(task.id));
    expect(task.state).toBe('COMPLETED'); expect(task.memory).toEqual({});
    expect(task.metrics.snapshot()).toMatchObject({ requestCount: 2, aggregates: { totalTokens: { value: 2200, partial: false } } });
    agent.control(task.id, 'resume'); await observe(agent, task.id, page(task.id)); expect(request).toHaveBeenCalledTimes(2);
  });
  it('shares greeting requests and excludes them from task accounting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body({ choices: [{ message: { content: 'Hi!', tool_calls: [] }, finish_reason: 'stop' }] })))));
    const provider = new AzureOpenAIProvider(settings); await Promise.all([provider.testAccess(), provider.testAccess()]);
    expect(provider.testMetrics()).toMatchObject({ taskId: null, requestCount: 1, requests: [{ outcome: 'succeeded', totalTokens: 1100, toolCalls: 0 }] });
    expect(JSON.stringify(provider.testMetrics())).not.toContain('Hi!');
  });
});
