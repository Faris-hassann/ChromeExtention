import { describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';
import type { AgentDecision, BrowserObservation } from '../types.js';
import { AgentOrchestrator } from './orchestrator.js';
import { observe, result } from './test-events.js';

const page = (taskId: string, text = 'Example'): BrowserObservation => ({ observationId: crypto.randomUUID(), taskId, timestamp: new Date().toISOString(), tabId: '1', url: 'https://example.test/', title: 'Example', loadingState: 'complete', semanticContent: text, interactiveElements: [{ elementId: `el_${crypto.randomUUID()}`, role: 'button', name: 'Next' }] });
const scroll: AgentDecision = { type: 'tool_request', tool: 'scroll', arguments: { direction: 'down' } };
function setup(decide = vi.fn().mockResolvedValue(scroll)) {
  const events: any[] = [];
  const agent = new AgentOrchestrator({ decide }, undefined, event => events.push(event));
  const task = agent.create('Scroll down', 'always');
  return { agent, task, events, decide };
}
const actions = (events: any[]) => events.filter(e => e.event === 'server.action_request' && e.payload.tool !== 'observe_page');
function deferred() {
  let resolve!: (decision: AgentDecision) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<AgentDecision>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('task execution lifecycle', () => {
  it('serializes decisions and ignores duplicate, missing and wrong observation request IDs', async () => {
    const pending = deferred();
    const { agent, task, events, decide } = setup(vi.fn(() => pending.promise));
    const observation = page(task.id);
    const id = task.observationRequestId;
    await agent.observe(task.id, observation);
    await agent.observe(task.id, observation, 'wrong');
    expect(decide).not.toHaveBeenCalled();
    const first = agent.observe(task.id, observation, id);
    await agent.observe(task.id, page(task.id, 'Late'), id);
    expect(decide).toHaveBeenCalledTimes(1);
    pending.resolve(scroll); await first;
    const action = task.pending;
    await agent.observe(task.id, page(task.id), id);
    expect(task.pending).toBe(action);
    expect(actions(events)).toHaveLength(1);
  });

  it('accepts only the matching action result once and rejects stale observation responses', async () => {
    const { agent, task, events, decide } = setup();
    const initialId = task.observationRequestId;
    await observe(agent, task.id, page(task.id));
    const callId = task.pending!.toolCallId;
    agent.actionResult(task.id, { ok: true });
    agent.actionResult(task.id, { ok: true }, 'wrong');
    expect(task.pending?.toolCallId).toBe(callId);
    agent.actionResult(task.id, { ok: true }, callId);
    const requestId = task.observationRequestId;
    agent.actionResult(task.id, { ok: true }, callId);
    expect(task.observationRequestId).toBe(requestId);
    expect(events.filter(e => e.payload.tool === 'observe_page')).toHaveLength(1);
    await agent.observe(task.id, page(task.id), initialId);
    expect(decide).toHaveBeenCalledTimes(1);
    await agent.observe(task.id, page(task.id, 'Changed'), requestId);
    agent.actionResult(task.id, { ok: true }, callId);
    expect(task.pending).toBeDefined();
    expect(decide).toHaveBeenCalledTimes(2);
  });

  it.each(['pause', 'stop', 'disconnect'] as const)('discards a decision arriving after %s', async control => {
    const pending = deferred();
    const { agent, task, events } = setup(vi.fn(() => pending.promise));
    const first = observe(agent, task.id, page(task.id));
    if (control === 'disconnect') agent.disconnect(); else agent.control(task.id, control);
    pending.resolve(scroll); await first;
    expect(actions(events)).toHaveLength(0);
    expect(task.state).toBe(control === 'stop' ? 'CANCELLED' : 'PAUSED');
  });

  it('waits for cancelled planning to settle before deciding on the resumed fresh page', async () => {
    const old = deferred();
    const decide = vi.fn().mockImplementationOnce(() => old.promise).mockResolvedValue(scroll);
    const { agent, task, events } = setup(decide);
    const first = observe(agent, task.id, page(task.id));
    agent.control(task.id, 'pause'); agent.control(task.id, 'resume');
    await observe(agent, task.id, page(task.id, 'Resumed'));
    expect(decide).toHaveBeenCalledTimes(1);
    old.reject(new Error('Late provider failure')); await first;
    expect(decide).toHaveBeenCalledTimes(2);
    expect(actions(events)).toHaveLength(1);
    expect(task.state).toBe('RUNNING');
    expect(events.some(e => e.event === 'server.error')).toBe(false);
  });

  it('makes completion irreversible and emits it once', async () => {
    const { agent, task, events, decide } = setup(vi.fn().mockResolvedValue({ type: 'complete_request', summary: 'Destination verified' }));
    const id = task.observationRequestId;
    await observe(agent, task.id, page(task.id));
    expect(task.abort?.signal.aborted).toBe(true);
    await agent.observe(task.id, page(task.id), id);
    agent.actionResult(task.id, { ok: true }, 'late');
    for (const control of ['resume', 'approve', 'pause', 'stop'] as const) agent.control(task.id, control);
    agent.disconnect();
    expect(task.state).toBe('COMPLETED');
    expect(task.memory).toEqual({});
    expect(task.pending).toBeUndefined();
    expect(task.observationRequestId).toBeUndefined();
    expect(decide).toHaveBeenCalledTimes(1);
    expect(events.filter(e => e.event === 'server.task_state' && e.payload.state === 'COMPLETED')).toHaveLength(1);
  });

  it('waits for a fresh verification observation after success before completing', async () => {
    const decide = vi.fn().mockResolvedValueOnce(scroll).mockResolvedValueOnce({ type: 'complete_request', summary: 'Requested row is visible' });
    const { agent, task } = setup(decide);
    await observe(agent, task.id, page(task.id)); result(agent, task.id, { ok: true });
    expect(task.state).toBe('WAITING_FOR_PAGE');
    await observe(agent, task.id, page(task.id, 'Requested row'));
    expect(task.state).toBe('COMPLETED'); expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls[1]![1]).toMatchObject({ semanticContent: 'Requested row', lastActionResult: { ok: true } });
  });

  it('invalidates pending approval on disconnect', async () => {
    const { agent, task, events } = setup(); task.approvalMode = 'manual';
    await observe(agent, task.id, page(task.id));
    expect(task.state).toBe('WAITING_FOR_APPROVAL');
    agent.disconnect(); agent.control(task.id, 'approve');
    expect(task.state).toBe('PAUSED'); expect(actions(events)).toHaveLength(0);
  });

  it('pauses after three unchanged repetitions despite regenerated element IDs and timestamps', async () => {
    const { agent, task, events } = setup(vi.fn(async (_goal: string, observation: BrowserObservation) => ({ type: 'tool_request', tool: 'click', arguments: { elementId: observation.interactiveElements[0]!.elementId } })));
    for (let i = 0; i < 3; i++) { await observe(agent, task.id, page(task.id)); result(agent, task.id, { ok: true }); }
    await observe(agent, task.id, page(task.id));
    expect(task.state).toBe('PAUSED');
    expect(actions(events)).toHaveLength(3);
    expect(events.some(e => e.payload.message?.includes('without visible progress'))).toBe(true);
  });

  it('allows repeated actions while the visible page changes', async () => {
    const { agent, task, events } = setup();
    for (let i = 0; i < 5; i++) { await observe(agent, task.id, page(task.id, `Row ${i}`)); result(agent, task.id, { ok: true }); }
    expect(task.state).toBe('WAITING_FOR_PAGE');
    expect(actions(events)).toHaveLength(5);
    expect((task.memory.recentActions as unknown[])).toHaveLength(5);
    expect(task.memory.verification).toMatchObject({ changes: ['Visible page text changed'] });
  });

  it('bounds read-only tools and preserves total step ordering across resume', async () => {
    const previous = config.maxSteps; config.maxSteps = 2;
    try {
      const { agent, task, events } = setup(vi.fn().mockResolvedValue({ type: 'tool_request', tool: 'list_tabs', arguments: {} }));
      for (let i = 0; i < 2; i++) { await observe(agent, task.id, page(task.id)); result(agent, task.id, { ok: true }); }
      await observe(agent, task.id, page(task.id));
      expect(task.state).toBe('PAUSED'); expect(actions(events)).toHaveLength(2);
      agent.control(task.id, 'resume'); await observe(agent, task.id, page(task.id));
      expect(task.step).toBe(3); expect(task.automaticSteps).toBe(1);
    } finally { config.maxSteps = previous; }
  });

  it('allows waiting for generation but bounds the total automatic waits', async () => {
    const previous = config.maxSteps; config.maxSteps = 4;
    try {
      const { agent, task, events } = setup(vi.fn().mockResolvedValue({ type: 'tool_request', tool: 'wait_for_element', arguments: {} }));
      for (let i = 0; i < 4; i++) { await observe(agent, task.id, { ...page(task.id), responseState: { generating: true } }); result(agent, task.id, { ok: true }); }
      expect(actions(events)).toHaveLength(4);
      await observe(agent, task.id, { ...page(task.id), responseState: { generating: true } });
      expect(task.state).toBe('PAUSED');
      expect(events.some(e => e.payload.message?.includes('Maximum automatic steps'))).toBe(true);
    } finally { config.maxSteps = previous; }
  });
});
