import React, { useState } from 'react';

export type DiagnosticLog = { id: string; timestamp: string; level: 'debug' | 'info' | 'warn' | 'error'; source: 'sidepanel' | 'background' | 'backend'; event: string; taskId?: string; details?: unknown };
const titles: Record<string, string> = {
  'task.started': 'Task started', 'task.COMPLETED': 'Task completed', 'task.PAUSED': 'Task paused',
  'task.CANCELLED': 'Task stopped', 'task.FAILED': 'Task failed', 'task.RUNNING': 'Working in your browser',
  'task.PLANNING': 'Planning the next steps', 'task.WAITING_FOR_PAGE': 'Checking the page',
  'task.WAITING_FOR_APPROVAL': 'Your approval is needed', 'azure.request': 'Request sent to Azure',
  'browser.completed': 'Browser action completed', 'browser.failed': 'Browser action needs attention',
  'WebSocket connected': 'Backend connected', 'WebSocket closed': 'Backend connection lost',
  'Azure connection verified': 'Azure connection verified', 'Azure status checked': 'Azure connection checked',
  'Site access required': 'Website permission is needed', 'Testing Azure connection': 'Azure connection test failed',
  'Azure OpenAI: started': 'Planning with Azure', 'Azure OpenAI: succeeded': 'Azure responded',
  'Azure OpenAI: failed': 'Azure request failed', 'Backend health check completed': 'Backend connection checked',
  'Extension version handshake': 'Extension compatibility checked', 'Redirected site permission requested': 'Website permission requested',
  'Redirected site permission granted': 'Website permission granted', 'Redirected site permission denied': 'Website permission denied',
};
const reasons: Record<string,string> = {
  USER_STOP:'You stopped the task.', USER_PAUSE:'You paused the task.', TAKE_CONTROL:'You took control of the browser.',
  GOAL_VERIFIED:'The requested work has been completed and verified.', INPUT_REQUIRED:'The agent needs more information. Review its question in the conversation.',
  APPROVAL_REQUIRED:'Review the requested action and approve it to continue.', APPROVAL_DENIED:'The browser action was not approved.',
  NO_PROGRESS:'The same action repeated without visible progress. Review the page before resuming.', STEP_LIMIT:'The automatic step limit was reached. Review the progress before resuming.',
  VERIFICATION_FAILED:'The agent could not verify the requested outcome. Review the page before resuming.', SEARCH_NOT_VERIFIED:'The exact-text search still needs verification.',
  DISCONNECTED:'The connection to the backend was lost. Reconnect before resuming.', TARGET_CHANGED:'The page controls changed or became ambiguous. Resume to replan.',
};
export function readableEvent(log: DiagnosticLog) {
  const details = log.details as { message?: string; code?: string; tool?: string; availability?: string; matches?: boolean } | undefined;
  const title = titles[log.event] ?? (log.level === 'error' ? 'An error needs attention' : log.level === 'warn' ? 'Something needs your attention' : log.level === 'debug' ? 'Technical event' : 'Agent update');
  const status = log.event === 'Azure status checked' ? details?.availability === 'available' ? 'Azure access is verified.' : details?.availability === 'unverified' ? 'Azure is configured, but access has not been verified.' : 'Azure access is unavailable. Open Settings to review the connection.' : '';
  const recovery = details?.code === 'STALE_ELEMENT' ? 'The page changed before the action ran. The agent is checking the target again.' : 'The browser action did not finish successfully. The agent will check whether it can recover.';
  return { title, message: details?.message ?? (log.event.startsWith('task.') && details?.code ? reasons[details.code] ?? '' : log.event === 'azure.request' ? 'The agent sent a request to your Azure model.' : log.event === 'browser.completed' ? `The ${details?.tool?.replaceAll('_', ' ') ?? 'browser'} action finished successfully.` : log.event === 'browser.failed' ? recovery : status) };
}
export function DiagnosticPanel({ logs, onClear, onBack }: { logs: DiagnosticLog[]; onClear: () => void; onBack: () => void }) {
  const [advanced, setAdvanced] = useState(false);
  const [task, setTask] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [copyLabel, setCopyLabel] = useState('Copy readable logs');
  const taskIds = [...new Set(logs.flatMap(log => log.taskId ? [log.taskId] : []))];
  const shown = logs.filter(log => (advanced || log.level === 'warn' || log.level === 'error' || (log.level === 'info' && Boolean(titles[log.event]))) && (task === 'all' || log.taskId === task) && (severity === 'all' || log.level === severity));
  const copy = async () => {
    const text = shown.map(log => { const event = readableEvent(log); return `${new Date(log.timestamp).toLocaleString()} · ${log.level.toUpperCase()} · ${event.title}${event.message ? '\n'+event.message : ''}${advanced ? '\n'+JSON.stringify(log) : ''}`; }).join('\n\n');
    try { await navigator.clipboard.writeText(text); setCopyLabel('Copied'); } catch { setCopyLabel('Copy failed'); }
  };
  return <section className="diagnostics-view" aria-label="Diagnostics">
    <button onClick={onBack}>Back to task</button><h2>Diagnostics</h2>
    <p>Follow what the agent is doing and see why it needs your attention.</p>
    <div className="diagnostic-filters">
      <label>Task<select value={task} onChange={event => setTask(event.target.value)}><option value="all">All tasks</option>{taskIds.map((id,index) => <option key={id} value={id}>Task {index+1}</option>)}</select></label>
      <label>Severity<select value={severity} onChange={event => setSeverity(event.target.value)}><option value="all">All events</option><option value="info">Updates</option><option value="warn">Warnings</option><option value="error">Errors</option>{advanced && <option value="debug">Technical events</option>}</select></label>
      <label><input type="checkbox" checked={advanced} onChange={event => {setAdvanced(event.target.checked); if(!event.target.checked && severity === 'debug') setSeverity('all');}}/>Advanced details</label>
    </div>
    <div className="diagnostic-actions"><button onClick={copy} disabled={!shown.length}>{copyLabel}</button><button onClick={() => {onClear(); setTask('all');}} disabled={!logs.length}>Clear</button></div>
    {!shown.length ? <p>No events match these filters.</p> : <ol className="diagnostic-timeline">{[...shown].reverse().map(log => {const event = readableEvent(log); return <li key={log.id} className={`diagnostic-entry ${log.level}`}><time dateTime={log.timestamp}>{new Date(log.timestamp).toLocaleTimeString()}</time><span className="diagnostic-severity">{log.level === 'warn' ? 'Warning' : log.level === 'error' ? 'Error' : log.level === 'debug' ? 'Technical' : 'Update'}</span><strong>{event.title}</strong>{event.message && <p>{event.message}</p>}{advanced && <details><summary>Technical details</summary><pre>{JSON.stringify(log,null,2)}</pre></details>}</li>;})}</ol>}
  </section>;
}
