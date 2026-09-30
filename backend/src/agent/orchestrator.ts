import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { OllamaProvider } from '../llm/ollama.js';
import { PolicyEngine } from '../permissions/policy.js';
import { toolRegistry, validateTool } from '../tools/registry.js';
import type { BrowserObservation, Envelope, TaskState, ToolRequest } from '../types.js';

export interface AgentTask { id: string; goal: string; state: TaskState; step: number; observationFresh: boolean; observation?: BrowserObservation; lastActionResult?: unknown; memory: Record<string, unknown>; pending?: ToolRequest; pendingApproval?: ToolRequest; abort?: AbortController }
type Emit = (message: Envelope) => void;

export class AgentOrchestrator {
  readonly tasks = new Map<string, AgentTask>();
  constructor(private llm = new OllamaProvider(), private policy = new PolicyEngine(), private emit: Emit = () => undefined) {}
  create(goal: string) {
    const task: AgentTask = { id: randomUUID(), goal, state: 'CREATED', step: 0, observationFresh: false, memory: {} };
    this.tasks.set(task.id, task); this.state(task, 'WAITING_FOR_PAGE');
    return task;
  }
  async observe(taskId: string, observation: BrowserObservation) {
    const task = this.require(taskId);
    task.observation = { ...observation, lastActionResult: observation.lastActionResult ?? task.lastActionResult };
    task.lastActionResult = undefined; task.observationFresh = true; task.pending = undefined;
    if (task.state === 'WAITING_FOR_PAGE' || task.state === 'RUNNING' || task.state === 'PLANNING') await this.advance(task);
  }
  actionResult(taskId: string, payload: unknown) {
    const task = this.require(taskId); task.lastActionResult = payload; task.observationFresh = false; task.pending = undefined; this.state(task, 'WAITING_FOR_PAGE');
    this.emit({ event: 'server.activity', taskId, payload: { message: 'Checking what changed…', detail: payload } });
    this.emit({ event: 'server.action_request', taskId, payload: { tool: 'observe_page', arguments: {} } });
  }
  control(taskId: string, action: 'pause' | 'resume' | 'stop' | 'take_control' | 'approve' | 'deny') {
    const task = this.require(taskId);
    if (action === 'stop') { task.abort?.abort(); task.memory = {}; task.pending = undefined; task.pendingApproval = undefined; return this.state(task, 'CANCELLED'); }
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
    try {
      const decision = await this.llm.decide(task.goal, task.observation, task.memory, task.abort.signal);
      if (decision.type === 'user_input_required') { this.state(task, 'PAUSED'); this.emit({ event: 'server.activity', taskId: task.id, payload: { message: decision.question } }); return; }
      if (decision.type === 'complete_request') { this.state(task, 'COMPLETED'); task.memory = {}; this.emit({ event: 'server.activity', taskId: task.id, payload: { message: decision.summary ?? 'Task completed and verified.' } }); return; }
      const def = toolRegistry.get(decision.tool); if (!def) throw new Error('Model requested an unknown tool');
      const args = validateTool(decision.tool, decision.arguments);
      const request: ToolRequest = { taskId: task.id, stepId: `step_${task.step + 1}`, toolCallId: randomUUID(), tool: decision.tool, arguments: args };
      const policy = this.policy.evaluate(task.observation.url, def);
      this.emit({ event: 'server.activity', taskId: task.id, payload: { message: decision.userFacingActivity ?? `Using ${decision.tool.replaceAll('_', ' ')}…` } });
      if (policy.approval) { task.pendingApproval = request; this.state(task, 'WAITING_FOR_APPROVAL'); this.emit({ event: 'server.approval_request', taskId: task.id, toolCallId: request.toolCallId, payload: { site: task.observation.url, risk: def.risk, actionSummary: decision.userFacingActivity ?? decision.tool, arguments: redact(args) } }); return; }
      if (!policy.allowed) throw new Error(policy.reason ?? 'Action blocked by policy');
      this.dispatch(task, request);
    } catch (error) { if ((error as Error).name === 'AbortError') return; this.state(task, 'FAILED'); this.emit({ event: 'server.error', taskId: task.id, payload: { message: error instanceof Error ? error.message : String(error) } }); }
  }
  private dispatch(task: AgentTask, request: ToolRequest) {
    const def = toolRegistry.get(request.tool)!;
    task.pending = request; task.step += def.meaningful ? 1 : 0;
    if (def.meaningful) task.observationFresh = false;
    this.state(task, 'RUNNING'); this.emit({ event: 'server.action_request', taskId: task.id, stepId: request.stepId, toolCallId: request.toolCallId, payload: { tool: request.tool, arguments: request.arguments } });
  }
  private require(id: string) { const task = this.tasks.get(id); if (!task) throw new Error('Task not found'); return task; }
  private state(task: AgentTask, state: TaskState) { task.state = state; this.emit({ event: 'server.task_state', taskId: task.id, payload: { state, step: task.step } }); }
}
const redact = (args: Record<string, unknown>) => Object.fromEntries(Object.entries(args).map(([key, value]) => /password|token|secret|cookie/i.test(key) ? [key, '[REDACTED]'] : [key, value]));
