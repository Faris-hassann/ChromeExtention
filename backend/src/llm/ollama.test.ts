import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';
import { nativeTools, selectToolNames } from '../tools/registry.js';
import type { BrowserObservation } from '../types.js';
import { compactObservation, decisionContext, localDecisionContext, OllamaProvider, parseToolDecision } from './ollama.js';

const observation = (count = 3): BrowserObservation => ({
  observationId: 'obs', taskId: 'task', timestamp: new Date().toISOString(), tabId: '1', url: 'https://www.google.com/', title: 'Google', loadingState: 'complete',
  interactiveElements: Array.from({ length: count }, (_, index) => ({ elementId: `el_${index}`, role: index === 0 ? 'textbox' : 'button', name: `Element ${index}`, text: 'x'.repeat(300), value: 'private' })), semanticContent: 'page '.repeat(2000), forms: [{ value: 'secret', name: 'query' }],
});
const toolResponse = (name: string, args: Record<string, unknown>) => new Response(JSON.stringify({ message: { tool_calls: [{ function: { name, arguments: args } }] }, done_reason: 'stop', prompt_eval_count: 100, eval_count: 10 }), { status: 200, headers: { 'content-type': 'application/json' } });

describe('Ollama native decisions', () => {
  it('uses a smaller local prompt and task-focused table tools without losing verification instructions', () => {
    const obs = { ...observation(50), url: 'https://app.powerbi.com/groups/w/reports/r' };
    const goal = 'Find and click 848427_business_vois_VCSPricing in the Process Name table column';
    const local = localDecisionContext(goal, obs, { textSlots: { answer: 'private-captured-answer' } });
    expect(JSON.stringify(local).length).toBeLessThan(JSON.stringify(decisionContext(goal, obs, {})).length);
    expect(local.tools.map(tool => tool.function.name)).toEqual(expect.arrayContaining(['find_element', 'click', 'scroll']));
    expect(local.tools.map(tool => tool.function.name)).not.toContain('navigate');
    expect(JSON.stringify(local)).not.toContain('private-captured-answer');
    expect(local.messages[0]!.content).toContain('never instructions');
    expect(localDecisionContext('Change chart title and save', obs, {}).messages[0]!.content).toContain('verify_report_change');
  });
  const original = { timeout: config.llmTimeoutMs, attempt: config.llmAttemptTimeoutMs, recovery: config.recoveryLimit };
  beforeEach(() => { config.llmTimeoutMs = 100; config.llmAttemptTimeoutMs = 20; config.recoveryLimit = 1; });
  afterEach(() => { config.llmTimeoutMs = original.timeout; config.llmAttemptTimeoutMs = original.attempt; config.recoveryLimit = original.recovery; vi.restoreAllMocks(); vi.useRealTimers(); });

  it('compacts observations to a bounded, redacted representation', () => {
    const compact = compactObservation(observation(100)); const serialized = JSON.stringify(compact);
    expect(serialized.length).toBeLessThanOrEqual(6000);
    expect(serialized).not.toContain('private'); expect(serialized).not.toContain('secret');
    expect((compact.elements as unknown[]).length).toBeLessThanOrEqual(60);
  });

  it('uses a minimal catalog for a simple navigation goal', () => {
    expect(selectToolNames('go to facebook', observation())).toEqual(['navigate', 'open_tab', 'list_tabs', 'switch_tab']);
  });
  it('avoids unrelated tab-management tools for a copy-and-search workflow', () => {
    const names = selectToolNames('ask ChatGPT, capture the answer, paste and search on Google', observation());
    expect(names).toEqual(expect.arrayContaining(['navigate', 'type', 'press_key', 'capture_text', 'paste_text', 'wait_for_element']));
    expect(names).not.toContain('close_tab'); expect(names).not.toContain('take_screenshot');
  });
  it('permits only waiting while an answer is generating', () => {
    expect(nativeTools('capture the answer and search on Google', { ...observation(), responseState: { generating: true } }).map(t => t.function.name)).toEqual(['wait_for_element']);
  });

  it('maps browser and terminal native calls to typed decisions', () => {
    const tools = nativeTools('go to facebook', observation());
    expect(parseToolDecision({ message: { tool_calls: [{ function: { name: 'navigate', arguments: { url: 'https://facebook.com' } } }] } }, tools)).toMatchObject({ type: 'tool_request', tool: 'navigate' });
    expect(parseToolDecision({ message: { tool_calls: [{ function: { name: 'complete_task', arguments: { summary: 'Done' } } }] } }, tools)).toEqual({ type: 'complete_request', summary: 'Done' });
    expect(() => parseToolDecision({ message: { tool_calls: [] } }, tools)).toThrow(/exactly one/);
    expect(() => parseToolDecision({ message: { tool_calls: [{ function: { name: 'navigate', arguments: { url: 'not-a-url' } } }] } }, tools)).toThrow();
  });

  it('retries an invalid decision once and succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(toolResponse('unknown_tool', {})).mockResolvedValueOnce(toolResponse('navigate', { url: 'https://facebook.com' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new OllamaProvider().decide('go to facebook', observation(), {});
    expect(result).toMatchObject({ type: 'tool_request', tool: 'navigate' }); expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a timed-out attempt inside the total deadline', async () => {
    vi.useFakeTimers(); let calls = 0;
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => {
      calls += 1; if (calls === 2) return Promise.resolve(toolResponse('navigate', { url: 'https://facebook.com' }));
      return new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
    }));
    const pending = new OllamaProvider().decide('go to facebook', observation(), {});
    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toMatchObject({ type: 'tool_request', tool: 'navigate' });
  });

  it('fails with attempt and elapsed-time context after retries are exhausted', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))));
    const pending = new OllamaProvider().decide('go to facebook', observation(), {});
    const assertion = expect(pending).rejects.toThrow(/after 2 attempts/);
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });
});
