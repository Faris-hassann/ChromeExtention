import type { MetricField, MetricsSnapshot } from '../shared/metrics';

const labels: Record<MetricField, string> = { inputTokens: 'Input tokens', outputTokens: 'Output tokens', totalTokens: 'Total tokens', reasoningTokens: 'Reasoning tokens', cachedInputTokens: 'Cached input tokens', toolCalls: 'Returned function calls', latencyMs: 'Total model latency', estimatedCostUsd: 'Estimated cost (USD)' };
const fields = Object.keys(labels) as MetricField[];
export function formatMetric(field: MetricField, value: number | null) {
  if (value === null) return 'Unavailable';
  if (field === 'estimatedCostUsd') return `$${value.toFixed(6)}`;
  if (field === 'latencyMs') return `${(value / 1000).toFixed(2)} s`;
  return value.toLocaleString();
}
export function MetricsPanel({ snapshot, title = 'Task metrics' }: { snapshot: MetricsSnapshot; title?: string }) {
  return <section className="metrics-panel" aria-label={title}>
    <strong>{title}</strong>
    <table aria-label={title}><thead><tr><th scope="col">Metric</th><th scope="col">Value</th></tr></thead><tbody>
      <tr><th scope="row">LLM requests</th><td>{snapshot.requestCount}</td></tr>
      {fields.map(field => <tr key={field}><th scope="row">{labels[field]}</th><td>{formatMetric(field, field === 'estimatedCostUsd' && !snapshot.pricing.ready ? null : snapshot.aggregates[field].value)}{snapshot.aggregates[field].partial ? ' · Partial' : ''}</td></tr>)}
      <tr><th scope="row">Average model latency</th><td>{formatMetric('latencyMs', snapshot.averageLatencyMs)}{snapshot.aggregates.latencyMs.partial ? ' · Partial' : ''}</td></tr>
      <tr><th scope="row">Models / deployments</th><td>{snapshot.models.join(', ') || 'Unavailable'}</td></tr>
      {snapshot.execution && <tr><th scope="row">Browser actions (model / local / recovery)</th><td>{snapshot.execution.model} / {snapshot.execution.local} / {snapshot.execution.recovery}</td></tr>}
      {snapshot.estimatedInputTokens !== undefined && <tr><th scope="row">Estimated prompt tokens</th><td>{snapshot.estimatedInputTokens.toLocaleString()}</td></tr>}
    </tbody></table>
    {snapshot.warnings?.map(warning => <p className="budget-warning" role="status" key={warning}>{warning}</p>)}
    {snapshot.thresholds && <small>Advisory thresholds: {snapshot.thresholds.requests} requests · {snapshot.thresholds.inputTokens.toLocaleString()} input tokens · ${snapshot.thresholds.costUsd}. Warnings do not stop execution.</small>}
    {!snapshot.pricing.ready && <small>Set Azure input and output rates in backend/.env to estimate cost.</small>}
    {snapshot.pricing.ready && !snapshot.pricing.cachedReady && <small>Cached-input pricing is unavailable; requests with cached or unknown cache usage may have no cost estimate.</small>}
    <small>Model latency excludes browser actions and waiting for approval. Cost is an estimate. Metrics last for this backend session.</small>
    <details><summary>Request details ({snapshot.requestCount})</summary>{snapshot.taskId && <small>Task ID: {snapshot.taskId}</small>}{snapshot.requests.map(record => <article key={record.requestId}>
      <strong>{record.outcome} · {record.provider} · {record.model ?? record.deployment}</strong>
      <p>Deployment: {record.deployment}</p><small>Started: {record.startedAt} · Finished: {record.finishedAt ?? 'Pending'} · {record.requestId}</small>
      {record.estimatedInputTokens != null && <small>Estimated input: {record.estimatedInputTokens.toLocaleString()} tokens · Planned actions: {record.planSize ?? 'Unavailable'}</small>}
      <dl>{fields.map(field => <div className="metric-row" key={field}><dt>{labels[field]}</dt><dd>{formatMetric(field, record[field])}</dd></div>)}</dl>
      {!record.usageValid && <small>Invalid or inconsistent token usage; cost unavailable.</small>}
    </article>)}</details>
  </section>;
}
