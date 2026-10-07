import React from 'react';
import type { MetricsSnapshot, TaskReason } from '../shared/metrics';
import { formatMetric, MetricsPanel } from './metrics';
export const interruptionStates = ['COMPLETED','PAUSED','CANCELLED','FAILED','WAITING_FOR_APPROVAL'];
export function defaultReason(state: string): TaskReason {
  const values: Record<string, TaskReason> = {
    COMPLETED: {code:'GOAL_VERIFIED',message:'The task completed successfully.'},
    PAUSED: {code:'USER_PAUSE',message:'The task is paused.',nextAction:'Review the progress, then resume when ready.'},
    CANCELLED: {code:'USER_STOP',message:'You stopped this task.'},
    FAILED: {code:'EXECUTION_ERROR',message:'The task stopped because of an error.',nextAction:'Open Diagnostics to review the issue.'},
    WAITING_FOR_APPROVAL: {code:'APPROVAL_REQUIRED',message:'A browser action needs your approval.',nextAction:'Approve the action to continue, or deny it to pause.'},
  };
  return values[state] ?? {code:'ATTENTION_REQUIRED',message:'The task needs your attention.'};
}
export function RoundSummary({ snapshot, state, reason }: { snapshot?: MetricsSnapshot; state: string; reason: TaskReason }) {
  const outcome = {COMPLETED:'Task completed',PAUSED:'Task paused',CANCELLED:'Task stopped',FAILED:'Task failed',WAITING_FOR_APPROVAL:'Approval needed'}[state] ?? 'Your attention is needed';
  const cost = snapshot?.aggregates.estimatedCostUsd;
  const pending = snapshot?.requests.filter(request => request.outcome === 'pending').length ?? 0;
  return <article className={`round-summary ${state.toLowerCase()}`} aria-label="Round summary" aria-live="polite">
    <h2>{outcome}</h2><p>{reason.message}</p>{reason.nextAction && <p className="next-action">{reason.nextAction}</p>}
    <p className="round-cost">Estimated cost: <strong>{formatMetric('estimatedCostUsd',snapshot?.pricing.ready ? cost?.value ?? null : null)}{cost?.partial ? ' · Partial' : ''}</strong></p>
    {pending > 0 && <p>Accounting pending for {pending} Azure request{pending === 1 ? '' : 's'}. These totals will update when it settles.</p>}
    {snapshot ? <MetricsPanel snapshot={snapshot}/> : <p>Metrics are being retrieved. Cost is unavailable until accounting is received.</p>}
  </article>;
}
