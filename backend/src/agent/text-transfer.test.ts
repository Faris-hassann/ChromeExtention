import { observe, result } from './test-events.js';
import { describe, expect, it, vi } from 'vitest';
import { AgentOrchestrator } from './orchestrator.js';
import { PolicyEngine } from '../permissions/policy.js';
import type { BrowserObservation } from '../types.js';

const observation = (taskId: string, url = 'https://chatgpt.com/'): BrowserObservation => ({ observationId: 'o', taskId, timestamp: '', tabId: '1', url, title: 'Page', loadingState: 'complete', interactiveElements: [{ elementId: 'el_001', role: 'textbox' }] });
describe('task text transfer', () => {
  it('preserves memory when completion is premature and verifies exact Google results before clearing it', async () => {
    const provider = { decide: vi.fn().mockResolvedValue({ type: 'complete_request', summary: 'Done' }) };
    const agent = new AgentOrchestrator(provider); const task = agent.create('capture_text the answer and search on Google');
    task.memory.textSlots = { answer: 'exact answer' };
    await observe(agent, task.id, observation(task.id, 'https://www.google.com/'));
    expect(task.state).toBe('PAUSED'); expect(task.memory.textSlots).toEqual({ answer: 'exact answer' });
    agent.control(task.id, 'resume');
    await observe(agent, task.id, { ...observation(task.id, 'https://www.google.com/search?q=exact%20answer'), searchResultsVisible: true });
    expect(task.state).toBe('COMPLETED'); expect(task.memory).toEqual({});
  });
  it('captures, preserves through pause/navigation, pastes verbatim, and clears on stop', async () => {
    const provider = { decide: vi.fn().mockResolvedValueOnce({ type: 'tool_request', tool: 'capture_text', arguments: { elementId: 'el_001', key: 'answer' } }).mockResolvedValueOnce({ type: 'tool_request', tool: 'paste_text', arguments: { elementId: 'el_001', key: 'answer' } }) };
    const policy = new PolicyEngine(); policy.addRule({ id: 'test', scope: 'www.google.com', capabilities: ['interact'], effect: 'allow', duration: 'session' });
    const events: any[] = []; const agent = new AgentOrchestrator(provider, policy, e => events.push(e)); const task = agent.create('copy ChatGPT answer and search on Google');
    await observe(agent, task.id, observation(task.id));
    const text = 'Exact & complete answer\nwith Unicode — today’s news';
    result(agent, task.id, { ok: true, capturedText: text });
    expect(task.memory.textSlots).toEqual({ answer: text });
    expect(JSON.stringify(events)).not.toContain(text);
    agent.control(task.id, 'pause'); agent.control(task.id, 'resume');
    await observe(agent, task.id, observation(task.id, 'https://www.google.com/'));
    expect(events.filter(e => e.event === 'server.action_request').at(-1).payload).toMatchObject({ tool: 'paste_text', arguments: { value: text } });
    agent.control(task.id, 'stop'); expect(task.memory).toEqual({}); expect(task.observation).toBeUndefined();
    result(agent, task.id, { ok: true, capturedText: 'late answer' }); expect(task.state).toBe('CANCELLED'); expect(task.memory).toEqual({});
  });
});
