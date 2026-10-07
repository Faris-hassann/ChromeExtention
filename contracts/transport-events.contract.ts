/** Reference transport event families for WebSocket MVP and Native Messaging future adapter. */
export type TransportEventName =
  | 'client.hello'
  | 'client.observation'
  | 'client.action_result'
  | 'client.user_control'
  | 'server.task_state'
  | 'server.action_request'
  | 'server.approval_request'
  | 'server.activity'
  | 'server.error';

export interface Envelope<T = unknown> {
  event: TransportEventName;
  taskId?: string;
  stepId?: string;
  toolCallId?: string;
  /** Required for observe_page requests and their client.observation responses. */
  requestId?: string;
  observationId?: string;
  tabId?: string;
  payload: T;
}
