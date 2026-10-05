import type { AgentDecision, BrowserObservation } from '../types.js';
import { config } from '../config.js';
import { log } from '../logger.js';
import { decisionContext, OllamaProvider, parseToolDecision, type ChatResponse } from './ollama.js';

export interface DecisionProvider {
  decide(goal: string, observation: BrowserObservation, memory: Record<string, unknown>, signal?: AbortSignal): Promise<AgentDecision>;
}

export class OpenRouterProvider implements DecisionProvider {
  constructor(private apiKey = config.openrouterApiKey, private model = config.openrouterModel, private timeoutMs = config.openrouterTimeoutMs) {}
  async decide(goal: string, observation: BrowserObservation, memory: Record<string, unknown>, signal?: AbortSignal): Promise<AgentDecision> {
    if (!this.apiKey) throw new Error('OpenRouter API key is not configured');
    if (this.model !== 'openrouter/free' && !this.model.endsWith(':free')) throw new Error('Configure openrouter/free or a :free model');
    const started = performance.now();
    const context = decisionContext(goal, observation, memory);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, messages: context.messages, tools: context.tools, tool_choice: 'required', parallel_tool_calls: false, temperature: 0, max_tokens: 4096, reasoning: { effort: 'minimal' }, stream: false }),
      });
      log('info', 'openrouter.http.completed', { status: response.status, model: this.model, durationMs: Math.round(performance.now() - started) });
      if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}`);
      const body = await response.json() as { error?: unknown; model?: string; choices?: Array<{ message: ChatResponse['message']; finish_reason?: string }> };
      log('info', 'openrouter.response.received', { model: body.model ?? this.model, finishReason: body.choices?.[0]?.finish_reason, durationMs: Math.round(performance.now() - started) });
      if (body.error) throw new Error('OpenRouter returned a provider error');
      let decision: AgentDecision;
      try { decision = parseToolDecision({ message: body.choices?.[0]?.message }, context.tools); }
      catch (error) {
        const reason = error instanceof Error && /exactly one/.test(error.message) ? 'expected exactly one tool call' : error instanceof Error && /not offered/.test(error.message) ? 'requested an unavailable tool' : 'invalid tool arguments';
        throw new Error(`OpenRouter invalid decision: ${reason}`);
      }
      log('info', 'openrouter.decision.completed', { model: body.model ?? this.model, durationMs: Math.round(performance.now() - started), decisionType: decision.type });
      return decision;
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Task cancelled', 'AbortError');
      if (timeout.aborted) throw new Error(`OpenRouter timed out after ${this.timeoutMs}ms`);
      if (error instanceof Error && /^OpenRouter HTTP|^OpenRouter returned|^OpenRouter invalid/.test(error.message)) throw error;
      throw new Error('OpenRouter returned an invalid decision or could not be reached');
    }
  }
}

export class FallbackProvider implements DecisionProvider {
  constructor(private primary: DecisionProvider | null | undefined = config.llmProvider === 'openrouter' && config.openrouterApiKey ? new OpenRouterProvider() : undefined, private local: DecisionProvider = new OllamaProvider()) {}
  async decide(goal: string, observation: BrowserObservation, memory: Record<string, unknown>, signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException('Task cancelled', 'AbortError');
    let primaryReason: string | undefined;
    if (this.primary) {
      try { return await this.primary.decide(goal, observation, memory, signal); }
      catch (error) {
        if (signal?.aborted || (error as Error).name === 'AbortError') throw error;
        primaryReason = error instanceof Error ? error.message : 'OpenRouter failed';
        log('warn', 'llm.fallback', { from: 'openrouter', to: 'ollama', reason: primaryReason });
      }
    }
    try { return await this.local.decide(goal, observation, memory, signal); }
    catch (error) {
      if (signal?.aborted || (error as Error).name === 'AbortError') throw error;
      if (primaryReason) throw new Error(`${primaryReason}; local fallback failed: ${error instanceof Error ? error.message : 'Ollama unavailable'}`);
      throw error;
    }
  }
}
