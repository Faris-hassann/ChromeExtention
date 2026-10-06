import type { AgentDecision, BrowserObservation } from '../types.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import { ProviderError, providerFailure, type ProgressListener } from './progress.js';
import { decisionContext, OllamaProvider, parseToolDecision, type ChatResponse } from './ollama.js';
import { cloudSlot, openRouterError, openRouterStatus, OpenRouterStatusService } from './openrouter-status.js';

export interface DecisionProvider {
  decide(goal: string, observation: BrowserObservation, memory: Record<string, unknown>, signal?: AbortSignal, onProgress?: ProgressListener): Promise<AgentDecision>;
}

export class OpenRouterProvider implements DecisionProvider {
  constructor(private apiKey = config.openrouterApiKey, public readonly model = config.openrouterModel, public readonly timeoutMs = config.openrouterTimeoutMs, private statusService = apiKey === config.openrouterApiKey ? openRouterStatus : new OpenRouterStatusService(apiKey)) {}
  async decide(goal: string, observation: BrowserObservation, memory: Record<string, unknown>, signal?: AbortSignal, onProgress?: ProgressListener): Promise<AgentDecision> {
    if (!this.apiKey) throw new Error('OpenRouter API key is not configured');
    if (this.model !== 'openrouter/free' && (!this.model.endsWith(':free') || this.model.startsWith('openrouter/'))) throw new Error('Configure openrouter/free or an explicit free model; paid and automatic billing routers are disabled');
    const started = performance.now();
    const context = decisionContext(goal, observation, memory);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const cloudSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let release: (() => void) | undefined;
    try {
      release = await cloudSlot(this.apiKey, cloudSignal);
      const availability = await this.statusService.status(false, cloudSignal);
      if (availability.availability === 'unavailable') {
        throw new ProviderError(`${availability.reason}${availability.nextRetryAt ? ` Next retry ${availability.nextRetryAt}.` : ''} No cloud inference request sent.`, availability.code ?? 'UNAVAILABLE', undefined, availability.nextRetryAt ? Math.max(0, Date.parse(availability.nextRetryAt) - Date.now()) : undefined, true);
      }
      const alternatives = (await this.statusService.models(cloudSignal)).filter(model => model !== this.model).slice(0, 2);
      cloudSignal.throwIfAborted();
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: cloudSignal,
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, models: [this.model, ...alternatives], messages: context.messages, tools: context.tools, tool_choice: 'required', temperature: 0, max_tokens: config.openrouterMaxTokens, provider: { sort: 'latency', require_parameters: true, allow_fallbacks: true }, stream: false }),
      });
      log('info', 'openrouter.http.completed', { status: response.status, model: this.model, durationMs: Math.round(performance.now() - started) });
      if (!response.ok) {
        throw await openRouterError(response);
      }
      const body = await response.json() as { error?: unknown; model?: string; choices?: Array<{ message: ChatResponse['message']; finish_reason?: string }> };
      log('info', 'openrouter.response.received', { model: body.model ?? this.model, finishReason: body.choices?.[0]?.finish_reason, durationMs: Math.round(performance.now() - started) });
      if (body.error) throw await openRouterError(new Response(JSON.stringify({ error: body.error })));
      if (body.choices?.[0]?.finish_reason === 'length') throw new ProviderError('OpenRouter exceeded the decision output limit', 'OUTPUT_LIMIT');
      let decision: AgentDecision;
      try { decision = parseToolDecision({ message: body.choices?.[0]?.message }, context.tools); }
      catch (error) {
        const reason = error instanceof Error && /exactly one/.test(error.message) ? 'expected exactly one tool call' : error instanceof Error && /not offered/.test(error.message) ? 'requested an unavailable tool' : 'invalid tool arguments';
        throw new ProviderError(`OpenRouter invalid decision: ${reason}`, 'INVALID_DECISION');
      }
      onProgress?.({ provider: 'openrouter', phase: 'model_selected', model: body.model ?? this.model, elapsedMs: Math.round(performance.now() - started), message: `OpenRouter selected ${body.model ?? this.model}.` });
      log('info', 'openrouter.decision.completed', { model: body.model ?? this.model, durationMs: Math.round(performance.now() - started), decisionType: decision.type });
      return decision;
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Task cancelled', 'AbortError');
      if (timeout.aborted) { const failure = new ProviderError(`OpenRouter timed out after ${this.timeoutMs}ms`, 'TIMEOUT'); this.statusService.recordFailure(failure); throw failure; }
      if (error instanceof ProviderError) { if (!error.skipped) this.statusService.recordFailure(error); throw error; }
      if (error instanceof Error && /^OpenRouter HTTP|^OpenRouter returned|^OpenRouter invalid/.test(error.message)) throw error;
      const failure = new ProviderError('OpenRouter could not be reached', 'NETWORK_ERROR'); this.statusService.recordFailure(failure); throw failure;
    } finally { release?.(); }
  }
}

export class FallbackProvider implements DecisionProvider {
  private blockedUntil = 0;
  private blockedReason = '';
  constructor(private primary: DecisionProvider | null | undefined = config.llmProvider === 'openrouter' && config.openrouterApiKey ? new OpenRouterProvider() : undefined, private local: DecisionProvider = new OllamaProvider()) {}
  async decide(goal: string, observation: BrowserObservation, memory: Record<string, unknown>, signal?: AbortSignal, onProgress?: ProgressListener) {
    if (signal?.aborted) throw new DOMException('Task cancelled', 'AbortError');
    const publish = (progress: Parameters<ProgressListener>[0]) => {
      if (signal?.aborted) return;
      log(progress.phase === 'failed' || progress.phase === 'fallback' ? 'warn' : 'info', `llm.${progress.phase}`, { taskId: observation.taskId, ...progress });
      if (!signal?.aborted) onProgress?.(progress);
    };
    let primaryReason: string | undefined;
    const primaryModel = this.primary instanceof OpenRouterProvider ? this.primary.model : config.openrouterModel;
    const localModel = this.local instanceof OllamaProvider ? this.local.model : config.mainModel;
    if (this.primary && (this.primary instanceof OpenRouterProvider || Date.now() >= this.blockedUntil)) {
      const started = performance.now();
      let actualModel = primaryModel;
      publish({ provider: 'openrouter', phase: 'started', model: primaryModel, message: `Trying OpenRouter (${primaryModel}); timeout ${Math.round((this.primary instanceof OpenRouterProvider ? this.primary.timeoutMs : config.openrouterTimeoutMs) / 1000)}s.` });
      const waiting = setInterval(() => publish({ provider: 'openrouter', phase: 'waiting', model: actualModel, elapsedMs: Math.round(performance.now() - started), message: 'Waiting for OpenRouter...' }), 5000);
      try {
        const progress: ProgressListener = event => { if (event.phase === 'model_selected') actualModel = event.model; publish(event); };
        const decision = await (onProgress ? this.primary.decide(goal, observation, memory, signal, progress) : this.primary.decide(goal, observation, memory, signal));
        if (signal?.aborted) throw new DOMException('Task cancelled', 'AbortError');
        this.blockedUntil = 0;
        publish({ provider: 'openrouter', phase: 'succeeded', model: actualModel, elapsedMs: Math.round(performance.now() - started), message: `OpenRouter succeeded (${actualModel}).` });
        return decision;
      } catch (error) {
        if (signal?.aborted || (error as Error).name === 'AbortError') throw error;
        const failure = providerFailure(error);
        primaryReason = error instanceof Error ? error.message : 'OpenRouter failed';
        const cooldown = failure.status === 401 || failure.status === 403 || failure.status === 402 ? 300000 : config.openrouterCooldownMs;
        this.blockedUntil = Date.now() + Math.max(1000, failure.retryAfterMs || cooldown);
        this.blockedReason = failure.message;
        const skipped = error instanceof ProviderError && error.skipped;
        const reason = failure.message.replace(/[.\s]+$/, '');
        publish({ provider: 'openrouter', phase: skipped ? 'skipped' : 'failed', model: actualModel, elapsedMs: Math.round(performance.now() - started), message: `${reason}. Switching to local Qwen.`, status: failure.status, code: failure.code });
        publish({ provider: 'ollama', phase: 'fallback', model: localModel, message: `Falling back to local Qwen (${localModel}) because OpenRouter ${skipped ? 'is unavailable' : 'failed'}: ${reason}.` });
      } finally { clearInterval(waiting); }
    } else {
      const message = this.primary ? `OpenRouter skipped for ${Math.ceil((this.blockedUntil - Date.now()) / 1000)}s after ${this.blockedReason}; using local Qwen.` : config.llmProvider === 'ollama' ? 'OpenRouter skipped: local-only mode is configured.' : 'OpenRouter skipped: API key is not configured.';
      publish({ provider: 'openrouter', phase: 'skipped', model: primaryModel, message });
    }
    if (signal?.aborted) throw new DOMException('Task cancelled', 'AbortError');
    const started = performance.now();
    publish({ provider: 'ollama', phase: 'started', model: localModel, message: `Using local Qwen (${localModel}); first-attempt timeout ${Math.round(config.llmAttemptTimeoutMs / 1000)}s.` });
    const waiting = setInterval(() => publish({ provider: 'ollama', phase: 'waiting', model: localModel, elapsedMs: Math.round(performance.now() - started), message: 'Local Qwen is still calculating the next action...' }), 5000);
    try {
      const decision = await (onProgress ? this.local.decide(goal, observation, memory, signal, publish) : this.local.decide(goal, observation, memory, signal));
      if (signal?.aborted) throw new DOMException('Task cancelled', 'AbortError');
      publish({ provider: 'ollama', phase: 'succeeded', model: localModel, elapsedMs: Math.round(performance.now() - started), message: `Local Qwen succeeded (${localModel}).` });
      return decision;
    } catch (error) {
      if (signal?.aborted || (error as Error).name === 'AbortError') throw error;
      const failure = providerFailure(error);
      publish({ provider: 'ollama', phase: 'failed', model: localModel, elapsedMs: Math.round(performance.now() - started), message: `Local Qwen failed: ${failure.message}.`, code: failure.code, status: failure.status });
      if (primaryReason) throw new Error(`${primaryReason}; local fallback failed: ${error instanceof Error ? error.message : 'Ollama unavailable'}`);
      throw error;
    } finally { clearInterval(waiting); }
  }
}
