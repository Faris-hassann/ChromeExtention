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
 * after a meaningful tool call, a new BrowserObservation must be received and
 * consumed before another meaningful tool call can be dispatched.
 */
export const OBSERVATION_AFTER_ACTION_INVARIANT = true as const;
