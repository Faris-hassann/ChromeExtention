import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { FallbackProvider, type DecisionProvider } from '../llm/provider.js';
import { PolicyEngine } from '../permissions/policy.js';
import { toolRegistry, validateTool } from '../tools/registry.js';
import type { BrowserObservation, Envelope, TaskState, ToolRequest } from '../types.js';
import { describeError, log } from '../logger.js';
import { actionDescription, observedChanges } from './activity.js';
import { recordTableInteraction, tableCompletionError, tableFollowup } from './table-interaction.js';
import { observeReportSave, recordReportAction, reportCompletionError } from './powerbi.js';

export interface AgentTask { id: string; goal: string; approvalMode?: 'manual' | 'auto' | 'always'; state: TaskState; step: number; observationFresh: boolean; observation?: BrowserObservation; lastActionResult?: unknown; memory: Record<string, unknown>; pending?: ToolRequest; pendingApproval?: ToolRequest; abort?: AbortController; pendingChanges?: { before: BrowserObservation; label: string }; actionStartedAt?: number }
type Emit = (message: Envelope) => void;

export class AgentOrchestrator {
  readonly tasks = new Map<string, AgentTask>();
  constructor(private llm: DecisionProvider = new FallbackProvider(), private policy = new PolicyEngine(), private emit: Emit = () => undefined) {}
  create(goal: string, approvalMode: 'manual' | 'auto' | 'always' = 'auto') {
    const task: AgentTask = { id: randomUUID(), goal, approvalMode, state: 'CREATED', step: 0, observationFresh: false, memory: {} };
    log('info', 'task.created', { taskId: task.id, goalLength: goal.length });
    this.tasks.set(task.id, task); this.state(task, 'WAITING_FOR_PAGE');
    return task;
  }
  async observe(taskId: string, observation: BrowserObservation) {
    const task = this.require(taskId);
    if (['CANCELLED', 'COMPLETED', 'FAILED'].includes(task.state)) return;
    log('info', 'task.observation.received', { taskId, observationId: observation.observationId, url: observation.url, title: observation.title, loadingState: observation.loadingState, interactiveElementCount: observation.interactiveElements?.length ?? 0, step: task.step });
    if (task.pendingChanges) {
      const changes = observedChanges(task.pendingChanges.before, observation);
      this.emit({ event: 'server.activity', taskId, payload: { message: `After ${task.pendingChanges.label}: ${changes.length ? changes.join('; ') + '.' : 'no visible page change detected yet.'}`, detail: { changes, stage: 'observation' } } });
      task.pendingChanges = undefined;
    }
    task.observation = { ...observation, lastActionResult: observation.lastActionResult ?? task.lastActionResult };
    observeReportSave(task.memory, task.observation);
    task.lastActionResult = undefined; task.observationFresh = true; task.pending = undefined;
    if (task.state === 'WAITING_FOR_PAGE' || task.state === 'RUNNING' || task.state === 'PLANNING') await this.advance(task);
  }
  actionResult(taskId: string, payload: unknown) {
    const current = this.require(taskId);
    if (['CANCELLED', 'COMPLETED', 'FAILED'].includes(current.state)) return;
    if (current.pending && current.observation) recordTableInteraction(current.memory, current.observation, current.pending, payload);
    if (current.pending && current.observation) payload = recordReportAction(current.memory, current.observation, current.pending, payload, current.step);
    if ((payload as { ok?: boolean })?.ok && current.pending) {
      const recent = (current.memory.recentActions ??= []) as Array<Record<string, unknown>>;
      recent.push({ tool: current.pending.tool, url: current.pending.arguments.url, elementId: current.pending.arguments.elementId, key: current.pending.arguments.key });
      if (recent.length > 8) recent.shift();
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
    this.emit({ event: 'server.action_request', taskId, payload: { tool: 'observe_page', arguments: {} } });
  }
  control(taskId: string, action: 'pause' | 'resume' | 'stop' | 'take_control' | 'approve' | 'deny') {
    const task = this.require(taskId);
    if (['CANCELLED', 'COMPLETED', 'FAILED'].includes(task.state)) return;
    log('info', 'task.control.received', { taskId, action, state: task.state, pendingTool: task.pendingApproval?.tool });
    if (action === 'stop') { task.abort?.abort(); task.pendingChanges = undefined; task.memory = {}; task.pending = undefined; task.pendingApproval = undefined; return this.state(task, 'CANCELLED'); }
    if (action === 'pause' || action === 'take_control') { task.abort?.abort(); return this.state(task, 'PAUSED'); }
    if (action === 'deny') { task.pendingApproval = undefined; return this.state(task, 'PAUSED'); }
    if (action === 'resume') { this.state(task, 'WAITING_FOR_PAGE'); this.emit({ event: 'server.action_request', taskId, payload: { tool: 'observe_page', arguments: {} } }); return; }
    if (action === 'approve' && task.pendingApproval) { const request = task.pendingApproval; task.pendingApproval = undefined; this.dispatch(task, request); }
  }
  disconnect() { for (const task of this.tasks.values()) if (['RUNNING', 'WAITING_FOR_PAGE', 'PLANNING'].includes(task.state)) { task.abort?.abort(); this.state(task, 'PAUSED'); } }
  private async advance(task: AgentTask) {
    if (!task.observationFresh || !task.observation || task.pending || task.pendingApproval) return;
    if (task.step >= config.maxSteps) { this.state(task, 'PAUSED'); this.emit({ event: 'server.activity', taskId: task.id, payload: { message: 'Maximum automatic steps reached. Resume to continue.' } }); return; }
    this.state(task, task.step === 0 ? 'PLANNING' : 'RUNNING'); task.abort = new AbortController();
    log('info', 'task.planning.started', { taskId: task.id, step: task.step, url: task.observation.url });
    try {
      const followup = tableFollowup(task.goal, task.memory, task.observation);
      if (followup) this.emit({ event: 'server.activity', taskId: task.id, payload: { message: 'Browser follow-up: using the exact table match and click evidence; no extra model request needed.' } });
      const decision = followup ?? await this.llm.decide(task.goal, task.observation, task.memory, task.abort.signal, progress => {
        if (task.abort?.signal.aborted || ['PAUSED', 'CANCELLED', 'COMPLETED', 'FAILED'].includes(task.state)) return;
        this.emit({ event: 'server.provider_progress', taskId: task.id, payload: { ...progress, step: task.step + 1 } });
      });
      if (task.abort.signal.aborted) return;
      log('info', 'task.planning.decision', { taskId: task.id, step: task.step, type: decision.type, tool: decision.type === 'tool_request' ? decision.tool : undefined, argumentKeys: decision.type === 'tool_request' ? Object.keys(decision.arguments ?? {}) : [] });
      if (decision.type === 'user_input_required') { this.state(task, 'PAUSED'); this.emit({ event: 'server.activity', taskId: task.id, payload: { message: decision.question } }); return; }
      if (decision.type === 'complete_request') {
        const reportError = tableCompletionError(task.goal, task.memory, task.observation) ?? reportCompletionError(task.goal, task.memory, task.observation);
        if (reportError) {
          task.lastActionResult = { ok: false, code: 'REPORT_NOT_VERIFIED', error: reportError };
          this.state(task, 'PAUSED');
          this.emit({ event: 'server.activity', taskId: task.id, payload: { message: reportError + ' Resume to continue.' } });
          return;
        }
        const slots = task.memory.textSlots as Record<string, string> | undefined;
        if ((slots || /capture_text|paste_text|copy.*answer|answer.*google/i.test(task.goal)) && /google/i.test(task.goal) && /search/i.test(task.goal)) {
          const url = new URL(task.observation.url);
          const query = url.searchParams.get('q')?.replace(/\r\n/g, '\n');
          if (!task.observation.searchResultsVisible || !Object.values(slots ?? {}).some(text => text.replace(/\r\n/g, '\n') === query)) {
            task.lastActionResult = { ok: false, code: 'SEARCH_NOT_VERIFIED', error: 'Finish capturing, pasting and submitting the exact answer before completing.' };
            this.state(task, 'PAUSED');
            this.emit({ event: 'server.activity', taskId: task.id, payload: { message: 'Google results do not yet verify a search for the captured answer. Text memory is preserved; resume to continue.' } });
            return;
          }
        }
        this.state(task, 'COMPLETED'); this.emit({ event: 'server.activity', taskId: task.id, payload: { message: decision.summary ?? 'Task completed and verified.' } }); return;
      }
      const def = toolRegistry.get(decision.tool); if (!def) throw new Error('Model requested an unknown tool');
      const args = validateTool(decision.tool, decision.arguments);
      const request: ToolRequest = { taskId: task.id, stepId: `step_${task.step + 1}`, toolCallId: randomUUID(), tool: decision.tool, arguments: args };
      const policy = this.policy.evaluate(task.observation.url, def, task.approvalMode);
      log('info', 'task.policy.evaluated', { taskId: task.id, step: task.step, tool: decision.tool, risk: def.risk, capability: def.capability, allowed: policy.allowed, approval: policy.approval, reason: policy.reason });
      this.emit({ event: 'server.activity', taskId: task.id, payload: { message: decision.userFacingActivity ?? `Using ${decision.tool.replaceAll('_', ' ')}…` } });
      if (policy.approval) { task.pendingApproval = request; this.state(task, 'WAITING_FOR_APPROVAL'); this.emit({ event: 'server.approval_request', taskId: task.id, toolCallId: request.toolCallId, payload: { site: task.observation.url, risk: def.risk, actionSummary: decision.userFacingActivity ?? decision.tool, arguments: redact(args) } }); return; }
      if (!policy.allowed) throw new Error(policy.reason ?? 'Action blocked by policy');
      this.dispatch(task, request);
    } catch (error) { if ((error as Error).name === 'AbortError') { log('warn', 'task.planning.aborted', { taskId: task.id, step: task.step }); return; } const failure = describeError(error); log('error', 'task.failed', { taskId: task.id, step: task.step, state: task.state, error: failure }); this.state(task, 'FAILED'); this.emit({ event: 'server.error', taskId: task.id, payload: { message: failure.message, stage: 'agent.planning', detail: failure } }); }
  }
  private dispatch(task: AgentTask, request: ToolRequest) {
    if (request.tool === 'paste_text') {
      const text = (task.memory.textSlots as Record<string, string> | undefined)?.[String(request.arguments.key)];
      if (typeof text !== 'string') throw new Error('Requested text memory key is unavailable; capture it first');
      request = { ...request, arguments: { ...request.arguments, value: text } };
    }
    const def = toolRegistry.get(request.tool)!;
    task.actionStartedAt = performance.now();
    task.pending = request; task.step += def.meaningful ? 1 : 0;
    if (def.meaningful) task.observationFresh = false;
    log('info', 'task.action.dispatched', { taskId: task.id, step: task.step, stepId: request.stepId, toolCallId: request.toolCallId, tool: request.tool, argumentKeys: Object.keys(request.arguments) });
    this.state(task, 'RUNNING'); this.emit({ event: 'server.action_request', taskId: task.id, stepId: request.stepId, toolCallId: request.toolCallId, payload: { tool: request.tool, arguments: request.arguments } });
  }
  private require(id: string) { const task = this.tasks.get(id); if (!task) throw new Error('Task not found'); return task; }
  private state(task: AgentTask, state: TaskState) { const previousState = task.state; task.state = state; if (['FAILED', 'COMPLETED', 'CANCELLED'].includes(state)) { task.pendingChanges = undefined; task.memory = {}; task.observation = undefined; task.lastActionResult = undefined; task.pending = undefined; task.pendingApproval = undefined; } log('info', 'task.state.changed', { taskId: task.id, previousState, state, step: task.step }); this.emit({ event: 'server.task_state', taskId: task.id, payload: { state, step: task.step } }); }
}
const redact = (args: Record<string, unknown>) => Object.fromEntries(Object.entries(args).map(([key, value]) => /password|token|secret|cookie/i.test(key) ? [key, '[REDACTED]'] : [key, value]));
