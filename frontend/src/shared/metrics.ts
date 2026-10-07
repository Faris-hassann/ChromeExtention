export type MetricField = 'inputTokens' | 'outputTokens' | 'totalTokens' | 'reasoningTokens' | 'cachedInputTokens' | 'toolCalls' | 'latencyMs' | 'estimatedCostUsd';
export type RequestMetrics = Record<MetricField, number | null> & {
  source?: 'model'; estimatedInputTokens?: number | null; planSize?: number | null;
  requestId: string; taskId: string | null; provider: 'azure'; deployment: string; model: string | null;
  startedAt: string; finishedAt: string | null; outcome: 'pending' | 'succeeded' | 'failed' | 'cancelled'; usageValid: boolean;
};
export type MetricsSnapshot = {
  state?: string; reason?: TaskReason;
  execution?: { model: number; local: number; recovery: number }; estimatedInputTokens?: number; warnings?: string[];
  thresholds?: { requests: number; inputTokens: number; costUsd: number; behavior: 'warn_and_continue' };
  taskId: string | null; revision: number; requests: RequestMetrics[]; requestCount: number;
  aggregates: Record<MetricField, { value: number | null; partial: boolean }>;
  averageLatencyMs: number | null; models: string[];
  pricing: { currency: 'USD'; ready: boolean; cachedReady: boolean; rates: { input: number | null; cached: number | null; output: number | null } };
};
export type TaskReason = { code: string; message: string; nextAction?: string };
export function acceptSnapshot(current: MetricsSnapshot | undefined, incoming: MetricsSnapshot, taskId: string | null) {
  if (incoming.taskId !== taskId || (current?.taskId === taskId && current.revision >= incoming.revision)) return current;
  return incoming;
}
