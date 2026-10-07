/** Opt-in, read-only benchmark of an existing task. Never creates paid requests. */
const taskId = process.argv[process.argv.indexOf('--task-id') + 1];
const backendFlag = process.argv.indexOf('--backend');
const backend = backendFlag >= 0 ? process.argv[backendFlag + 1] : 'http://127.0.0.1:3333';
if (!process.argv.includes('--task-id') || !taskId || !backend) {
  console.error('Usage: npm run benchmark:task --prefix backend -- --task-id <task-id> [--backend http://127.0.0.1:3333]');
  process.exitCode = 1;
} else {
  try {
    const origin = new URL(backend);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) || origin.protocol !== 'http:' || origin.username || origin.password) throw new Error('Use a local HTTP backend URL.');
    const response = await fetch(new URL(`/api/agent/tasks/${encodeURIComponent(taskId)}/metrics`, origin), { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Metrics returned HTTP ${response.status}; the task must belong to this running backend session.`);
    const metrics = await response.json();
    const input = metrics.aggregates.inputTokens;
    const inProgress = !['COMPLETED','FAILED','CANCELLED'].includes(metrics.state);
    const pending = metrics.requests.some((request: { outcome: string }) => request.outcome === 'pending');
    const reduction = input.partial || pending || inProgress || input.value === null ? null : (1 - input.value / 12831) * 100;
    console.log(JSON.stringify({ taskId, baseline: { requests: 4, inputTokens: 12831, totalTokens: 13055 }, observed: { requests: metrics.requestCount, inputTokens: input, outputTokens: metrics.aggregates.outputTokens, totalTokens: metrics.aggregates.totalTokens, latencyMs: metrics.aggregates.latencyMs, averageLatencyMs: metrics.averageLatencyMs, estimatedCostUsd: metrics.aggregates.estimatedCostUsd, execution: metrics.execution }, inputReductionPercent: reduction, pending, state: metrics.state, warnings: metrics.warnings }, null, 2));
  } catch (error) {
    console.error(error instanceof Error && /^Metrics returned HTTP|Use a local HTTP/.test(error.message) ? error.message : 'Benchmark could not read the local backend metrics. Check the address and task ID.');
    process.exitCode = 1;
  }
}
export {};
