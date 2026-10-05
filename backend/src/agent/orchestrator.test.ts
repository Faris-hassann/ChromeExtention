import { describe, expect, it } from 'vitest';
import { AgentOrchestrator } from './orchestrator.js';
import { PolicyEngine } from '../permissions/policy.js';
import type { BrowserObservation } from '../types.js';

const observation = (taskId: string): BrowserObservation => ({ observationId: crypto.randomUUID(), taskId, timestamp: new Date().toISOString(), tabId: '1', url: 'https://example.test/', title: 'Example', loadingState: 'complete', interactiveElements: [] });

describe('AgentOrchestrator', () => {
  it('dispatches medium- and high-risk actions without approval in user-selected always mode', async () => {
    const events: any[] = [];
    let call = 0;
    const llm = { decide: async () => ({ type: 'tool_request', tool: call++ ? 'submit_form' : 'type', arguments: { elementId: 'el_001', value: 'news' } }) } as any;
    const agent = new AgentOrchestrator(llm, new PolicyEngine(), event => events.push(event));
    const task = agent.create('Type news and submit', 'always');
    await agent.observe(task.id, observation(task.id)); agent.actionResult(task.id, { ok: true });
    await agent.observe(task.id, observation(task.id));
    expect(events.some(e => e.event === 'server.approval_request')).toBe(false);
    expect(events.filter(e => e.event === 'server.action_request').at(-1).payload.tool).toBe('submit_form');
  });
  it('requires a fresh observation after each meaningful action', async () => {
    const events: any[] = [];
    const llm = { decide: async () => ({ type: 'tool_request', tool: 'scroll', arguments: { direction: 'down' } }) } as any;
    const agent = new AgentOrchestrator(llm, new PolicyEngine(), event => events.push(event));
    const task = agent.create('Scroll down');
    await agent.observe(task.id, observation(task.id));
    expect(events.filter(e => e.event === 'server.action_request')).toHaveLength(1);
    expect(task.observationFresh).toBe(false);
    agent.actionResult(task.id, { ok: true });
    expect(task.state).toBe('WAITING_FOR_PAGE');
    expect(events.filter(e => e.event === 'server.action_request').at(-1).payload.tool).toBe('observe_page');
  });

  it('pauses all running tasks on transport disconnect', () => {
    const agent = new AgentOrchestrator({} as any, new PolicyEngine());
    const task = agent.create('Test'); task.state = 'RUNNING';
    agent.disconnect(); expect(task.state).toBe('PAUSED');
  });
});
