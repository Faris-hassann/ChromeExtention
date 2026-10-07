import { isPowerBi, isReportEditGoal } from './powerbi.js';
import { normalize, resolveTarget, targetArguments } from './targets.js';
import type { AgentDecision, BrowserObservation, ExecutionSource, PlanAction, SemanticElement, ToolRequest, Verification } from '../types.js';

export interface Execution {
  actions: PlanAction[]; verification: Verification; cursor: number; source: ExecutionSource; baseline: BrowserObservation;
  last?: { request: ToolRequest; target?: SemanticElement; retried: boolean; result?: { ok?: boolean; code?: string } };
}
const oneGoal = (goal: string) => !/\b(then|also|after|and|export|download|copy|save|edit|login|sign)\b/i.test(goal);
const binding = (tool: PlanAction['tool'], target: SemanticElement, args = {}): PlanAction => ({ tool, arguments: { ...args, ...targetArguments(target) }, target: { ...target } });
export function startExecution(decision: Extract<AgentDecision, { type: 'execution_plan' }>, observation: BrowserObservation, source: ExecutionSource): Execution {
  return { ...decision, cursor: 0, source, baseline: observation };
}
export function verifyObjective(verification: Verification, before: BrowserObservation, after: BrowserObservation, goal: string, memory: Record<string, unknown>): string | undefined {
  if (before.observationId === after.observationId || before.tabId !== after.tabId || after.loadingState === 'loading' || after.responseState?.generating) return;
  const value = verification.value;
  // A model-supplied objective may not bypass other instructions in a rich goal.
  if (verification.kind !== 'report_save' && verification.kind !== 'exact_text_search' && !oneGoal(goal)) return;
  if (verification.kind === 'navigation' && value && /^(go|open|navigate|visit)\b/i.test(goal) && goal.includes(value)) {
    try { const requested = new URL(value); const actual = new URL(after.url); if (/^https?:$/.test(requested.protocol) && actual.hostname === requested.hostname && (requested.pathname === '/' || actual.pathname === requested.pathname) && (!requested.search || requested.search === actual.search) && (!requested.hash || requested.hash === actual.hash)) return 'Requested destination verified.'; } catch { /* No evidence. */ }
  }
  if (verification.kind === 'field_value' && value !== undefined && verification.target?.name && /\b(fill|type|set|replace|enter)\b/i.test(goal) && !/\b(search|submit|send)\b/i.test(goal)) {
    const target = resolveTarget(verification.target, after);
    if (target?.value === value && goal.includes(value) && goal.toLowerCase().includes((verification.target.name ?? '').toLowerCase()) && !isReportEditGoal(goal)) return 'The labelled field retains the requested value.';
  }
  const specificRow = /\b(month|year|second|third|last|20\d{2}|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(goal);
  if (verification.kind === 'table_selection' && value && goal.includes(value) && !specificRow && /\b(click|select)\b/i.test(goal) && !/\bfilter\b/i.test(goal)) {
    const search = memory.tableInteraction as { clicked?: { text?: string; observationId?: string } } | undefined;
    const selected = after.interactiveElements.filter(element => element.role === 'gridcell' && normalize(element.text || element.name) === value && element.columnName === (verification.column ?? 'Process Name') && element.selected);
    if (search?.clicked?.text === value && search.clicked.observationId !== after.observationId && selected.length) return `Selected the matching ${verification.column ?? 'Process Name'} row for ${value}.`;
  }
  if (verification.kind === 'dashboard_filter' && value && goal.includes(value) && !specificRow) {
    try {if (new URL(before.url).origin + new URL(before.url).pathname !== new URL(after.url).origin + new URL(after.url).pathname) return;} catch {return;}
    const filters = after.dashboardEvidence?.filters ?? [];
    if (filters.some(filter => /process name/i.test(filter.label) && normalize(filter.value) === value)) return `Verified the applied Process Name filter for ${value}.`;
    const selected = after.interactiveElements.filter(element => element.role === 'gridcell' && element.columnName === 'Process Name' && normalize(element.text || element.name) === value && element.selected);
    const clicked = (memory.tableInteraction as { clicked?: { text?: string } } | undefined)?.clicked;
    const prior = before.dashboardEvidence?.visuals ?? [];
    // Require a different dashboard visual, not the clicked table's own text.
    const changed = after.dashboardEvidence?.visuals.some(visual => !visual.processTable && !selected.some(cell => cell.widget === visual.key || cell.tableName === visual.key) && prior.some(old => old.key === visual.key && old.frameId === visual.frameId && old.text !== visual.text) && visual.text.includes(value));
    if (selected.length && clicked?.text === value && changed) return `Selected ${value}; another dashboard visual now shows updated data for that process.`;
  }
  const explicitSearch = goal.match(/^search\s+(?:for\s+)?["']([^"']+)["']\s*$/i)?.[1];
  if (verification.kind === 'exact_text_search' && /search/i.test(goal) && (/google/i.test(goal) || explicitSearch) && !/\b(screenshot|download|export|upload|save|edit|close)\b/i.test(goal)) {
    const slots = Object.values((memory.textSlots ?? {}) as Record<string, string>);
    try { const url = new URL(after.url); const query = url.searchParams.get('q')?.replace(/\r\n/g,'\n'); if (/^(www\.)?google\.[a-z.]+$/.test(url.hostname) && url.pathname === '/search' && after.searchResultsVisible && (slots.some(text=>text.replace(/\r\n/g,'\n') === query) || (explicitSearch && explicitSearch === query))) return 'Google results verify the exact requested search.'; } catch { /* No evidence. */ }
  }
  if (verification.kind === 'report_save' && isReportEditGoal(goal) && !/\b(download|export|copy|navigate|open|search|screenshot|close)\b/i.test(goal) && (memory.reportEdits as { saved?: boolean } | undefined)?.saved) return 'Report changes and save verified.';
}
export function nextExecution(execution: Execution, observation: BrowserObservation, goal: string, memory: Record<string, unknown>): { decision?: AgentDecision; source: ExecutionSource; discard?: boolean } {
  let source = execution.source;
  if (execution.last?.result) {
    const last = execution.last;
    if (last.result!.ok) { execution.cursor++; execution.last = undefined; }
    else if (last.result!.code === 'STALE_ELEMENT' && !last.retried && last.target) { last.retried = true; source = 'recovery'; }
    else return { source, discard: true };
  }
  if (execution.cursor >= execution.actions.length) {
    const summary = verifyObjective(execution.verification, execution.baseline, observation, goal, memory);
    return { source, discard: true, ...(summary ? { decision: { type: 'complete_request', summary } } : {}) };
  }
  const action = execution.actions[execution.cursor]!;
  if (observation.url !== execution.baseline.url && execution.cursor > 0) return { source, discard: true };
  const target = action.target ? resolveTarget(action.target, observation) : undefined;
  if (action.target && !target) return { source, discard: true };
  return { source, decision: { type: 'tool_request', tool: action.tool, arguments: { ...action.arguments, ...(target ? targetArguments(target) : {}) }, userFacingActivity: `${source === 'recovery' ? 'Local recovery' : 'Validated plan'}: ${action.tool.replaceAll('_',' ')}.` } };
}

export function localPlan(goal: string, observation: BrowserObservation): Extract<AgentDecision, { type: 'execution_plan' }> | undefined {
  if (!oneGoal(goal) || isReportEditGoal(goal)) return;
  const url = goal.match(/https?:\/\/[^\s]+/)?.[0];
  if (url && /^(go|open|navigate|visit)\b/i.test(goal) && !/\b(click|search|find|type|fill|tab)\b/i.test(goal)) return { type:'execution_plan', actions:[{tool:'navigate',arguments:{url}}], verification:{kind:'navigation',value:url} };
  const field = goal.match(/^(?:fill|set|replace|type|enter)\s+["']?([^"']+?)["']?\s+(?:with|to)\s+["']([^"']*)["']\s*$/i);
  if (field) {
    const matches = observation.interactiveElements.filter(element=>['textbox','searchbox'].includes(element.role ?? '') && normalize(element.name).toLowerCase() === normalize(field[1]).toLowerCase() && !element.disabled && element.value !== '[REDACTED]');
    if(matches.length===1){const target=matches[0]!;return {type:'execution_plan',actions:[binding('fill',target,{value:field[2]!})],verification:{kind:'field_value',value:field[2]!,target:{...target}}};}
  }
  // Only explicit single-purpose searches with one labelled search field.
  const query=goal.match(/^search\s+(?:for\s+)?["']([^"']+)["']\s*$/i)?.[1];
  if(query && /(^|\.)google\.[a-z.]+$/i.test(new URL(observation.url).hostname)) {
    const matches=observation.interactiveElements.filter(element=>['textbox','searchbox'].includes(element.role??'') && /search/i.test(element.name??'') && !element.disabled);
    if(matches.length===1){const target=matches[0]!;return {type:'execution_plan',actions:[binding('fill',target,{value:query}),binding('press_key',target,{key:'Enter'})],verification:{kind:'exact_text_search',value:query}};}
  }
}

export interface ProcessWorkflow { goal: string; value: string; mode: 'selection' | 'filter'; attempted: Array<'row'|'filter'>; route?: 'row'|'filter'; stage: 'choose'|'find'|'click'|'open'|'fill'|'apply'|'verify'|'undo'; baseline: BrowserObservation; widget?: string; target?: SemanticElement; beforeChecked?: boolean; changedOption?: SemanticElement; undoKind?: 'row'|'filter'; failed?: boolean; waits: number }
export function processWorkflow(goal: string, observation: BrowserObservation): ProcessWorkflow | undefined {
  const ids=goal.match(/\b\d{4,}_[a-zA-Z0-9_]+\b/g);
  if(!isPowerBi(observation) || ids?.length!==1 || !oneGoal(goal) || !/\b(filter|select|click)\b/i.test(goal) || /\b(month|year|second|third|last|20\d{2}|jan(?:uary)?|feb(?:ruary)?|march|april|may|june|july|august|sept(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(goal)) return;
  return {goal,value:ids[0]!,mode:/\bfilter\b/i.test(goal)?'filter':'selection',attempted:[],stage:'choose',baseline:observation,waits:0};
}
export function nextProcess(workflow: ProcessWorkflow, observation: BrowserObservation, memory: Record<string, unknown>): AgentDecision | undefined {
  if(workflow.failed) return;
  if (workflow.baseline.tabId !== observation.tabId || new URL(workflow.baseline.url).origin + new URL(workflow.baseline.url).pathname !== new URL(observation.url).origin + new URL(observation.url).pathname) { workflow.failed = true; return; }
  const scoped = (element: SemanticElement) => element.widget === workflow.widget && element.frameId === workflow.target?.frameId && element.documentId === workflow.target?.documentId && !element.disabled;
  const result=observation.lastActionResult as {ok?:boolean;code?:string;matchCount?:number}|undefined;
  if(workflow.stage==='verify') {
    if(result?.ok === false){workflow.failed=true;return;}
    const summary=verifyObjective({kind:workflow.mode==='filter'?'dashboard_filter':'table_selection',value:workflow.value,column:'Process Name'},workflow.baseline,observation,workflow.goal,memory);
    if(summary) return {type:'complete_request',summary};
    if(workflow.waits++<2) return {type:'tool_request',tool:'wait_for_element',arguments:{timeoutMs:500}};
    const current=workflow.target ? resolveTarget(workflow.target,observation):undefined;
    if(workflow.route==='row' && !workflow.beforeChecked && (!current || current.selected === undefined)) {workflow.failed=true;return;}
    // Undo only a selection this workflow introduced, with confirmed selected state.
    if(workflow.route==='row' && current?.selected && !workflow.beforeChecked && !workflow.attempted.includes('filter')) {workflow.stage='undo';workflow.undoKind='row';return {type:'tool_request',tool:'click',arguments:targetArguments(current),userFacingActivity:'Clearing this attempt’s row selection before trying a scoped filter.'};}
    const option=workflow.changedOption ? resolveTarget(workflow.changedOption,observation) : undefined;
    if(workflow.route==='filter' && workflow.changedOption && !option) {workflow.failed=true;return;}
    if(workflow.route==='filter' && option?.checked && !workflow.attempted.includes('row')) {workflow.stage='undo';workflow.undoKind='filter';return {type:'tool_request',tool:'uncheck',arguments:targetArguments(option),userFacingActivity:'Clearing only this attempt’s new checkbox selection before trying the process row.'};}
    workflow.stage='choose';
  }
  if(workflow.stage==='undo') {if(!result?.ok){workflow.failed=true;return;}const seed=workflow.undoKind==='filter'?workflow.changedOption:workflow.target;const current=seed?resolveTarget(seed,observation):undefined;if(!current || (workflow.undoKind==='filter'?current.checked:current.selected)){workflow.failed=true;return;} workflow.stage='choose';}
  if(workflow.stage==='choose') {
    const row=observation.interactiveElements.filter(element=>element.role==='gridcell'&&element.columnName==='Process Name'&&normalize(element.text||element.name)===workflow.value&&!element.disabled);
    const controls=observation.interactiveElements.filter(element=>!element.disabled && /process name/i.test(element.widget??'') && /textbox|searchbox|combobox|button/.test(element.role??'') && /filter|search|process name/i.test(element.name??''));
    if(workflow.mode==='selection' || (row.length && (!controls.length || workflow.attempted.includes('filter')) && !workflow.attempted.includes('row'))) {if(workflow.attempted.includes('row')){workflow.failed=true;return;}workflow.route='row';workflow.attempted.push('row');workflow.stage='find';workflow.waits=0;return {type:'tool_request',tool:'find_element',arguments:{text:workflow.value,column:'Process Name',exact:true,occurrence:1}};}
    if(controls.length===1&&!workflow.attempted.includes('filter')) {const control=controls[0]!;workflow.route='filter';workflow.attempted.push('filter');workflow.waits=0;workflow.widget=control.widget;workflow.stage=control.role==='button'?'open':'fill';workflow.target={...control};return {type:'tool_request',tool:control.role==='button'?'click':'fill',arguments:{...targetArguments(control),...(control.role==='button'?{}:{value:workflow.value})}};}
    if(!row.length&&!controls.length&&!workflow.attempted.length){workflow.route='row';workflow.attempted.push('row');workflow.stage='find';return {type:'tool_request',tool:'find_element',arguments:{text:workflow.value,column:'Process Name',exact:true,occurrence:1}};}
    // Both mechanisms or several filter widgets need interpretation.
    workflow.failed=true;return;
  }
  if(workflow.stage==='find') {
    if(!result?.ok){workflow.stage='choose';return nextProcess(workflow,observation,memory);}
    const cells=observation.interactiveElements.filter(element=>element.searchMatch&&element.columnName==='Process Name'&&normalize(element.text||element.name)===workflow.value);
    const tables=new Set(cells.map(element=>[element.frameId,element.tableName,element.widget].join('|')));
    if(tables.size>1){workflow.failed=true;return {type:'user_input_required',question:'The process appears in several tables. Which table should I use?'};}
    const cell=cells[0];if(!cell){workflow.stage='choose';return nextProcess(workflow,observation,memory);}
    workflow.target={...cell};workflow.beforeChecked=cell.selected;workflow.stage='click';return {type:'tool_request',tool:'click',arguments:targetArguments(cell)};
  }
  if(workflow.stage==='click'){if(!result?.ok){workflow.failed=true;return;}workflow.stage='verify';return nextProcess(workflow,observation,memory);}
  if(workflow.stage==='open') {
    if(!result?.ok){workflow.failed=true;return;}
    const fields=observation.interactiveElements.filter(element=>scoped(element)&&['textbox','searchbox'].includes(element.role??'')&&/search|filter|process name/i.test(element.name??''));
    if(fields.length!==1){workflow.failed=true;return;}const target=fields[0]!;workflow.stage='fill';return {type:'tool_request',tool:'fill',arguments:{...targetArguments(target),value:workflow.value}};
  }
  if(workflow.stage==='fill') {
    if(!result?.ok){workflow.failed=true;return;}
    const options=observation.interactiveElements.filter(element=>scoped(element)&&['checkbox','option'].includes(element.role??'')&&normalize(element.text||element.name)===workflow.value);
    const apply=observation.interactiveElements.filter(element=>scoped(element)&&element.role==='button'&&/^(apply|apply filter|ok)$/i.test(normalize(element.name)));
    if(options.length===1){workflow.stage='apply';if(options[0]!.role==='checkbox' && !options[0]!.checked)workflow.changedOption={...options[0]!};return {type:'tool_request',tool:options[0]!.role==='checkbox'?'check':'click',arguments:targetArguments(options[0]!)};}
    if(apply.length===1){workflow.stage='verify';return {type:'tool_request',tool:'click',arguments:targetArguments(apply[0]!)};}
    workflow.stage='verify';return nextProcess(workflow,observation,memory);
  }
  if(workflow.stage==='apply') {if(!result?.ok){workflow.failed=true;return;}const apply=observation.interactiveElements.filter(element=>scoped(element)&&element.role==='button'&&/^(apply|apply filter|ok)$/i.test(normalize(element.name)));workflow.stage='verify';if(apply.length===1)return {type:'tool_request',tool:'click',arguments:targetArguments(apply[0]!)};return nextProcess(workflow,observation,memory);}
}
