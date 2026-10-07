import type { BrowserToolName } from './browser-tools.contract';

export type TaskState =
  | 'CREATED'
  | 'PLANNING'
  | 'RUNNING'
  | 'WAITING_FOR_PAGE'
  | 'WAITING_FOR_APPROVAL'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type AgentDecision =
  | {
      type: 'tool_request';
      tool: BrowserToolName;
      arguments: unknown;
      userFacingActivity?: string;
    }
  | {
      type: 'complete_request';
      summary?: string;
    }
  | {
      type: 'user_input_required';
      question: string;
    };

/**
 * Runtime invariant:
 * Only one decision or browser action may be active per task. After a tool call,
 * its matching result and a requested fresh BrowserObservation must be consumed
 * before another tool call can be dispatched. Terminal tasks cannot restart.
 */
export const OBSERVATION_AFTER_ACTION_INVARIANT = true as const;
