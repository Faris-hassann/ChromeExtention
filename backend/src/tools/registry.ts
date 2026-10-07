import { z } from 'zod';
import { isPowerBi, isReportEditGoal } from '../agent/powerbi.js';
import type { BrowserObservation, ToolDefinition, ToolName } from '../types.js';

const defs: ToolDefinition[] = [
  { name: 'verify_report_change', risk: 'LOW', capability: 'read_page', meaningful: true },
  { name: 'capture_text', risk: 'LOW', capability: 'extract_data', meaningful: true },
  { name: 'paste_text', risk: 'MEDIUM', capability: 'interact', meaningful: true },
  { name: 'observe_page', risk: 'LOW', capability: 'read_page', meaningful: false },
  { name: 'read_page', risk: 'LOW', capability: 'read_page', meaningful: false },
  { name: 'read_table', risk: 'LOW', capability: 'extract_data', meaningful: false },
  { name: 'read_form', risk: 'LOW', capability: 'extract_data', meaningful: false },
  { name: 'take_screenshot', risk: 'LOW', capability: 'screenshot', meaningful: false },
  ...(['navigate', 'go_back', 'go_forward', 'reload'] as ToolName[]).map(name => ({ name, risk: 'MEDIUM' as const, capability: 'navigate' as const, meaningful: true })),
  ...(['click', 'double_click', 'type', 'fill', 'clear', 'press_key', 'select_option', 'check', 'uncheck', 'hover', 'focus', 'scroll'] as ToolName[]).map(name => ({ name, risk: name === 'scroll' || name === 'hover' || name === 'focus' ? 'LOW' as const : 'MEDIUM' as const, capability: 'interact' as const, meaningful: true })),
  { name: 'list_tabs', risk: 'LOW', capability: 'read_page', meaningful: false },
  { name: 'open_tab', risk: 'MEDIUM', capability: 'navigate', meaningful: true },
  { name: 'close_tab', risk: 'MEDIUM', capability: 'interact', meaningful: true },
  { name: 'switch_tab', risk: 'LOW', capability: 'interact', meaningful: true },
  { name: 'upload_file', risk: 'MEDIUM', capability: 'file_transfer', meaningful: true },
  { name: 'download_file', risk: 'MEDIUM', capability: 'file_transfer', meaningful: true },
  { name: 'wait_for_element', risk: 'LOW', capability: 'read_page', meaningful: true },
  { name: 'find_element', risk: 'LOW', capability: 'read_page', meaningful: true },
  { name: 'submit_form', risk: 'HIGH', capability: 'submit', meaningful: true },
];
export const toolRegistry = new Map(defs.map(def => [def.name, def]));

const routingArgs = { frameId: z.string().regex(/^\d+$/).optional(), documentId: z.string().optional() };
const elementArgs = z.object({ elementId: z.string().startsWith('el_'), ...routingArgs }).passthrough();
export const toolSchemas: Partial<Record<ToolName, z.ZodType>> = {
  find_element: z.object({ text: z.string().trim().min(1).max(500), column: z.string().trim().min(1).optional(), exact: z.boolean().optional(), occurrence: z.number().int().min(1).max(100).optional() }).strict(),
  verify_report_change: elementArgs.extend({ property: z.enum(['chartType', 'title', 'color']), expectedValue: z.string().min(1) }).strict(),
  wait_for_element: z.object({ ...routingArgs, elementId: z.string().startsWith('el_').optional(), timeoutMs: z.number().min(100).max(5000).optional() }).strict(),
  capture_text: elementArgs.extend({ key: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/) }).strict(),
  paste_text: elementArgs.extend({ key: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/) }).strict(),
  navigate: z.object({ url: z.string().url() }).strict(), open_tab: z.object({ url: z.string().url().optional() }).strict(),
  click: elementArgs, double_click: elementArgs, fill: elementArgs.extend({ value: z.string() }), type: elementArgs.extend({ value: z.string() }),
  clear: elementArgs, focus: elementArgs, hover: elementArgs, check: elementArgs, uncheck: elementArgs,
  select_option: elementArgs.extend({ value: z.string() }), press_key: z.object({ key: z.string().min(1) }).passthrough(),
  switch_tab: z.object({ tabId: z.union([z.string(), z.number()]) }), close_tab: z.object({ tabId: z.union([z.string(), z.number()]).optional() }),
  scroll: z.object({ ...routingArgs, elementId: z.string().startsWith('el_').optional(), direction: z.enum(['up', 'down']), amount: z.number().optional() }).strict(), submit_form: elementArgs,
};
export function validateTool(name: ToolName, args: unknown): Record<string, unknown> {
  if (!toolRegistry.has(name)) throw new Error(`Unknown tool: ${name}`);
  return (toolSchemas[name] ?? z.record(z.string(), z.unknown())).parse(args) as Record<string, unknown>;
}
export const exposedToolCatalog = defs.map(({ name, risk, capability }) => ({ name, risk, capability }));

export type NativeTool = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };
const emptyParameters = { type: 'object', properties: {}, additionalProperties: false };
const elementParameters = { type: 'object', properties: { elementId: { type: 'string', description: 'Element ID from the latest observation' }, frameId: { type: 'string' }, documentId: { type: 'string' } }, required: ['elementId'], additionalProperties: false };
const descriptions: Partial<Record<ToolName, string>> = {
  find_element: 'Find a rendered table cell by text and optional column heading. Exact text matching is the default. For Process Name use the full identifier and column Process Name. The next observation prioritizes matching cells with fresh IDs; click that observed cell. occurrence defaults to 1, the first matching row. If not found, scroll the observed table grid and retry. This does not use the global website search.',
  verify_report_change: 'Read an actual Power BI editor setting after changing it. property is chartType, title, or color. expectedValue must be the requested setting as displayed in the editor (for colours use its hex value). Use a labelled title/colour input or a selected chart-type option. Verify each requested property before saving.',
  wait_for_element: 'Wait briefly before a fresh observation, especially while an answer is generating. Optionally wait for an observed element to appear.',
  capture_text: 'Capture the full text of an observed element in task memory using a key. Wait until generation finishes before capturing the latest answer.',
  paste_text: 'Paste exact text from an existing task memory key into an observed textbox, without rewriting it.',
  take_screenshot: 'Capture the currently visible page.', navigate: 'Navigate the active tab to an absolute HTTP or HTTPS URL.', go_back: 'Navigate the active tab backward.', go_forward: 'Navigate the active tab forward.', reload: 'Reload the active page.',
  click: 'Click an observed element.', double_click: 'Double-click an observed element.', type: 'Type text into an observed field.', fill: 'Replace an observed field value.', clear: 'Clear an observed field.', press_key: 'Press a keyboard key.', select_option: 'Select an option in an observed control.', check: 'Check an observed checkbox.', uncheck: 'Uncheck an observed checkbox.', hover: 'Hover over an observed element.', focus: 'Focus an observed element.', scroll: 'Scroll the page.',
  list_tabs: 'List browser tabs.', open_tab: 'Open a browser tab.', close_tab: 'Close a browser tab.', switch_tab: 'Switch to a browser tab.', submit_form: 'Submit the form containing an observed element.'
};

export function parametersFor(name: ToolName): Record<string, unknown> {
  if (name === 'find_element') return { type: 'object', properties: { text: { type: 'string' }, column: { type: 'string' }, exact: { type: 'boolean' }, occurrence: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['text'], additionalProperties: false };
  if (name === 'verify_report_change') return { type: 'object', properties: { elementId: { type: 'string' }, property: { type: 'string', enum: ['chartType', 'title', 'color'] }, expectedValue: { type: 'string' } }, required: ['elementId', 'property', 'expectedValue'], additionalProperties: false };
  if (name === 'wait_for_element') return { type: 'object', properties: { elementId: { type: 'string' }, timeoutMs: { type: 'number', minimum: 100, maximum: 5000 } }, additionalProperties: false };
  if (name === 'capture_text' || name === 'paste_text') return { type: 'object', properties: { elementId: { type: 'string' }, key: { type: 'string' } }, required: ['elementId', 'key'], additionalProperties: false };
  if (['click', 'double_click', 'clear', 'focus', 'hover', 'check', 'uncheck', 'submit_form'].includes(name)) return elementParameters;
  if (name === 'fill' || name === 'type' || name === 'select_option') return { type: 'object', properties: { elementId: { type: 'string' }, value: { type: 'string' } }, required: ['elementId', 'value'], additionalProperties: false };
  if (name === 'press_key') return { type: 'object', properties: { elementId: { type: 'string' }, key: { type: 'string' } }, required: ['key'], additionalProperties: false };
  if (name === 'navigate') return { type: 'object', properties: { url: { type: 'string', description: 'Fully qualified HTTP or HTTPS URL' } }, required: ['url'], additionalProperties: false };
  if (name === 'open_tab') return { type: 'object', properties: { url: { type: 'string' } }, additionalProperties: false };
  if (name === 'switch_tab') return { type: 'object', properties: { tabId: { anyOf: [{ type: 'string' }, { type: 'number' }] } }, required: ['tabId'], additionalProperties: false };
  if (name === 'close_tab') return { type: 'object', properties: { tabId: { anyOf: [{ type: 'string' }, { type: 'number' }] } }, additionalProperties: false };
  if (name === 'scroll') return { type: 'object', properties: { elementId: { type: 'string', description: 'Optional observed control within the pane to scroll' }, direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'number' } }, required: ['direction'], additionalProperties: false };
  return emptyParameters;
}

export function selectToolNames(goal: string, observation: BrowserObservation, reduced = false): ToolName[] {
  if (observation.responseState?.generating) return ['wait_for_element'];
  const reportEditing = isPowerBi(observation) && isReportEditGoal(goal);
  const simpleNavigation = /^(go|open|navigate|visit)\b/i.test(goal.trim()) && !/(\band\b|\bthen\b|click|search|find|type|fill|login|log in|sign in|download|upload|submit)/i.test(goal);
  if (simpleNavigation && !reportEditing) return reduced ? ['navigate'] : ['navigate', 'open_tab', 'list_tabs', 'switch_tab'];
  const names = new Set<ToolName>(['navigate', 'scroll']);
  if (isPowerBi(observation) || /find|table|row|grid|cell|column/i.test(goal)) names.add('find_element');
  if (reportEditing) for (const name of ['click', 'double_click', 'hover', 'focus', 'type', 'fill', 'clear', 'press_key', 'select_option', 'check', 'uncheck', 'verify_report_change'] as ToolName[]) names.add(name);
  if (/screenshot|screen shot/i.test(goal)) names.add('take_screenshot');
  if (/\btab[s]?\b/i.test(goal)) for (const name of ['list_tabs', 'open_tab', 'close_tab', 'switch_tab'] as ToolName[]) names.add(name);
  if (/\bback\b/i.test(goal)) names.add('go_back');
  if (/\bforward\b/i.test(goal)) names.add('go_forward');
  if (/reload|refresh/i.test(goal)) names.add('reload');
  const elements = observation.interactiveElements ?? [];
  names.add('wait_for_element');
  if (elements.length) names.add('capture_text');
  if (elements.some(element => ['textbox', 'searchbox'].includes(element.role ?? ''))) names.add('paste_text');
  if (elements.length) names.add('click');
  if (elements.length && /double.click/i.test(goal)) names.add('double_click');
  if (elements.length && /hover/i.test(goal)) names.add('hover');
  if (elements.length && /focus/i.test(goal)) names.add('focus');
  if (elements.some(element => ['textbox', 'searchbox'].includes(element.role ?? ''))) {
    names.add('type'); names.add('press_key');
    if (/fill|replace/i.test(goal)) names.add('fill');
    if (/clear|erase/i.test(goal)) names.add('clear');
  }
  if (!reduced && elements.some(element => ['combobox', 'listbox'].includes(element.role ?? ''))) names.add('select_option');
  if (!reduced && elements.some(element => element.role === 'checkbox')) { names.add('check'); names.add('uncheck'); }
  if (!reduced && ((observation.forms?.length ?? 0) > 0 || /submit|send|confirm|sign in|log in/i.test(goal))) names.add('submit_form');
  return [...names];
}

export function nativeTools(goal: string, observation: BrowserObservation, reduced = false): NativeTool[] {
  const browserTools: NativeTool[] = selectToolNames(goal, observation, reduced).map(name => ({ type: 'function', function: { name, description: descriptions[name] ?? `Use browser tool ${name}.`, parameters: parametersFor(name) } }));
  if (observation.responseState?.generating) return browserTools;
  return browserTools.concat([
    { type: 'function', function: { name: 'complete_task', description: 'Complete only when the latest observation visibly proves the user goal is satisfied.', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false } } },
    { type: 'function', function: { name: 'request_user_input', description: 'Pause when required information or a user decision is missing.', parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'], additionalProperties: false } } },
  ]);
}
