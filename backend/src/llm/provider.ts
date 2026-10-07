import { config } from '../config.js';
import { log } from '../logger.js';
import type { AgentDecision, BrowserObservation } from '../types.js';
import { decisionContext, parseToolDecision, type ChatResponse } from './context.js';
import { ProviderError, type ProgressListener, type ProviderProgress } from './progress.js';

export interface DecisionProvider {
  decide(goal: string, observation: BrowserObservation, memory: Record<string, unknown>, signal?: AbortSignal, onProgress?: ProgressListener): Promise<AgentDecision>;
}

export type AzureSettings = Pick<typeof config, 'azureEndpoint' | 'azureApiKey' | 'azureDeployment' | 'azureApiVersion' | 'azureTimeoutMs' | 'azureMaxTokens'>;
const required = {
  azureEndpoint: 'Azure_openAi_Endpoint',
  azureApiKey: 'Azure_openAI_API_KEY',
  azureDeployment: 'Azure_openai_deployment_Name',
  azureApiVersion: 'azure_openai_API_version',
} as const;

export function azureConfiguration(settings: AzureSettings = config) {
  const missing = Object.entries(required).filter(([key]) => !settings[key as keyof typeof required]?.trim()).map(([, name]) => name);
  const issues: string[] = [];
  if (settings.azureEndpoint) {
    try {
      const url = new URL(settings.azureEndpoint);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
    } catch { issues.push('Azure_openAi_Endpoint must be an HTTPS resource endpoint without credentials, query parameters or fragments.'); }
  }
  if (['.', '..'].includes(settings.azureDeployment) || /[\r\n]/.test(settings.azureDeployment)) issues.push('Azure_openai_deployment_Name must be a valid deployment name.');
  if (!Number.isInteger(settings.azureTimeoutMs) || settings.azureTimeoutMs < 1 || settings.azureTimeoutMs > 2147483647) issues.push('AZURE_OPENAI_TIMEOUT_MS must be a positive integer no greater than 2147483647.');
  if (!Number.isInteger(settings.azureMaxTokens) || settings.azureMaxTokens < 1) issues.push('AZURE_OPENAI_MAX_COMPLETION_TOKENS must be a positive integer.');
  const configured = missing.length === 0 && issues.length === 0;
  const reason = configured ? 'Azure configuration is ready. Access has not been verified.' : [missing.length ? `Missing settings: ${missing.join(', ')}. Add them to backend/.env and restart the backend.` : '', ...issues].filter(Boolean).join(' ');
  return { configured, missing, issues, reason };
}

type RequestOutcome = { outcome: 'succeeded' | 'failed' | 'cancelled'; timestamp: string; message: string; elapsedMs: number; code?: string; status?: number };
type AzureResponse = { error?: { code?: unknown }; model?: string; choices?: Array<{ message?: ChatResponse['message']; finish_reason?: string }> };

export function azureHttpFailure(status: number, code?: unknown) {
  const azureCode = typeof code === 'string' ? code.toLowerCase() : '';
  if (/content.?filter|responsibleaipolicy/.test(azureCode)) return new ProviderError('Azure blocked the request under its content policy.', 'CONTENT_FILTER', status);
  if (status === 401) return new ProviderError('Azure authentication failed. Check Azure_openAI_API_KEY and the resource endpoint.', 'AUTHENTICATION', status);
  if (status === 403) return new ProviderError('Azure access was denied. Check resource permissions, network restrictions and the API key.', 'ACCESS_DENIED', status);
  if (status === 404 || /deploymentnotfound/.test(azureCode)) return new ProviderError('Azure deployment or route was not found. Check the endpoint, deployment name and API version.', 'DEPLOYMENT_NOT_FOUND', status);
  if (/version/.test(azureCode)) return new ProviderError('Azure rejected the API version. Check azure_openai_API_version for your deployment.', 'API_VERSION', status);
  if (status === 429) return new ProviderError('Azure rate limit or quota reached. Wait before starting a new task.', 'RATE_LIMIT', status);
  if (status === 400) return new ProviderError('Azure rejected the request. Check the API version and that the deployment supports GPT-5.4 mini function calling.', 'INVALID_REQUEST', status);
  return new ProviderError(`Azure returned HTTP ${status}. Check the Azure service before starting a new task.`, 'HTTP_ERROR', status);
}

export function azureRequestUrl(settings: AzureSettings) {
  const endpoint = settings.azureEndpoint.replace(/\/+$/, '');
  const url = new URL(`${endpoint}/openai/deployments/${encodeURIComponent(settings.azureDeployment)}/chat/completions`);
  url.searchParams.set('api-version', settings.azureApiVersion);
  return url.toString();
}

export class AzureOpenAIProvider implements DecisionProvider {
  private lastRequest?: RequestOutcome;
  private accessTest?: Promise<{ text: string; elapsedMs: number }>;
  constructor(private readonly settings: AzureSettings = config) {}

  // Explicit checks share one request and update the same status used by agent decisions.
  testAccess() {
    if (!this.accessTest) this.accessTest = this.checkAccess().finally(() => { this.accessTest = undefined; });
    return this.accessTest;
  }

  private async checkAccess() {
    const started = performance.now();
    try {
      const { azureHello } = await import('./azure-hello.js');
      const reply = await azureHello(this.settings);
      this.lastRequest = { outcome: 'succeeded', timestamp: new Date().toISOString(), elapsedMs: reply.elapsedMs, message: 'Azure connection verified: the deployment replied to the greeting test.' };
      return reply;
    } catch (error) {
      const failure = error instanceof ProviderError ? error : new ProviderError('Azure connection test failed. Check the backend configuration.', 'NETWORK_ERROR');
      this.lastRequest = { outcome: 'failed', timestamp: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started), message: failure.message, code: failure.code, status: failure.status };
      throw failure;
    }
  }

  status() {
    const configuration = azureConfiguration(this.settings);
    return {
      provider: 'azure' as const, ...configuration,
      deployment: this.settings.azureDeployment,
      model: 'gpt-5.4-mini',
      availability: !configuration.configured ? 'unconfigured' : !this.lastRequest || this.lastRequest.outcome === 'cancelled' ? 'unverified' : this.lastRequest.outcome === 'succeeded' ? 'available' : 'unavailable',
      reason: !configuration.configured ? configuration.reason : this.lastRequest?.message ?? configuration.reason,
      lastRequest: this.lastRequest,
      checkedAt: new Date().toISOString(),
    };
  }

  async decide(goal: string, observation: BrowserObservation, memory: Record<string, unknown>, signal?: AbortSignal, onProgress?: ProgressListener): Promise<AgentDecision> {
    if (signal?.aborted) throw new DOMException('Task cancelled', 'AbortError');
    const configuration = azureConfiguration(this.settings);
    if (!configuration.configured) throw new ProviderError(configuration.reason, 'CONFIGURATION');
    const started = performance.now();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.settings.azureTimeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    const publish = (phase: ProviderProgress['phase'], message: string, extra: Partial<ProviderProgress> = {}) => {
      if (signal?.aborted) return;
      const progress: ProviderProgress = { provider: 'azure', phase, model: this.settings.azureDeployment, message, elapsedMs: Math.round(performance.now() - started), ...extra };
      log(phase === 'failed' ? 'error' : 'info', `azure.${phase}`, { taskId: observation.taskId, ...progress });
      onProgress?.(progress);
    };
    publish('started', `Using Azure OpenAI deployment ${this.settings.azureDeployment}.`);
    const waiting = setInterval(() => publish('waiting', 'Waiting for Azure OpenAI…'), 5000);
    try {
      const url = azureRequestUrl(this.settings);
      const context = decisionContext(goal, observation, memory);
      const response = await fetch(url, {
        method: 'POST', signal: requestSignal, redirect: 'error',
        headers: { 'api-key': this.settings.azureApiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ messages: context.messages, tools: context.tools, tool_choice: 'required', parallel_tool_calls: false, max_completion_tokens: this.settings.azureMaxTokens, stream: false }),
      });
      requestSignal.throwIfAborted();
      if (!response.ok) {
        let code: unknown;
        try { code = (await response.json() as AzureResponse).error?.code; } catch { /* Never expose upstream response bodies. */ }
        throw azureHttpFailure(response.status, code);
      }
      let body: AzureResponse;
      try { body = await response.json() as AzureResponse; }
      catch { throw new ProviderError('Azure returned malformed JSON.', 'INVALID_RESPONSE'); }
      requestSignal.throwIfAborted();
      if (!body || typeof body !== 'object') throw new ProviderError('Azure returned an invalid response.', 'INVALID_RESPONSE');
      if (body.error) throw azureHttpFailure(response.status, body.error.code);
      const choice = body.choices?.[0];
      if (choice?.finish_reason === 'content_filter') throw new ProviderError('Azure filtered the response under its content policy.', 'CONTENT_FILTER');
      if (choice?.finish_reason === 'length') throw new ProviderError('Azure reached the completion token limit. Increase AZURE_OPENAI_MAX_COMPLETION_TOKENS before starting a new task.', 'OUTPUT_LIMIT');
      let decision: AgentDecision;
      try { decision = parseToolDecision({ message: choice?.message }, context.tools); }
      catch { throw new ProviderError('Azure returned an invalid decision. Exactly one offered tool with valid arguments is required.', 'INVALID_DECISION'); }
      this.lastRequest = { outcome: 'succeeded', timestamp: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started), message: 'The last Azure request succeeded.' };
      publish('succeeded', `Azure OpenAI succeeded (${this.settings.azureDeployment}).`);
      return decision;
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - started);
      if (signal?.aborted) {
        this.lastRequest = { outcome: 'cancelled', timestamp: new Date().toISOString(), elapsedMs, message: 'The last Azure request was cancelled. Access is unverified.' };
        throw new DOMException('Task cancelled', 'AbortError');
      }
      const failure = timeout.signal.aborted ? new ProviderError(`Azure request timed out after ${this.settings.azureTimeoutMs}ms.`, 'TIMEOUT') : error instanceof ProviderError ? error : new ProviderError('Azure could not be reached. Check the endpoint and network access.', 'NETWORK_ERROR');
      this.lastRequest = { outcome: 'failed', timestamp: new Date().toISOString(), elapsedMs, message: failure.message, code: failure.code, status: failure.status };
      publish('failed', failure.message, { code: failure.code, status: failure.status });
      throw failure;
    } finally { clearInterval(waiting); clearTimeout(timer); }
  }
}
