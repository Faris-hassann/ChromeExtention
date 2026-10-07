import { localPlan, nextExecution, nextProcess, processWorkflow, startExecution, verifyObjective, type Execution, type ProcessWorkflow } from './executor.js';
import { targetArguments, resolveTarget } from './targets.js';
import { MetricsStore } from '../llm/metrics.js';
import { createHash, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { AzureOpenAIProvider, type DecisionProvider } from '../llm/provider.js';
import { PolicyEngine } from '../permissions/policy.js';
import { toolRegistry, validateTool } from '../tools/registry.js';
import type { BrowserObservation, Envelope, TaskState, ToolRequest, AgentDecision, ExecutionSource, PlanAction, TaskReason } from '../types.js';
import { describeError, log } from '../logger.js';
import { actionDescription, observedChanges } from './activity.js';
import { recordTableInteraction, tableCompletionError, tableFollowup } from './table-interaction.js';
import { observeReportSave, recordReportAction, reportCompletionError } from './powerbi.js';

export interface AgentTask { reason?: TaskReason; execution?: Execution; workflow?: ProcessWorkflow; localAttempted?: boolean; recovery?: { action: PlanAction; retried: boolean }; executionSource?: ExecutionSource; metrics: MetricsStore; id: string; goal: string; approvalMode?: 'manual' | 'auto' | 'always'; state: TaskState; step: number; automaticSteps: number; generation: number; planning: boolean; observationRequestId?: string; repetitions: Map<string, number>; observationFresh: boolean; observation?: BrowserObservation; lastActionResult?: unknown; memory: Record<string, unknown>; pending?: ToolRequest; pendingApproval?: ToolRequest; abort?: AbortController; pendingChanges?: { before: BrowserObservation; label: string }; actionStartedAt?: number }
type Emit = (message: Envelope) => void;
const terminal = (state: TaskState) => ['CANCELLED', 'COMPLETED', 'FAILED'].includes(state);

// Ignore transport IDs and incremental diffs; compare the actual visible page state.
function semantic(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semantic);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(.*Id|.*Token|timestamp|diff|lastActionResult|screenshotRef|tabEvents|priority|searchMatch)$/.test(key)).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, semantic(item)]));
  return value;
}
function actionFingerprint(request: ToolRequest, observation: BrowserObservation) {
  const args = { ...request.arguments };
  if (args.elementId) {
    const index = observation.interactiveElements.findIndex(el => el.elementId === args.elementId);
    args.target = { index, element: semantic(observation.interactiveElements[index]) };
  }
  return createHash('sha256').update(JSON.stringify([request.tool, semantic(args), semantic(observation)])).digest('hex');
}

export class AgentOrchestrator {
  readonly tasks = new Map<string, AgentTask>();
  constructor(private llm: DecisionProvider = new AzureOpenAIProvider(), private policy = new PolicyEngine(), private emit: Emit = () => undefined) {}
  create(goal: string, approvalMode: 'manual' | 'auto' | 'always' = 'auto') {
    const id = randomUUID();
    const task: AgentTask = { id, metrics: new MetricsStore(id), goal, approvalMode, state: 'CREATED', step: 0, automaticSteps: 0, generation: 0, planning: false, observationRequestId: randomUUID(), repetitions: new Map(), observationFresh: false, memory: {} };
    log('info', 'task.created', { taskId: task.id, goalLength: goal.length });
    this.tasks.set(task.id, task); this.state(task, 'WAITING_FOR_PAGE');
    return task;
  }
  async observe(taskId: string, observation: BrowserObservation, requestId?: string) {
    const task = this.require(taskId);
    if (task.state !== 'WAITING_FOR_PAGE' || task.pending || task.pendingApproval || !requestId || requestId !== task.observationRequestId || observation.taskId !== taskId) return;
    task.observationRequestId = undefined;
    task.generation += 1;
    log('info', 'task.observation.received', { taskId, observationId: observation.observationId, url: observation.url, title: observation.title, loadingState: observation.loadingState, interactiveElementCount: observation.interactiveElements?.length ?? 0, step: task.step });
    if (task.pendingChanges) {
      const changes = observedChanges(task.pendingChanges.before, observation);
      task.memory.verification = { action: task.pendingChanges.label, changes };
      this.emit({ event: 'server.activity', taskId, payload: { message: `After ${task.pendingChanges.label}: ${changes.length ? changes.join('; ') + '.' : 'no visible page change detected yet.'}`, detail: { changes, stage: 'observation' } } });
      task.pendingChanges = undefined;
    }
    task.observation = { ...observation, lastActionResult: observation.lastActionResult ?? task.lastActionResult };
    observeReportSave(task.memory, task.observation);
    task.lastActionResult = undefined; task.observationFresh = true;
    await this.advance(task);
  }
  actionResult(taskId: string, payload: unknown, toolCallId?: string) {
    const current = this.require(taskId);
    if (current.state !== 'RUNNING' || !current.pending || !toolCallId || toolCallId !== current.pending.toolCallId) return;
    if (current.pending && current.observation) recordTableInteraction(current.memory, current.observation, current.pending, payload);
    if (current.pending && current.observation) payload = recordReportAction(current.memory, current.observation, current.pending, payload, current.step);
    if ((payload as { ok?: boolean })?.ok && current.pending) {
      const recent = (current.memory.recentActions ??= []) as Array<Record<string, unknown>>;
      const target = current.observation?.interactiveElements.find(el => el.elementId === current.pending!.arguments.elementId);
      recent.push({ tool: current.pending.tool, url: current.pending.arguments.url, elementId: current.pending.arguments.elementId, key: current.pending.arguments.key, target: target ? { role: target.role, name: target.name?.slice(0, 120), columnName: target.columnName, rowText: target.rowText?.slice(0, 200) } : undefined });
      if (recent.length > config.maxSteps) recent.shift();
    }
    if (current.pending?.tool === 'capture_text') {
    const result = payload as { ok?: boolean; capturedText?: string };
      if (result.ok && typeof result.capturedText === 'string') {
        if (Buffer.byteLength(result.capturedText, 'utf8') > 32768) payload = { ok: false, code: 'TEXT_LIMIT', error: 'Captured text exceeds 32 KiB' };
        else {
          const key = String(current.pending.arguments.key);
          const slots = (current.memory.textSlots ??= Object.create(null)) as Record<string, string>;
          slots[key] = result.capturedText;
          payload = { ok: true, key, characters: result.capturedText.length };
        }
      }
    }
      if (current.execution?.last) current.execution.last.result = payload as { ok?: boolean; code?: string };
    if (!current.execution && (payload as { code?: string }).code === 'STALE_ELEMENT' && current.pending && !current.recovery?.retried) {
      const target = current.observation?.interactiveElements.find(element => element.elementId === current.pending!.arguments.elementId);
      if (target) current.recovery = { action: { tool: current.pending.tool, arguments: { ...current.pending.arguments }, target: { ...target } }, retried: false };
    } else if (current.recovery?.retried) { if (!(payload as { ok?: boolean }).ok && current.workflow) current.workflow.failed = true; current.recovery = undefined; }
    const result = payload as { ok?: boolean; error?: string; matchCount?: number; code?: string };
    if (current.pending) {
      const label = actionDescription(current.pending, current.observation);
      const durationMs = current.actionStartedAt ? Math.round(performance.now() - current.actionStartedAt) : undefined;
      const detail = { stage: 'action', tool: current.pending.tool, ok: result.ok === true, durationMs, code: result.code, matchCount: result.matchCount };
      this.emit({ event: 'server.activity', taskId, payload: { message: `${label}: ${result.ok === true ? 'succeeded' : 'failed'}${result.matchCount !== undefined ? `; ${result.matchCount} matching cells` : ''}${durationMs !== undefined ? ` (${(durationMs / 1000).toFixed(1)}s)` : ''}.${result.ok === false && result.error ? ' ' + result.error : ''}`, detail } });
      if (result.ok && current.observation && !['find_element', 'wait_for_element'].includes(current.pending.tool)) current.pendingChanges = { before: current.observation, label };
    }
    const task = this.require(taskId); log('info', 'task.action.result', { taskId, step: task.step, pendingTool: task.pending?.tool, result: payload }); task.lastActionResult = payload; task.observationFresh = false; task.pending = undefined; this.state(task, 'WAITING_FOR_PAGE');
    this.emit({ event: 'server.activity', taskId, payload: { message: 'Checking what changed…', detail: payload } });
    this.requestObservation(task);
  }
  control(taskId: string, action: 'pause' | 'resume' | 'stop' | 'take_control' | 'approve' | 'deny') {
    const task = this.require(taskId);
    if (['CANCELLED', 'COMPLETED', 'FAILED'].includes(task.state)) return;
    log('info', 'task.control.received', { taskId, action, state: task.state, pendingTool: task.pendingApproval?.tool });
    if (action === 'stop') { task.abort?.abort(); task.pendingChanges = undefined; task.memory = {}; task.pending = undefined; task.pendingApproval = undefined; return this.state(task, 'CANCELLED', { code: 'USER_STOP', message: 'You stopped this task.' }); }
    if (action === 'pause' || action === 'take_control') { task.abort?.abort(); return this.state(task, 'PAUSED', { code: action === 'take_control' ? 'TAKE_CONTROL' : 'USER_PAUSE', message: action === 'take_control' ? 'You took control of the browser.' : 'You paused this task.', nextAction: 'Resume when you are ready to continue.' }); }
    if (action === 'deny') { task.pendingApproval = undefined; return this.state(task, 'PAUSED', { code: 'APPROVAL_DENIED', message: 'The requested browser action was not approved.', nextAction: 'Review the action before resuming.' }); }
    if (action === 'resume' && task.state === 'PAUSED') { task.repetitions.clear(); task.automaticSteps = 0; this.state(task, 'WAITING_FOR_PAGE'); this.requestObservation(task); return; }
    if (action === 'approve' && task.pendingApproval) { const request = task.pendingApproval; task.pendingApproval = undefined; this.dispatch(task, request); }
  }
  disconnect() { for (const task of this.tasks.values()) if (['RUNNING', 'WAITING_FOR_PAGE', 'PLANNING', 'WAITING_FOR_APPROVAL'].includes(task.state)) { task.abort?.abort(); this.state(task, 'PAUSED', { code: 'DISCONNECTED', message: 'The connection to the backend was lost.', nextAction: 'Reconnect, then resume the task.' }); } }
  private async advance(task: AgentTask) {
    if (task.planning || task.state !== 'WAITING_FOR_PAGE' || !task.observationFresh || !task.observation || task.pending || task.pendingApproval) return;
    if (task.automaticSteps >= config.maxSteps) { this.state(task, 'PAUSED', { code: 'STEP_LIMIT', message: 'The automatic step limit was reached.', nextAction: 'Review the progress, then resume to continue.' }); this.emit({ event: 'server.activity', taskId: task.id, payload: { message: 'Maximum automatic steps reached. Resume to continue.' } }); return; }
    task.planning = true; task.observationFresh = false;
    const generation = task.generation;
    const observation = task.observation;
    const abort = new AbortController(); task.abort = abort;
    const valid = () => !abort.signal.aborted && task.generation === generation && !terminal(task.state) && task.state !== 'PAUSED';
    this.state(task, 'PLANNING');
    log('info', 'task.planning.started', { taskId: task.id, step: task.step, url: task.observation.url });
    try {

      let source: ExecutionSource = 'model';
      let decision: AgentDecision | undefined;
      if (task.recovery) {
        const target=task.recovery.action.target ? resolveTarget(task.recovery.action.target,observation) : undefined;
        if(!task.recovery.retried && target) {task.recovery.retried=true;source='recovery';decision={type:'tool_request',tool:task.recovery.action.tool,arguments:{...task.recovery.action.arguments,...targetArguments(target)},userFacingActivity:'Retrying the confirmed stale target locally.'};}
        else {task.recovery=undefined;if(task.workflow)task.workflow.failed=true;}
      }
      if(!decision && task.execution) {
        const next=nextExecution(task.execution,observation,task.goal,task.memory);source=next.source;decision=next.decision;
        if(next.discard)task.execution=undefined;
      }
      if(!decision && !task.localAttempted) {
        task.localAttempted=true;
        task.workflow=processWorkflow(task.goal,observation);
        const simple=task.workflow ? undefined : localPlan(task.goal,observation);
        if(simple)task.execution=startExecution(simple,observation,'local');
      }
      if(!decision && task.execution) {const next=nextExecution(task.execution,observation,task.goal,task.memory);source=next.source;decision=next.decision;if(next.discard)task.execution=undefined;}
      if(!decision && task.workflow) {decision=nextProcess(task.workflow,observation,task.memory);if(decision)source='local';}
      if(!decision && !task.workflow) {decision=tableFollowup(task.goal,task.memory,observation);if(decision)source='local';}
      if(!decision) {
        source='model';
        decision=await this.llm.decide(task.goal, observation, task.memory, abort.signal, progress => {
          if (!valid()) return;
          this.emit({ event: 'server.provider_progress', taskId: task.id, payload: { ...progress, step: task.step + 1 } });
        }, record => {
          if (task.metrics.accept(record)) this.emit({ event: 'server.task_metrics', taskId: task.id, payload: this.metrics(task) });
        });
      }
      if (!valid()) return;
      if(decision.type==='execution_plan') {
        task.execution=startExecution(decision,observation,source);
        const next=nextExecution(task.execution,observation,task.goal,task.memory);
        decision=next.decision;source=next.source;
        if(next.discard)task.execution=undefined;
        if(!decision) {this.state(task,'PAUSED', { code: 'TARGET_CHANGED', message: 'The planned browser targets changed or became ambiguous.', nextAction: 'Review the page, then resume to replan.' });this.emit({event:'server.activity',taskId:task.id,payload:{message:'The planned targets changed or became ambiguous. Resume to replan.'}});return;}
      }
      task.executionSource=source;
      if (!valid()) return;
      log('info', 'task.planning.decision', { taskId: task.id, step: task.step, type: decision.type, tool: decision.type === 'tool_request' ? decision.tool : undefined, argumentKeys: decision.type === 'tool_request' ? Object.keys(decision.arguments ?? {}) : [] });
      if (decision.type === 'user_input_required') { this.state(task, 'PAUSED', { code: 'INPUT_REQUIRED', message: decision.question, nextAction: 'Provide the requested information, then resume or submit a revised task.' }); this.emit({ event: 'server.activity', taskId: task.id, payload: { message: decision.question } }); return; }
      if (decision.type === 'complete_request') {
        const filterError = task.workflow?.mode === 'filter' && !verifyObjective({kind:'dashboard_filter',value:task.workflow.value},task.workflow.baseline,observation,task.goal,task.memory) ? 'Dashboard filtering is not verified. A selected row alone is insufficient; choose a scoped filter or clarify the intended selection.' : undefined;
        const reportError = filterError ?? tableCompletionError(task.goal, task.memory, task.observation) ?? reportCompletionError(task.goal, task.memory, task.observation);
        if (reportError) {
          task.lastActionResult = { ok: false, code: 'REPORT_NOT_VERIFIED', error: reportError };
          this.state(task, 'PAUSED', { code: 'VERIFICATION_FAILED', message: reportError, nextAction: 'Review the page, then resume to finish verification.' });
          this.emit({ event: 'server.activity', taskId: task.id, payload: { message: reportError + ' Resume to continue.' } });
          return;
        }
        const slots = task.memory.textSlots as Record<string, string> | undefined;
        if ((slots || /capture_text|paste_text|copy.*answer|answer.*google/i.test(task.goal)) && /google/i.test(task.goal) && /search/i.test(task.goal)) {
          const url = new URL(task.observation.url);
          const query = url.searchParams.get('q')?.replace(/\r\n/g, '\n');
          if (!task.observation.searchResultsVisible || !Object.values(slots ?? {}).some(text => text.replace(/\r\n/g, '\n') === query)) {
            task.lastActionResult = { ok: false, code: 'SEARCH_NOT_VERIFIED', error: 'Finish capturing, pasting and submitting the exact answer before completing.' };
            this.state(task, 'PAUSED', { code: 'SEARCH_NOT_VERIFIED', message: 'The exact-text search has not been verified.', nextAction: 'Resume to finish the search using the captured answer.' });
            this.emit({ event: 'server.activity', taskId: task.id, payload: { message: 'Google results do not yet verify a search for the captured answer. Text memory is preserved; resume to continue.' } });
            return;
          }
        }
        this.state(task, 'COMPLETED', { code: 'GOAL_VERIFIED', message: decision.summary ?? 'Task completed and verified.' }); this.emit({ event: 'server.activity', taskId: task.id, payload: { message: decision.summary ?? 'Task completed and verified.' } }); return;
      }
      if (decision.type !== 'tool_request') throw new Error('Nested execution plans are unsupported');
      const def = toolRegistry.get(decision.tool); if (!def) throw new Error('Model requested an unknown tool');
      const args = validateTool(decision.tool, decision.arguments);
      const request: ToolRequest = { taskId: task.id, stepId: `step_${task.step + 1}`, toolCallId: randomUUID(), tool: decision.tool, arguments: args };
      const policy = this.policy.evaluate(task.observation.url, def, task.approvalMode);
      log('info', 'task.policy.evaluated', { taskId: task.id, step: task.step, tool: decision.tool, risk: def.risk, capability: def.capability, allowed: policy.allowed, approval: policy.approval, reason: policy.reason });
      this.emit({ event: 'server.activity', taskId: task.id, payload: { message: decision.userFacingActivity ?? `Using ${decision.tool.replaceAll('_', ' ')}…` } });
      if (policy.approval) { task.pendingApproval = request; this.state(task, 'WAITING_FOR_APPROVAL', { code: 'APPROVAL_REQUIRED', message: 'A browser action needs your approval.', nextAction: 'Approve the action to continue, or deny it to pause.' }); this.emit({ event: 'server.approval_request', taskId: task.id, toolCallId: request.toolCallId, payload: { site: task.observation.url, risk: def.risk, actionSummary: decision.userFacingActivity ?? decision.tool, arguments: redact(args) } }); return; }
      if (!policy.allowed) throw new Error(policy.reason ?? 'Action blocked by policy');
      this.dispatch(task, request);
    } catch (error) { if (!valid() || (error as Error).name === 'AbortError') { log('warn', 'task.planning.aborted', { taskId: task.id, step: task.step }); return; } const failure = describeError(error); log('error', 'task.failed', { taskId: task.id, step: task.step, state: task.state, error: failure }); this.state(task, 'FAILED', { code: 'EXECUTION_ERROR', message: failure.message, nextAction: 'Review Diagnostics and submit a new task after fixing the issue.' }); this.emit({ event: 'server.error', taskId: task.id, payload: { message: failure.message, stage: 'agent.planning', detail: failure } }); }
    finally { task.planning = false; if (task.observationFresh && task.state === 'WAITING_FOR_PAGE') await this.advance(task); }
  }
  private dispatch(task: AgentTask, request: ToolRequest) {
    if (terminal(task.state) || task.state === 'PAUSED' || task.pending) return;
    if (task.observation) {
      const fingerprint = actionFingerprint(request, task.observation);
      const count = task.repetitions.get(fingerprint) ?? 0;
      const generating = request.tool === 'wait_for_element' && (task.observation.responseState?.generating || task.observation.loadingState === 'loading');
      if (count >= 3 && !generating) {
        this.state(task, 'PAUSED', { code: 'NO_PROGRESS', message: 'The same action repeated three times without visible progress.', nextAction: 'Review the page before resuming.' });
        this.emit({ event: 'server.activity', taskId: task.id, payload: { message: 'Paused: the same action repeated three times without visible progress. Review the page before resuming.' } });
        return;
      }
      task.repetitions.set(fingerprint, count + 1);
    }
    if (request.tool === 'paste_text') {
      const text = (task.memory.textSlots as Record<string, string> | undefined)?.[String(request.arguments.key)];
      if (typeof text !== 'string') throw new Error('Requested text memory key is unavailable; capture it first');
      request = { ...request, arguments: { ...request.arguments, value: text } };
    }
    if (task.execution) task.execution.last = {request, ...(task.execution.actions[task.execution.cursor]?.target ? {target: task.execution.actions[task.execution.cursor]!.target} : {}), retried: task.execution.last?.retried ?? false};
    task.metrics.action(task.executionSource ?? 'model');
    this.emit({event:'server.task_metrics',taskId:task.id,payload:this.metrics(task)});
    task.actionStartedAt = performance.now();
    task.pending = request; task.step += 1; task.automaticSteps += 1;
    task.observationFresh = false;
    log('info', 'task.action.dispatched', { taskId: task.id, step: task.step, stepId: request.stepId, toolCallId: request.toolCallId, tool: request.tool, argumentKeys: Object.keys(request.arguments) });
    this.state(task, 'RUNNING'); this.emit({ event: 'server.action_request', taskId: task.id, stepId: request.stepId, toolCallId: request.toolCallId, payload: { tool: request.tool, arguments: request.arguments } });
  }
  private require(id: string) { const task = this.tasks.get(id); if (!task) throw new Error('Task not found'); return task; }
  private requestObservation(task: AgentTask) {
    task.observationRequestId = randomUUID();
    this.emit({ event: 'server.action_request', taskId: task.id, requestId: task.observationRequestId, payload: { tool: 'observe_page', arguments: {} } });
  }
  metrics(task: AgentTask) { return { ...task.metrics.snapshot(), state: task.state, reason: task.reason }; }
  private state(task: AgentTask, state: TaskState, reason?: TaskReason) {
    const previousState = task.state;
    if (terminal(previousState) || previousState === state) return;
    task.state = state;
    task.reason = reason;
    if (state === 'PAUSED' || terminal(state)) {
      task.abort?.abort();
      task.execution = undefined; task.recovery = undefined;
      if (task.workflow) task.workflow.failed = true;
      task.generation += 1;
      task.observationRequestId = undefined;
      task.observationFresh = false;
      task.pending = undefined;
      task.pendingApproval = undefined;
    }
    if (terminal(state)) {
      task.workflow = undefined;
      task.pendingChanges = undefined;
      task.memory = {};
      task.observation = undefined;
      task.lastActionResult = undefined;
      task.repetitions.clear();
    }
    log('info', 'task.state.changed', { taskId: task.id, previousState, state, step: task.step });
    this.emit({ event: 'server.task_state', taskId: task.id, payload: { state, step: task.step, reason: task.reason } });
  }
}
const redact = (args: Record<string, unknown>) => Object.fromEntries(Object.entries(args).map(([key, value]) => /password|token|secret|cookie/i.test(key) ? [key, '[REDACTED]'] : [key, value]));
