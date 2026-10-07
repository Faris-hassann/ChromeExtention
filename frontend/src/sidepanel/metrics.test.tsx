// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { acceptSnapshot } from '../shared/metrics';
import { snapshot } from '../shared/metrics-fixture';
import { formatMetric, MetricsPanel } from './metrics';

afterEach(cleanup);
describe('metrics panel', () => {
  it('shows totals, missing values and partial labels without inventing cost', () => {
    render(<MetricsPanel snapshot={snapshot()} />);
    expect(screen.getByRole('region', { name: 'Task metrics' }).textContent).toContain('120');
    expect(screen.getAllByText('Unavailable · Partial')).toHaveLength(3);
    expect(screen.getByText(/Set Azure input and output rates/)).toBeDefined();
  });
  it('shows safe request details and only rounds for display', () => {
    const metrics = snapshot(); metrics.requests = [{ requestId: 'request', taskId: 'task-1', provider: 'azure', deployment: 'mini', model: 'response-model', outcome: 'failed', startedAt: '2026-10-07', finishedAt: '2026-10-07', usageValid: false, inputTokens: 100, outputTokens: 20, totalTokens: 120, reasoningTokens: null, cachedInputTokens: null, toolCalls: 2, latencyMs: 1200, estimatedCostUsd: .000012345678 }];
    render(<MetricsPanel snapshot={metrics} />);
    expect(screen.getByText('failed · azure · response-model')).toBeDefined();
    expect(screen.getByText(/Invalid or inconsistent token usage/)).toBeDefined();
    expect(screen.getByText('$0.000012')).toBeDefined();
    expect(metrics.requests[0].estimatedCostUsd).toBe(.000012345678);
    expect(formatMetric('latencyMs', 1200)).toBe('1.20 s');
  });
  it('rejects old, duplicate and unrelated snapshots', () => {
    const current = snapshot();
    expect(acceptSnapshot(current, { ...current, revision: 1 }, 'task-1')).toBe(current);
    expect(acceptSnapshot(current, current, 'task-1')).toBe(current);
    expect(acceptSnapshot(current, { ...current, taskId: 'other', revision: 10 }, 'task-1')).toBe(current);
    expect(acceptSnapshot(current, { ...current, revision: 3 }, 'task-1')?.revision).toBe(3);
  });
  it('shows advisory warnings and distinguishes local actions from actual model requests', () => {
    const metrics = snapshot(); metrics.execution = { model: 2, local: 3, recovery: 1 }; metrics.estimatedInputTokens = 900;
    metrics.thresholds = { requests: 2, inputTokens: 1500, costUsd: .0011, behavior: 'warn_and_continue' };
    metrics.warnings = ['Model request warning threshold reached; continuing.'];
    render(<MetricsPanel snapshot={metrics}/>);
    expect(screen.getByText('2 / 3 / 1')).toBeDefined(); expect(screen.getByRole('status').textContent).toContain('continuing');
    expect(screen.getByText(/Warnings do not stop execution/)).toBeDefined();
  });
});
