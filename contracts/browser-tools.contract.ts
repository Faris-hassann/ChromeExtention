/** Reference build contract. Adapt into the real shared types during implementation. */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type BrowserToolName =
  | 'verify_report_change'
  | 'capture_text'
  | 'paste_text'
  | 'observe_page'
  | 'read_page'
  | 'inspect_element'
  | 'read_text'
  | 'read_table'
  | 'read_form'
  | 'get_page_metadata'
  | 'take_screenshot'
  | 'navigate'
  | 'go_back'
  | 'go_forward'
  | 'reload'
  | 'wait_for_navigation'
  | 'click'
  | 'double_click'
  | 'type'
  | 'fill'
  | 'clear'
  | 'press_key'
  | 'select_option'
  | 'check'
  | 'uncheck'
  | 'hover'
  | 'focus'
  | 'scroll'
  | 'drag_drop'
  | 'list_tabs'
  | 'open_tab'
  | 'close_tab'
  | 'switch_tab'
  | 'upload_file'
  | 'download_file'
  | 'list_task_files'
  | 'read_console'
  | 'read_network_errors'
  | 'wait_for_element'
  | 'find_element';

export interface ToolDefinition {
  name: BrowserToolName;
  risk: RiskLevel;
  requiredCapability: string;
  meaningfulAction: boolean;
  timeoutMs?: number;
}

export interface ToolRequest<T = unknown> {
  taskId: string;
  stepId: string;
  toolCallId: string;
  tool: BrowserToolName;
  arguments: T;
}

export interface ToolResult<T = unknown> {
  toolCallId: string;
  ok: boolean;
  code?: string;
  data?: T;
  error?: string;
}
