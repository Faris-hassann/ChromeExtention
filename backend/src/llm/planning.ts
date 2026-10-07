import { z } from 'zod';
import { parametersFor, selectToolNames, validateTool, type NativeTool } from '../tools/registry.js';
import type { AgentDecision, BrowserObservation, SemanticElement, ToolName, Verification } from '../types.js';
import { targetArguments } from '../agent/targets.js';

export const verificationKinds = ['navigation', 'field_value', 'table_selection', 'dashboard_filter', 'exact_text_search', 'report_save', 'observe'] as const;
const argumentSchema = z.object({ url: z.string().optional(), value: z.string().optional(), key: z.string().optional(), text: z.string().optional(), column: z.string().optional(), exact: z.boolean().optional(), occurrence: z.number().optional(), direction: z.string().optional(), amount: z.number().optional(), timeoutMs: z.number().optional(), property: z.string().optional(), expectedValue: z.string().optional(), tabId: z.union([z.string(), z.number()]).optional() }).strict();
const verificationSchema = z.object({ kind: z.enum(verificationKinds), value: z.string().optional(), column: z.string().optional(), ref: z.string().optional() }).strict();
const planSchema = z.object({ actions: z.array(z.object({ tool: z.string(), ref: z.string().optional(), arguments: argumentSchema.default({}) }).strict()).min(1).max(6), verification: verificationSchema }).strict();

export function planningTools(): NativeTool[] {
  const props = Object.fromEntries(Object.keys(argumentSchema.shape).map(name => [name, name === 'exact' ? { type: 'boolean' } : ['occurrence', 'amount', 'timeoutMs'].includes(name) ? { type: 'number' } : name === 'tabId' ? { anyOf: [{ type: 'string' }, { type: 'number' }] } : { type: 'string' }]));
  return [
    { type: 'function', function: { name: 'execute_plan', description: 'Up to 6 sequential browser actions using supplied refs and allowed tools. Fresh targets and permissions are checked after every step. Use observe when local completion cannot prove the entire goal.', parameters: { type: 'object', properties: { actions: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'object', properties: { tool: { type: 'string' }, ref: { type: 'string' }, arguments: { type: 'object', properties: props, additionalProperties: false } }, required: ['tool'], additionalProperties: false } }, verification: { type: 'object', properties: { kind: { type: 'string', enum: verificationKinds }, ref: { type: 'string' }, value: { type: 'string' }, column: { type: 'string' } }, required: ['kind'], additionalProperties: false } }, required: ['actions', 'verification'], additionalProperties: false } } },
    { type: 'function', function: { name: 'complete_task', description: 'Finish only when evidence proves the entire goal.', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false } } },
    { type: 'function', function: { name: 'request_user_input', description: 'Ask when intent or targets remain ambiguous.', parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'], additionalProperties: false } } },
  ];
}
export function parsePlan(args: unknown, bindings: Record<string, SemanticElement>, allowed: ToolName[]): AgentDecision {
  const parsed = planSchema.parse(args);
  const actions = parsed.actions.map(action => {
    const tool = action.tool as ToolName;
    if (!allowed.includes(tool)) throw new Error('Plan requested an unavailable tool');
    const target = action.ref ? bindings[action.ref] : undefined;
    if (action.ref && !target) throw new Error('Unknown target reference');
    const params = parametersFor(tool) as { properties?: Record<string, unknown>; required?: string[] };
    if (Object.keys(action.arguments).some(key => !Object.hasOwn(params.properties ?? {}, key))) throw new Error('Unsupported action arguments');
    if (params.required?.includes('elementId') && !target) throw new Error('Target reference required');
    if (tool === 'press_key' && !target) throw new Error('Keyboard actions need a supplied target');
    const arguments_ = validateTool(tool, { ...action.arguments, ...(target ? targetArguments(target) : {}) });
    if (['navigate', 'open_tab'].includes(tool) && typeof arguments_.url === 'string' && !/^https?:\/\//i.test(arguments_.url)) throw new Error('Unsupported navigation protocol');
    return { tool, arguments: arguments_, ...(target ? { target: { ...target } } : {}) };
  });
  const verificationTarget = parsed.verification.ref ? bindings[parsed.verification.ref] : undefined;
  if (parsed.verification.ref && !verificationTarget) throw new Error('Unknown verification reference');
  const { ref: _ref, ...verification } = parsed.verification;
  if (['navigation', 'field_value', 'table_selection', 'dashboard_filter'].includes(verification.kind) && verification.value === undefined) throw new Error('Verification value required');
  if (verification.kind === 'field_value' && !verificationTarget) throw new Error('Verification target required');
  return { type: 'execution_plan', actions, verification: { ...verification, ...(verificationTarget ? { target: { ...verificationTarget } } : {}) } as Verification };
}
export const allowedPlanningTools = (goal: string, observation: BrowserObservation) => selectToolNames(goal, observation);
