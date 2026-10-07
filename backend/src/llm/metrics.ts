import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

export type Pricing = { input: number | null; cached: number | null; output: number | null };
export type RequestMetrics = {
  requestId: string; taskId: string | null; provider: 'azure'; deployment: string; model: string | null;
  startedAt: string; finishedAt: string | null; outcome: 'pending' | 'succeeded' | 'failed' | 'cancelled';
  latencyMs: number | null; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null;
  reasoningTokens: number | null; cachedInputTokens: number | null; toolCalls: number | null;
  estimatedCostUsd: number | null; usageValid: boolean;
  source: 'model'; estimatedInputTokens: number | null; planSize: number | null;
};
export type MetricsListener = (record: RequestMetrics) => void;
export const metricFields = ['inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens', 'cachedInputTokens', 'toolCalls', 'latencyMs', 'estimatedCostUsd'] as const;
const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function rate(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}
export function pricing(): Pricing { return { input: config.azureInputRate, cached: config.azureCachedRate, output: config.azureOutputRate }; }
export function estimate(record: RequestMetrics, rates: Pricing): number | null {
  const { inputTokens: input, outputTokens: output, cachedInputTokens: cached } = record;
  if (!record.usageValid || input === null || output === null || rates.input === null || rates.output === null) return null;
  if (cached === null && rates.cached !== rates.input) return null;
  if (cached !== null && cached > 0 && rates.cached === null) return null;
  const result = ((input - (cached ?? 0)) * rates.input + (cached ?? 0) * (rates.cached ?? 0) + output * rates.output) / 1_000_000;
  return Number.isFinite(result) ? result : null;
}
/** Only allowlisted accounting data crosses this boundary. */
export function requestTracker(deployment: string, taskId: string | null, listener?: MetricsListener, rates = pricing()) {
  const started = performance.now();
  let settled = false;
  const record: RequestMetrics = { requestId: randomUUID(), taskId, provider: 'azure', deployment, model: null, startedAt: new Date().toISOString(), finishedAt: null, outcome: 'pending', latencyMs: null, inputTokens: null, outputTokens: null, totalTokens: null, reasoningTokens: null, cachedInputTokens: null, toolCalls: null, estimatedCostUsd: null, usageValid: true, source: 'model', estimatedInputTokens: null, planSize: null };
  const publish = () => { try { listener?.({ ...record }); } catch { /* Accounting must not change task execution. */ } };
  publish();
  return {
    planning(tokens: number, size?: number) { record.estimatedInputTokens = tokens; if (size !== undefined) record.planSize = size; },
    capture(body: any, secret?: string) {
      if (!body || typeof body !== 'object') return;
      record.model = typeof body.model === 'string' ? (secret ? body.model.replaceAll(secret, '[REDACTED]') : body.model).slice(0, 200) : null;
      const usage = body.usage;
      const values = [usage?.prompt_tokens, usage?.completion_tokens, usage?.total_tokens, usage?.completion_tokens_details?.reasoning_tokens, usage?.prompt_tokens_details?.cached_tokens];
      record.inputTokens = count(values[0]); record.outputTokens = count(values[1]); record.totalTokens = count(values[2]); record.reasoningTokens = count(values[3]); record.cachedInputTokens = count(values[4]);
      record.usageValid = values.every(value => value == null || count(value) !== null)
        && !(record.cachedInputTokens !== null && record.inputTokens !== null && record.cachedInputTokens > record.inputTokens)
        && !(record.reasoningTokens !== null && record.outputTokens !== null && record.reasoningTokens > record.outputTokens)
        && !(record.totalTokens !== null && record.inputTokens !== null && record.outputTokens !== null && record.totalTokens !== record.inputTokens + record.outputTokens);
      const calls = body.choices?.[0]?.message?.tool_calls;
      record.toolCalls = Array.isArray(calls) ? calls.filter((call: any) => call?.type === 'function').length : body.choices?.[0]?.message ? 0 : null;
      record.estimatedCostUsd = estimate(record, rates);
    },
    finish(outcome: RequestMetrics['outcome']) {
      if (settled) return;
      settled = true; record.outcome = outcome; record.finishedAt = new Date().toISOString(); record.latencyMs = Math.round(performance.now() - started); publish();
    },
  };
}

export class MetricsStore {
  private records = new Map<string, RequestMetrics>();
  private revision = 0;
  private execution = { model: 0, local: 0, recovery: 0 };
  private warnings = new Set<string>();
  action(source: 'model' | 'local' | 'recovery') { this.execution[source]++; this.revision++; }
  constructor(readonly taskId: string | null, private rates = pricing()) {}
  accept(record: RequestMetrics) {
    if (record.taskId !== this.taskId) return false;
    const previous = this.records.get(record.requestId);
    if (previous && (previous.outcome !== 'pending' || record.outcome === 'pending')) return false;
    this.records.set(record.requestId, { ...record }); this.revision++;
    const records = [...this.records.values()];
    if (this.taskId !== null) {
      if (config.warnRequests > 0 && records.length >= config.warnRequests) this.warnings.add('Model request warning threshold reached; continuing.');
      if (config.warnInputTokens > 0 && records.reduce((sum,item)=>sum+(item.inputTokens ?? 0),0) >= config.warnInputTokens) this.warnings.add('Input token warning threshold reached; continuing.');
      if (config.warnCostUsd > 0 && records.every(item => item.estimatedCostUsd !== null) && records.reduce((sum,item)=>sum+item.estimatedCostUsd!,0) >= config.warnCostUsd) this.warnings.add('Estimated cost warning threshold reached; continuing.');
    }
    return true;
  }
  snapshot() {
    const requests = [...this.records.values()].map(record => ({ ...record }));
    const aggregates = Object.fromEntries(metricFields.map(field => {
      const known = requests.map(record => record[field]).filter((value): value is number => value !== null);
      return [field, { value: !requests.length ? 0 : known.length ? known.reduce((a, b) => a + b, 0) : null, partial: known.length < requests.length }];
    })) as Record<typeof metricFields[number], { value: number | null; partial: boolean }>;
    const measured = requests.filter(record => record.latencyMs !== null).length;
    return { taskId: this.taskId, revision: this.revision, requests, requestCount: requests.length, execution: { ...this.execution }, warnings: [...this.warnings], thresholds: { requests: config.warnRequests, inputTokens: config.warnInputTokens, costUsd: config.warnCostUsd, behavior: 'warn_and_continue' }, estimatedInputTokens: requests.reduce((sum,record)=>sum+(record.estimatedInputTokens ?? 0),0), aggregates, averageLatencyMs: measured ? aggregates.latencyMs.value! / measured : null, models: [...new Set(requests.map(record => record.model ?? record.deployment))], pricing: { currency: 'USD', rates: { ...this.rates }, ready: this.rates.input !== null && this.rates.output !== null, cachedReady: this.rates.cached !== null } };
  }
}
