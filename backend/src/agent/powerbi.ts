import type { BrowserObservation, ToolRequest } from '../types.js';

type Property = 'chartType' | 'title' | 'color';
interface ReportEdits {
  reportUrl: string;
  selectedVisualId?: string;
  editStep?: number;
  verified: Partial<Record<Property, { value: string; step: number }>>;
  saved?: boolean;
  pendingSave?: { step: number; messages: string[]; wasEnabled: boolean };
}
export function isPowerBi(observation: BrowserObservation) {
  try { return new URL(observation.url).hostname === 'app.powerbi.com'; } catch { return false; }
}
export function isReportEditGoal(goal: string) {
  const explicitEdit = /\b(edit|rename|format|save)\b/i.test(goal);
  const settingChange = /\b(change|update|replace|set|apply|make)\b/i.test(goal) && /\b(title|colou?r|formatting)\b|chart\s*type|visuali[sz]ation\s*type/i.test(goal);
  const chartChange = /\b(change|update|replace)\b/i.test(goal) && /\b(chart|graph|visual)\b/i.test(goal) && !/\b(filter|filters|slicer|slicers|row|rows)\b/i.test(goal);
  return explicitEdit || settingChange || chartChange;
}
export function requiredReportProperties(goal: string): Property[] {
  const properties: Property[] = [];
  if (/chart\s*type|visuali[sz]ation\s*type|\b(bar|column|line|pie|donut|scatter|area|funnel)\s*(chart|graph)|type\s+of\s+(chart|visual)/i.test(goal)) properties.push('chartType');
  if (/\b(title|rename)\b/i.test(goal)) properties.push('title');
  if (/\b(colou?r|blue|red|green|yellow|purple|orange|black|white)\b|#[0-9a-f]{6}\b/i.test(goal)) properties.push('color');
  return properties;
}
const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
function edits(memory: Record<string, unknown>, observation: BrowserObservation): ReportEdits {
  let state = memory.reportEdits as ReportEdits | undefined;
  // Query parameters may change while selecting visuals; the report path is stable.
  const url = new URL(observation.url); const reportUrl = url.origin + url.pathname;
  if (!state || state.reportUrl !== reportUrl) memory.reportEdits = state = { reportUrl, verified: {} };
  const selectedVisualId = observation.powerBi?.selectedVisualId;
  if (selectedVisualId && state.selectedVisualId && selectedVisualId !== state.selectedVisualId) { state.verified = {}; state.saved = false; state.pendingSave = undefined; }
  if (selectedVisualId) state.selectedVisualId = selectedVisualId;
  return state;
}
export function observeReportSave(memory: Record<string, unknown>, observation: BrowserObservation) {
  if (!isPowerBi(observation)) return;
  const state = edits(memory, observation); const pending = state.pendingSave;
  if (!pending || !observation.powerBi) return;
  const messages = observation.powerBi.saveMessages;
  const failed = messages.some(message => /couldn.t|cannot|failed|error|unable|not saved/i.test(message));
  const confirmed = messages.some(message => !pending.messages.includes(message) && /\breport saved\b|\bchanges saved\b|\bsaved successfully\b|\bsuccessfully saved\b|^saved[.!]?$/i.test(message));
  const disabled = pending.wasEnabled && !!observation.powerBi.saveControlId && observation.powerBi.saveDisabled === true;
  if (failed) { state.saved = false; state.pendingSave = undefined; }
  else if (!observation.powerBi.saving && !messages.some(message => /\bsaving\b/i.test(message)) && (confirmed || disabled)) { state.saved = true; state.pendingSave = undefined; }
}
export function recordReportAction(memory: Record<string, unknown>, observation: BrowserObservation, request: ToolRequest, result: unknown, step: number) {
  if (!isPowerBi(observation)) return result;
  const state = edits(memory, observation);
  const response = result as { ok?: boolean; actualValue?: string; label?: string; selected?: boolean };
  if (request.tool === 'verify_report_change') {
    const property = request.arguments.property as Property;
    const expected = String(request.arguments.expectedValue);
    const validLabel = property === 'chartType' ? response.selected && /chart|graph|scatter|funnel|treemap|matrix|table|card|gauge|slicer|map/i.test(response.actualValue ?? '') : property === 'title' ? /title/i.test(response.label ?? '') : /colou?r|hex/i.test(response.label ?? '');
    if (!response.ok || typeof response.actualValue !== 'string' || (property === 'title' ? response.actualValue !== expected : normalize(response.actualValue) !== normalize(expected)) || !validLabel || state.editStep === undefined) {
      delete state.verified[property];
      return { ok: false, code: 'REPORT_CHANGE_NOT_VERIFIED', error: 'The actual editor setting does not verify the requested change. Open the corresponding title, colour or selected chart-type control and check again.' };
    }
    state.verified[property] = { value: response.actualValue, step };
    return { ok: true, property, actualValue: response.actualValue };
  }
  if (!response.ok) return result;
  const target = observation.interactiveElements.find(el => el.elementId === request.arguments.elementId);
  const save = request.tool === 'click' && (target?.elementId === observation.powerBi?.saveControlId || /^(save|save report)$/i.test(target?.name ?? ''));
  const keyboardSave = request.tool === 'press_key' && /^(control|ctrl)\+s$/i.test(String(request.arguments.key));
  if (save || keyboardSave) {
    state.saved = false;
    state.pendingSave = { step, messages: observation.powerBi?.saveMessages ?? [], wasEnabled: !!observation.powerBi?.saveControlId && observation.powerBi.saveDisabled === false };
  } else if (['click', 'double_click', 'type', 'fill', 'clear', 'paste_text', 'select_option', 'check', 'uncheck', 'press_key'].includes(request.tool)) {
    // Selection and navigation clicks also invalidate save evidence conservatively.
    state.editStep = step; state.saved = false; state.pendingSave = undefined;
    const label = target?.name ?? '';
    if (/title/i.test(label)) delete state.verified.title;
    if (/colou?r|hex/i.test(label)) delete state.verified.color;
    if (target?.role === 'option' || /chart type|visuali[sz]ation type/i.test(label)) delete state.verified.chartType;
  }
  return result;
}
export function reportCompletionError(goal: string, memory: Record<string, unknown>, observation: BrowserObservation): string | undefined {
  if (!isReportEditGoal(goal) || (!isPowerBi(observation) && !memory.reportEdits)) return;
  if (!isPowerBi(observation)) return 'Return to the edited Power BI report to verify the result.';
  const state = edits(memory, observation); const required = requiredReportProperties(goal);
  if (!required.length && !Object.keys(state.verified).length) return 'Verify the changed chart type, title or colour before completing this report edit.';
  const missing = required.filter(property => !state.verified[property]);
  if (missing.length) return `Report changes are not verified: ${missing.join(', ')}. Open each setting and use verify_report_change.`;
  if (!state.saved) return 'The report save is not verified. Save the report and wait for a new save confirmation or the Save control to become disabled.';
}
