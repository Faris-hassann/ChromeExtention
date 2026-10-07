import type { AgentDecision, BrowserObservation, ToolRequest } from '../types.js';

interface TableInteraction {
  text: string; column?: string; exact: boolean; occurrence: number;
  clicked?: { text: string; column?: string; row?: string; observationId: string; url: string };
}
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
export function recordTableInteraction(memory: Record<string, unknown>, observation: BrowserObservation, request: ToolRequest, result: unknown) {
  if (request.tool === 'find_element') {
    memory.tableInteraction = { text: String(request.arguments.text), column: request.arguments.column, exact: request.arguments.exact !== false, occurrence: request.arguments.occurrence ?? 1 };
  }
  const target = observation.interactiveElements.find(el => el.elementId === request.arguments.elementId);
  if (request.tool !== 'click' || !(result as { ok?: boolean })?.ok || target?.role !== 'gridcell') return;
  const search = memory.tableInteraction as TableInteraction | undefined;
  if (!search) return;
  const text = target.text || target.name || '';
  const matches = search.exact ? normalize(text) === normalize(search.text) : normalize(text).toLowerCase().includes(normalize(search.text).toLowerCase());
  if (!matches || (search.column && normalize(target.columnName || '').toLowerCase() !== normalize(search.column).toLowerCase())) return;
  search.clicked = { text, column: target.columnName, row: target.rowText, observationId: observation.observationId, url: observation.url };
}
export function tableCompletionError(goal: string, memory: Record<string, unknown>, observation: BrowserObservation) {
  if (!/\b(click|select|open)\b/i.test(goal)) return;
  const search = memory.tableInteraction as TableInteraction | undefined;
  if (!search && !/\b(table|row|cell|grid)\b|process name/i.test(goal)) return;
  if (!search?.clicked) return 'Find the requested table value in its column and click the matching cell before completing.';
  if (search.clicked.observationId === observation.observationId) return 'Observe the page after the matching table cell click before completing.';
}

// The model interprets the initial request. Once an exact process lookup has
// succeeded, the mechanical click and verification do not need more inference.
export function tableFollowup(goal: string, memory: Record<string, unknown>, observation: BrowserObservation): AgentDecision | undefined {
  const identifiers = goal.match(/\b\d{4,}_[a-zA-Z0-9_]+\b/g);
  if (identifiers?.length !== 1 || !/process name/i.test(goal) || !/\b(click|select)\b/i.test(goal)) return;
  if (/\b(then|also|after|edit|change|save|filter|export|download|copy|open|navigate|month|year|second|third|last|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b|\b20\d{2}\b/i.test(goal)) return;
  const search = memory.tableInteraction as TableInteraction | undefined;
  if (!search || search.text !== identifiers[0] || normalize(search.column || '').toLowerCase() !== 'process name' || search.occurrence !== 1 || !search.exact) return;
  if (search.clicked && search.clicked.observationId !== observation.observationId) return { type: 'complete_request', summary: `Clicked the first matching Process Name cell for ${search.text}.` };
  if (search.clicked) return;
  const target = observation.interactiveElements.find(el => el.role === 'gridcell' && el.searchMatch && (el.text || el.name) === search.text && normalize(el.columnName || '').toLowerCase() === 'process name');
  if (target) return { type: 'tool_request', tool: 'click', arguments: { elementId: target.elementId }, userFacingActivity: 'Exact Process Name match found; clicking the first matching row.' };
}
