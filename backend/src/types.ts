export type TaskState = 'CREATED' | 'PLANNING' | 'RUNNING' | 'WAITING_FOR_PAGE' | 'WAITING_FOR_APPROVAL' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Capability = 'read_page' | 'extract_data' | 'screenshot' | 'navigate' | 'interact' | 'file_transfer' | 'submit';
export type ToolName = 'observe_page' | 'read_page' | 'read_table' | 'read_form' | 'take_screenshot' | 'navigate' | 'go_back' | 'go_forward' | 'reload' | 'click' | 'double_click' | 'type' | 'fill' | 'clear' | 'press_key' | 'select_option' | 'check' | 'uncheck' | 'hover' | 'focus' | 'scroll' | 'list_tabs' | 'open_tab' | 'close_tab' | 'switch_tab' | 'upload_file' | 'download_file' | 'wait_for_element' | 'find_element' | 'submit_form';

export interface SemanticElement { elementId: string; role?: string; name?: string; text?: string; value?: string; disabled?: boolean; checked?: boolean; selected?: boolean; frameId?: string }
export interface BrowserObservation { observationId: string; taskId: string; timestamp: string; tabId: string; url: string; title: string; loadingState: 'loading' | 'interactive' | 'complete' | 'unknown'; focusedElementId?: string; interactiveElements: SemanticElement[]; semanticContent?: string; tables?: unknown[]; forms?: unknown[]; dialogs?: unknown[]; toasts?: unknown[]; frames?: unknown[]; tabEvents?: unknown[]; diff?: unknown; screenshotRef?: string; lastActionResult?: unknown }
export interface ToolDefinition { name: ToolName; risk: RiskLevel; capability: Capability; meaningful: boolean }
export interface ToolRequest { taskId: string; stepId: string; toolCallId: string; tool: ToolName; arguments: Record<string, unknown> }
export type AgentDecision = { type: 'tool_request'; tool: ToolName; arguments: Record<string, unknown>; userFacingActivity?: string } | { type: 'complete_request'; summary?: string } | { type: 'user_input_required'; question: string };
export interface Envelope<T = unknown> { event: string; taskId?: string; stepId?: string; toolCallId?: string; observationId?: string; tabId?: string; payload: T }
export interface PermissionRule { id: string; scope: string; capabilities: Capability[]; duration: 'once' | 'session' | 'persistent'; effect: 'allow' | 'block' }
