import type { AgentOrchestrator } from './orchestrator.js';
import type { BrowserObservation } from '../types.js';

export const observe = (agent: AgentOrchestrator, taskId: string, observation: BrowserObservation) => agent.observe(taskId, observation, agent.tasks.get(taskId)?.observationRequestId);
export const result = (agent: AgentOrchestrator, taskId: string, payload: unknown) => agent.actionResult(taskId, payload, agent.tasks.get(taskId)?.pending?.toolCallId);
