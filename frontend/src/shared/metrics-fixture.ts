import type { MetricsSnapshot } from './metrics';
export const snapshot = (): MetricsSnapshot => ({ taskId: 'task-1', revision: 2, requestCount: 1, requests: [], models: ['mini'], averageLatencyMs: 1200, pricing: { currency: 'USD', ready: false, cachedReady: false, rates: { input: null, cached: null, output: null } }, aggregates: {
  inputTokens: { value: 100, partial: false }, outputTokens: { value: 20, partial: false }, totalTokens: { value: 120, partial: false }, reasoningTokens: { value: null, partial: true }, cachedInputTokens: { value: null, partial: true }, toolCalls: { value: 1, partial: false }, latencyMs: { value: 1200, partial: false }, estimatedCostUsd: { value: null, partial: true },
} });
