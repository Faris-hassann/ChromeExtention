import { observe, result } from './test-events.js';
import { describe, expect, it } from 'vitest';
import { observeReportSave, recordReportAction, reportCompletionError } from './powerbi.js';
import { AgentOrchestrator } from './orchestrator.js';
import { nativeTools } from '../tools/registry.js';
import { compactObservation, decisionContext } from '../llm/context.js';
import type { BrowserObservation, ToolRequest } from '../types.js';

const observation = (): BrowserObservation => ({ observationId: 'o', taskId: 't', timestamp: '', tabId: '7', url: 'https://app.powerbi.com/groups/w/reports/r/ReportSection', title: 'Sales', loadingState: 'complete', interactiveElements: [{ elementId: 'el_title', name: 'Title text', value: 'Revenue', frameId: '2', documentId: 'doc' }, { elementId: 'el_save', name: 'Save', role: 'button' }], powerBi: { mode: 'edit', saveControlId: 'el_save', saveDisabled: false, saveMessages: [] } });
const action = (tool: ToolRequest['tool'], args: Record<string, unknown>): ToolRequest => ({ taskId: 't', stepId: 's', toolCallId: 'c', tool, arguments: args });
const goal = 'Change chart title to Revenue and save';
function verified() {
  const memory = {}; const obs = observation();
  recordReportAction(memory, obs, action('fill', { elementId: 'el_title', value: 'Revenue' }), { ok: true }, 1);
  expect(recordReportAction(memory, obs, action('verify_report_change', { elementId: 'el_title', property: 'title', expectedValue: 'Revenue' }), { ok: true, actualValue: 'Revenue', label: 'Title text' }, 2)).toMatchObject({ ok: true });
  return memory;
}
describe('Power BI report verification', () => {
  it('offers editor tools in both normal and reduced model contexts', () => {
    for (const reduced of [false, true]) {
      expect(nativeTools(goal, observation(), reduced).map(tool => tool.function.name)).toEqual(expect.arrayContaining(['hover', 'double_click', 'fill', 'press_key', 'verify_report_change']));
      expect(JSON.stringify(decisionContext(goal, observation(), {}, reduced))).toContain('Verify all changes before clicking Save');
    }
    expect(JSON.stringify(compactObservation(observation()))).toContain('Revenue');
    expect(JSON.stringify(compactObservation(observation()))).toContain('doc');
  });
  it('rejects incorrect readback and verification before any interaction', () => {
    const memory = {}; const obs = observation(); const request = action('verify_report_change', { property: 'title', expectedValue: 'Revenue' });
    expect(recordReportAction(memory, obs, request, { ok: true, actualValue: 'Revenue', label: 'Title text' }, 1)).toMatchObject({ ok: false });
    recordReportAction(memory, obs, action('fill', { elementId: 'el_title' }), { ok: true }, 2);
    expect(recordReportAction(memory, obs, request, { ok: true, actualValue: 'Wrong', label: 'Title text' }, 3)).toMatchObject({ ok: false });
    expect(recordReportAction(memory, obs, request, { ok: true, actualValue: 'Revenue', label: 'Unrelated' }, 3)).toMatchObject({ ok: false });
  });
  it('requires all requested properties and evidence after a successful save', () => {
    const memory = verified(); const obs = observation();
    expect(reportCompletionError('Change chart type to bar chart, title and colour', memory, obs)).toContain('chartType, color');
    expect(reportCompletionError(goal, memory, obs)).toContain('save is not verified');
    recordReportAction(memory, obs, action('click', { elementId: 'el_save' }), { ok: true }, 3);
    observeReportSave(memory, obs);
    expect(reportCompletionError(goal, memory, obs)).toContain('save is not verified');
    observeReportSave(memory, { ...obs, powerBi: { ...obs.powerBi!, saveMessages: ['Report saved successfully'] } });
    expect(reportCompletionError(goal, memory, obs)).toBeUndefined();
  });
  it('rejects stale confirmations, save errors and unsuccessful save clicks', () => {
    for (const ok of [false, true]) {
      const memory = verified(); const obs = observation(); obs.powerBi!.saveMessages = ['Report saved successfully'];
      recordReportAction(memory, obs, action('click', { elementId: 'el_save' }), { ok }, 3);
      observeReportSave(memory, obs);
      expect(reportCompletionError(goal, memory, obs)).toBeTruthy();
      observeReportSave(memory, { ...obs, powerBi: { ...obs.powerBi!, saveDisabled: true, saveMessages: ['Could not save report: error'] } });
      expect(reportCompletionError(goal, memory, obs)).toBeTruthy();
    }
  });
  it('accepts enabled-to-disabled save transition and invalidates later changes', () => {
    const memory = verified(); const obs = observation();
    recordReportAction(memory, obs, action('click', { elementId: 'el_save' }), { ok: true }, 3);
    observeReportSave(memory, { ...obs, powerBi: { ...obs.powerBi!, saveDisabled: true } });
    expect(reportCompletionError(goal, memory, obs)).toBeUndefined();
    recordReportAction(memory, obs, action('fill', { elementId: 'el_title', value: 'Other' }), { ok: true }, 4);
    expect(reportCompletionError(goal, memory, obs)).toContain('title');
  });
  it('does not treat a temporarily disabled button during saving as success', () => {
    const memory = verified(); const obs = observation();
    recordReportAction(memory, obs, action('click', { elementId: 'el_save' }), { ok: true }, 3);
    observeReportSave(memory, { ...obs, powerBi: { ...obs.powerBi!, saveDisabled: true, saving: true, saveMessages: ['Saving report...'] } });
    expect(reportCompletionError(goal, memory, obs)).toContain('save is not verified');
    observeReportSave(memory, { ...obs, powerBi: { ...obs.powerBi!, saveDisabled: true, saving: false, saveMessages: [] } });
    expect(reportCompletionError(goal, memory, obs)).toBeUndefined();
  });
  it('invalidates verification when another visual is selected', () => {
    const memory = verified(); const obs = observation();
    observeReportSave(memory, { ...obs, powerBi: { ...obs.powerBi!, selectedVisualId: 'first' } });
    observeReportSave(memory, { ...obs, powerBi: { ...obs.powerBi!, selectedVisualId: 'second' } });
    expect(reportCompletionError(goal, memory, obs)).toContain('title');
  });
  it('completes a verified and saved task through the real orchestrator', async () => {
    let step = 0;
    const decisions = [
      { type: 'tool_request', tool: 'fill', arguments: { elementId: 'el_title', value: 'Revenue' } },
      { type: 'tool_request', tool: 'verify_report_change', arguments: { elementId: 'el_title', property: 'title', expectedValue: 'Revenue' } },
      { type: 'tool_request', tool: 'click', arguments: { elementId: 'el_save' } },
      { type: 'complete_request', summary: 'Saved' },
    ];
    const agent = new AgentOrchestrator({ decide: async () => decisions[step++] } as any);
    const task = agent.create(goal, 'always');
    const obs = { ...observation(), taskId: task.id };
    await observe(agent, task.id, obs);
    result(agent, task.id, { ok: true }); await observe(agent, task.id, obs);
    result(agent, task.id, { ok: true, actualValue: 'Revenue', label: 'Title text' }); await observe(agent, task.id, obs);
    result(agent, task.id, { ok: true });
    await observe(agent, task.id, { ...obs, powerBi: { ...obs.powerBi!, saveMessages: ['Report saved successfully'] } });
    expect(task.state).toBe('COMPLETED'); expect(task.memory).toEqual({});
  });
  it('does not carry evidence into another report or affect read-only tasks', () => {
    const memory = verified(); const obs = observation();
    expect(reportCompletionError('Read this report', memory, obs)).toBeUndefined();
    expect(reportCompletionError(goal, memory, { ...obs, url: obs.url.replace('/r/', '/different/') })).toContain('title');
  });
  it('blocks premature completion in the real orchestrator and preserves pause/resume', async () => {
    const agent = new AgentOrchestrator({ decide: async () => ({ type: 'complete_request', summary: 'Done' }) });
    const task = agent.create(goal, 'always');
    await observe(agent, task.id, { ...observation(), taskId: task.id });
    expect(task.state).toBe('PAUSED'); expect(task.lastActionResult).toMatchObject({ code: 'REPORT_NOT_VERIFIED' });
    agent.control(task.id, 'resume'); expect(task.state).toBe('WAITING_FOR_PAGE');
    agent.control(task.id, 'stop'); expect(task.state).toBe('CANCELLED'); expect(task.memory).toEqual({});
  });
});
