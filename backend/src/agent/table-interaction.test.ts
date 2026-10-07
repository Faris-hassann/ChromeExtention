import { observe, result } from './test-events.js';
import { describe, expect, it } from 'vitest';
import { recordTableInteraction, tableCompletionError, tableFollowup } from './table-interaction.js';
import { decisionContext } from '../llm/context.js';
import { validateTool } from '../tools/registry.js';
import type { BrowserObservation, ToolRequest } from '../types.js';
import { AgentOrchestrator } from './orchestrator.js';
import { isReportEditGoal } from './powerbi.js';

const text = '848427_business_vois_VCSPricing';
const goal = `Find and click ${text} in the bottom table Process Name column`;
const observation = (): BrowserObservation => ({ observationId: 'before', taskId: 't', timestamp: '', tabId: '7', url: 'https://app.powerbi.com/groups/w/reports/r', title: 'Hub', loadingState: 'complete', interactiveElements: [{ elementId: 'el_cell', role: 'gridcell', text, name: text, columnName: 'Process Name', rowText: `${text} Others 2026 MAY`, searchMatch: true }, { elementId: 'el_other', role: 'gridcell', text, columnName: 'Reusable Name' }] });
const action = (tool: ToolRequest['tool'], args: Record<string, unknown>): ToolRequest => ({ taskId: 't', stepId: 's', toolCallId: 'c', tool, arguments: args });
describe('named Power BI table interactions', () => {
  it('offers exact column-aware search without requiring report editing', () => {
    expect(isReportEditGoal('Apply a filter and click the process row')).toBe(false);
    expect(isReportEditGoal('Change the chart filter')).toBe(false);
    expect(isReportEditGoal('Set the chart title to Revenue')).toBe(true);
    for (const reduced of [false, true]) {
      const context = decisionContext(goal, observation(), {}, reduced);
      expect(context.tools.map(tool => tool.function.name)).toContain('execute_plan');
      expect(context.allowed).toContain('find_element');
      expect(context.allowed).not.toContain('verify_report_change');
      expect(context.messages[0]!.content).toContain('never global search for process filters');
      expect(context.messages[1]!.content).toContain('Process Name');
    }
    expect(validateTool('find_element', { text, column: 'Process Name', occurrence: 2 })).toMatchObject({ occurrence: 2 });
    expect(() => validateTool('find_element', { text: '' })).toThrow();
    expect(() => validateTool('find_element', { text, occurrence: 0 })).toThrow();
  });
  it('requires a successful click in the requested column and a fresh observation', () => {
    const memory = {}; const obs = observation();
    recordTableInteraction(memory, obs, action('find_element', { text, column: 'Process Name' }), { ok: true });
    expect(tableCompletionError(goal, memory, obs)).toContain('click');
    recordTableInteraction(memory, obs, action('click', { elementId: 'el_other' }), { ok: true });
    expect(tableCompletionError(goal, memory, obs)).toContain('click');
    recordTableInteraction(memory, obs, action('click', { elementId: 'el_cell' }), { ok: false });
    expect(tableCompletionError(goal, memory, obs)).toContain('click');
    recordTableInteraction(memory, obs, action('click', { elementId: 'el_cell' }), { ok: true });
    expect(tableCompletionError(goal, memory, obs)).toContain('Observe');
    expect(tableCompletionError(goal, memory, { ...obs, observationId: 'after' })).toBeUndefined();
    expect(tableCompletionError('Read this table', {}, obs)).toBeUndefined();
  });
  it('searches, clicks and completes through the orchestrator without a report-save requirement', async () => {
    let step = 0;
    const decisions = [
      { type: 'tool_request', tool: 'find_element', arguments: { text, column: 'Process Name' } },
      { type: 'tool_request', tool: 'click', arguments: { elementId: 'el_cell' } },
      { type: 'complete_request', summary: 'Clicked the first matching process row.' },
    ];
    const agent = new AgentOrchestrator({ decide: async () => decisions[step++] } as any);
    const task = agent.create(goal, 'always');
    await observe(agent, task.id, { ...observation(), taskId: task.id });
    result(agent, task.id, { ok: true, matchCount: 2 });
    await observe(agent, task.id, { ...observation(), taskId: task.id, observationId: 'found' });
    result(agent, task.id, { ok: true });
    await observe(agent, task.id, { ...observation(), taskId: task.id, observationId: 'clicked' });
    expect(task.state).toBe('COMPLETED');
    expect(step).toBe(1); // One model request interprets intent; follow-ups use browser evidence.
  });
  it('keeps richer goals and date-specific selections under model control', () => {
    const memory = {};
    recordTableInteraction(memory, observation(), action('find_element', { text, column: 'Process Name' }), { ok: true });
    expect(tableFollowup(goal, memory, observation())).toMatchObject({ tool: 'click' });
    for (const extra of [' then export', ' in June', ' for 2026 MAY', ' and change the chart title']) expect(tableFollowup(goal + extra, memory, observation())).toBeUndefined();
  });
});
