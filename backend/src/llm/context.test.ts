import { describe, expect, it } from 'vitest';
import { nativeTools, selectToolNames } from '../tools/registry.js';
import type { BrowserObservation } from '../types.js';
import { compactObservation, decisionContext, parseToolDecision } from './context.js';

const observation = (count = 3): BrowserObservation => ({
  observationId: 'obs', taskId: 'task', timestamp: new Date().toISOString(), tabId: '1', url: 'https://www.google.com/', title: 'Google', loadingState: 'complete',
  interactiveElements: Array.from({ length: count }, (_, index) => ({ elementId: `el_${index}`, role: index === 0 ? 'textbox' : 'button', name: `Element ${index}`, text: 'x'.repeat(300), value: 'private' })), semanticContent: 'page '.repeat(2000), forms: [{ value: 'secret', name: 'query' }],
});
describe('Shared browser decisions', () => {
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

});
