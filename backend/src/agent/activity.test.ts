import { observe, result } from './test-events.js';
import { describe, expect, it } from 'vitest';
import { actionDescription, observedChanges } from './activity.js';
import { AgentOrchestrator } from './orchestrator.js';
import type { BrowserObservation } from '../types.js';

const observation = (): BrowserObservation => ({ observationId: 'a', taskId: 't', timestamp: '', tabId: '1', url: 'https://example.test/', title: 'Page', loadingState: 'complete', semanticContent: 'Before', interactiveElements: [{ elementId: 'el_old', role: 'gridcell', name: 'Process', text: 'Process', columnName: 'Process Name', selected: false }, { elementId: 'el_input', role: 'textbox', name: 'Secret value', value: 'private-before' }] });
describe('action and change messages', () => {
  it('detects real state changes despite refreshed element IDs without reporting field contents', () => {
    const before = observation(); const after = observation(); after.observationId = 'b';
    after.interactiveElements[0] = { ...after.interactiveElements[0]!, elementId: 'el_new', selected: true };
    after.interactiveElements[1] = { ...after.interactiveElements[1]!, value: 'private-after' };
    after.semanticContent = 'After';
    const changes = observedChanges(before, after);
    expect(changes).toEqual(expect.arrayContaining(['Table cell selected in Process Name', 'A field value changed', 'Visible page text changed']));
    expect(JSON.stringify(changes)).not.toContain('private-');
    expect(actionDescription({ taskId: 't', stepId: 's', toolCallId: 'c', tool: 'fill', arguments: { elementId: 'el_input', value: 'secret' } }, before)).toBe('Update the text field');
    expect(observedChanges(before, { ...before, observationId: 'new' })).toEqual([]);
  });
  it('forwards provider status and separates successful input from visible changes', async () => {
    const events: any[] = []; let count = 0;
    const llm = { decide: async (_goal: any, _obs: any, _memory: any, _signal: any, report: any) => {
      report({ provider: 'azure', phase: 'started', model: 'azure-gpt-mini', message: 'Using Azure OpenAI.' });
      return count++ ? { type: 'complete_request', summary: 'Done' } : { type: 'tool_request', tool: 'fill', arguments: { elementId: 'el_input', value: 'Updated' } };
    } } as any;
    const agent = new AgentOrchestrator(llm, undefined, event => events.push(event));
    const task = agent.create('Fill the field', 'always');
    await observe(agent, task.id, { ...observation(), taskId: task.id });
    expect(events.some(event => event.event === 'server.provider_progress' && event.taskId === task.id)).toBe(true);
    result(agent, task.id, { ok: true });
    expect(events.some(event => /Update the text field: succeeded/.test(event.payload.message || ''))).toBe(true);
    await observe(agent, task.id, { ...observation(), observationId: 'b', taskId: task.id });
    expect(events.some(event => /no visible page change detected/.test(event.payload.message || ''))).toBe(true);
  });
});
