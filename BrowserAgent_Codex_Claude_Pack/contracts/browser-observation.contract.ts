/** Reference BrowserObservation contract. */
export interface SemanticElement {
  elementId: string;
  role?: string;
  name?: string;
  text?: string;
  value?: string;
  disabled?: boolean;
  checked?: boolean;
  selected?: boolean;
  frameId?: string;
}

export interface BrowserObservation {
  observationId: string;
  taskId: string;
  timestamp: string;
  tabId: string;
  url: string;
  title: string;
  loadingState: 'loading' | 'interactive' | 'complete' | 'unknown';
  focusedElementId?: string;
  interactiveElements: SemanticElement[];
  semanticContent?: string;
  tables?: unknown[];
  forms?: unknown[];
  dialogs?: unknown[];
  toasts?: unknown[];
  frames?: unknown[];
  tabEvents?: unknown[];
  diff?: unknown;
  screenshotRef?: string;
  lastActionResult?: unknown;
  consoleErrors?: unknown[];
  networkErrors?: unknown[];
}
