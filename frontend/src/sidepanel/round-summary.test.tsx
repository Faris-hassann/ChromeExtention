// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RoundSummary, defaultReason } from './round-summary';
import { snapshot } from '../shared/metrics-fixture';
afterEach(cleanup);
describe('round summaries',()=>{
  it.each(['COMPLETED','PAUSED','FAILED','CANCELLED','WAITING_FOR_APPROVAL'])('shows an accessible metrics table for %s',state=>{
    render(<RoundSummary snapshot={snapshot()} state={state} reason={defaultReason(state)}/>);
    expect(screen.getByRole('article',{name:'Round summary'})).toBeDefined();expect(screen.getByRole('table',{name:'Task metrics'})).toBeDefined();
    expect(screen.getByText(defaultReason(state).message)).toBeDefined();expect(screen.getByText('Estimated cost:').textContent).toContain('Unavailable');
  });
  it('shows delayed accounting and never presents missing pricing as a free task',()=>{
    const metrics=snapshot();metrics.aggregates.estimatedCostUsd={value:0,partial:false};metrics.requests=[{requestId:'pending',taskId:'task-1',provider:'azure',deployment:'mini',model:null,outcome:'pending',startedAt:'2026-10-07',finishedAt:null,usageValid:true,inputTokens:null,outputTokens:null,totalTokens:null,cachedInputTokens:null,reasoningTokens:null,toolCalls:null,latencyMs:null,estimatedCostUsd:null}];
    render(<RoundSummary snapshot={metrics} state="CANCELLED" reason={defaultReason('CANCELLED')}/>);
    expect(screen.getByText(/Accounting pending for 1 Azure request/)).toBeDefined();expect(screen.queryByText('$0.000000')).toBeNull();
  });
  it('displays known cost without changing underlying precision',()=>{
    const metrics=snapshot();metrics.pricing.ready=true;metrics.aggregates.estimatedCostUsd={value:.00112345678,partial:true};
    render(<RoundSummary snapshot={metrics} state="PAUSED" reason={defaultReason('PAUSED')}/>);
    expect(screen.getAllByText('$0.001123 · Partial')).toHaveLength(2);expect(metrics.aggregates.estimatedCostUsd.value).toBe(.00112345678);
  });
});
