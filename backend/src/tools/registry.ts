import { z } from 'zod';
import type { ToolDefinition, ToolName } from '../types.js';

const defs: ToolDefinition[] = [
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
  { name: 'wait_for_element', risk: 'LOW', capability: 'read_page', meaningful: false },
  { name: 'find_element', risk: 'LOW', capability: 'read_page', meaningful: false },
  { name: 'submit_form', risk: 'HIGH', capability: 'submit', meaningful: true },
];
export const toolRegistry = new Map(defs.map(def => [def.name, def]));

const elementArgs = z.object({ elementId: z.string().startsWith('el_') }).passthrough();
const schemas: Partial<Record<ToolName, z.ZodType>> = {
  navigate: z.object({ url: z.string().url() }).strict(), open_tab: z.object({ url: z.string().url().optional() }).strict(),
  click: elementArgs, double_click: elementArgs, fill: elementArgs.extend({ value: z.string() }), type: elementArgs.extend({ value: z.string() }),
  clear: elementArgs, focus: elementArgs, hover: elementArgs, check: elementArgs, uncheck: elementArgs,
  select_option: elementArgs.extend({ value: z.string() }), press_key: z.object({ key: z.string().min(1) }).passthrough(),
  switch_tab: z.object({ tabId: z.union([z.string(), z.number()]) }), close_tab: z.object({ tabId: z.union([z.string(), z.number()]).optional() }),
  scroll: z.object({ direction: z.enum(['up', 'down']), amount: z.number().optional() }).strict(), submit_form: elementArgs,
};
export function validateTool(name: ToolName, args: unknown): Record<string, unknown> {
  if (!toolRegistry.has(name)) throw new Error(`Unknown tool: ${name}`);
  return (schemas[name] ?? z.record(z.string(), z.unknown())).parse(args) as Record<string, unknown>;
}
export const exposedToolCatalog = defs.map(({ name, risk, capability }) => ({ name, risk, capability }));
