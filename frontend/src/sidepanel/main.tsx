import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Envelope, Settings } from '../shared/types';
import { defaults } from '../shared/types';
import { loadSettings, saveSettings } from '../storage/settings';
import { resolveSiteAccess, samePendingSiteAccess, siteFromUrl, type PendingSiteAccess, type SiteAccessRequired } from '../shared/site-access';
import { BUILD_VERSION } from '../shared/build-version';
import { recoverHostAccess, RetryGate, workerMatches } from '../shared/recovery';
import './styles.css';
import './diagnostics.css';
import './automation.css';

type ProviderProgress = { provider: 'azure'; phase: string; model: string; message: string; elapsedMs?: number; step?: number; code?: string; status?: number };
type AzureStatus = { configured: boolean; deployment?: string; model?: string; availability: 'unconfigured' | 'unverified' | 'available' | 'unavailable' | 'unknown'; missing?: string[]; reason: string; checkedAt: string; lastRequest?: { outcome: string; timestamp: string; message: string } };
type Activity = { id: string; timestamp?: string; kind: 'user' | 'agent' | 'system' | 'error'; text: string; detail?: unknown };
type Approval = { site: string; risk: string; actionSummary: string; arguments?: unknown; toolCallId?: string };
type ActiveSite = { origin: string; hostname: string } | { error: string };
type DiagnosticLog = { id: string; timestamp: string; level: 'debug' | 'info' | 'warn' | 'error'; source: 'sidepanel' | 'background' | 'backend'; event: string; details?: unknown };
type PersistedDiagnostic = Omit<DiagnosticLog, 'id'>;

async function flushDiagnosticQueue(queue: PersistedDiagnostic[], backendUrl: string) {
  if (!queue.length) return;
  const batch = queue.splice(0, 100);
  try {
    const response = await fetch(`${backendUrl}/api/diagnostics/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: batch }), keepalive: true });
    if (!response.ok) throw new Error(`Diagnostic ingestion returned HTTP ${response.status}`);
  } catch (error) {
    queue.unshift(...batch); if (queue.length > 500) queue.splice(0, queue.length - 500);
    console.error('[sidepanel] Failed to persist diagnostics', error);
  }
}

function errorDetails(error: unknown) {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { message: String(error) };
}

function safeDiagnostic(value: any, depth = 0): any {
  if (depth > 5) return '[MAX_DEPTH]';
  if (typeof value === 'string') return value.length > 1000 ? `${value.slice(0, 1000)}…[truncated]` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map(item => safeDiagnostic(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/password|token|secret|cookie|authorization|api[-_]?key|capturedText|pageText|prompt|content|semanticContent|screenshotRef|value|^title$|^text$|^summary$|^question$/i.test(key)) return [key, '[REDACTED]'];
    if (/url$|^site$/i.test(key) && typeof item === 'string') { try { return [key, new URL(item).origin]; } catch { return [key, '[REDACTED_URL]']; } }
    return [key, safeDiagnostic(item, depth + 1)];
  }));
  return value;
}

function responseSummary(value: any) {
  if (!value || typeof value !== 'object') return value;
  if (value.observationId) return { observationId: value.observationId, taskId: value.taskId, url: value.url, title: value.title, loadingState: value.loadingState, interactiveElementCount: value.interactiveElements?.length ?? 0 };
  return safeDiagnostic(value);
}

function activeSiteFromUrl(rawUrl?: string): ActiveSite {
  if (!rawUrl) return { error: 'No active browser tab was found.' };
  return siteFromUrl(rawUrl) ?? { error: 'Open a regular http(s) website before starting a task.' };
}

class BackgroundRequestError extends Error {
  constructor(readonly response: Record<string, any>, stage: string) {
    super(response.error ? `${stage}: ${response.error}` : `${stage} failed`);
  }
}

function App() {
  const [settings, setSettings] = useState<Settings>(defaults); const [showSettings, setShowSettings] = useState(false);
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'disconnected'>('connecting'); const [providerHealth, setProviderHealth] = useState<'checking' | 'reachable' | 'unavailable'>('checking');
  const [goal, setGoal] = useState(''); const [taskId, setTaskId] = useState<string>(); const [taskState, setTaskState] = useState('IDLE');
  const [activeSite, setActiveSite] = useState<ActiveSite>({ error: 'Checking the active tab…' });
  const [diagnostics, setDiagnostics] = useState<DiagnosticLog[]>([]);
  const [pendingSiteAccess, setPendingSiteAccess] = useState<PendingSiteAccess<Envelope>>();
  const retryGate = useRef(new RetryGate());
  const boundTabRef = useRef<number | undefined>(undefined);
  const [workerReady, setWorkerReady] = useState(false);
  const [providerLabel, setProviderLabel] = useState('Checking model');
  const [providerProgress, setProviderProgress] = useState<ProviderProgress>();
  const [azureStatus, setAzureStatus] = useState<AzureStatus>();
  const [refreshingAzure, setRefreshingAzure] = useState(false);
  const [testingAzure, setTestingAzure] = useState(false);
  const [azureTestReply, setAzureTestReply] = useState<string>();
  const azureTestInFlight = useRef(false);
  const azureStatusVersion = useRef(0);
  const [activities, setActivities] = useState<Activity[]>([{ id: crypto.randomUUID(), kind: 'agent', text: 'I’m ready. Tell me what you want to do in your browser.' }]); const [approval, setApproval] = useState<Approval>();
  const [screenshot, setScreenshot] = useState<string>(); const [showShot, setShowShot] = useState(false); const wsRef = useRef<WebSocket | undefined>(undefined); const taskRef = useRef<string | undefined>(undefined);
  const startingTask = useRef(false);
  const executionEpoch = useRef(0);
  const taskStateRef = useRef('IDLE');
  const handledRequests = useRef(new Set<string>());
  const actionQueue = useRef<Promise<void>>(Promise.resolve());
  const invalidateExecution = useCallback((state: string) => { executionEpoch.current += 1; taskStateRef.current = state; }, []);
  const diagnosticQueueRef = useRef<PersistedDiagnostic[]>([]); const backendUrlRef = useRef(defaults.backendUrl);
  const add = useCallback((kind: Activity['kind'], text: string, detail?: unknown) => setActivities(list => [...list, { id: crypto.randomUUID(), timestamp: new Date().toISOString(), kind, text, detail }]), []);
  const log = useCallback((level: DiagnosticLog['level'], source: DiagnosticLog['source'], event: string, details?: unknown) => {
    const entry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), level, source, event, details: safeDiagnostic(details) } satisfies DiagnosticLog;
    setDiagnostics(list => [...list.slice(-499), entry]);
    diagnosticQueueRef.current.push({ timestamp: entry.timestamp, level: entry.level, source: entry.source, event: entry.event, details: entry.details });
    if (diagnosticQueueRef.current.length >= 20) void flushDiagnosticQueue(diagnosticQueueRef.current, backendUrlRef.current);
    const method = level === 'debug' ? 'debug' : level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'info';
    console[method](`[${source}] ${event}`, entry.details ?? '');
  }, []);
  const reportError = useCallback((stage: string, error: unknown, details?: unknown) => { const diagnostic = { stage, ...errorDetails(error), context: details }; log('error', 'sidepanel', stage, diagnostic); add('error', `${stage}: ${diagnostic.message}`, diagnostic); }, [add, log]);
  const sendWs = useCallback((message: Envelope) => { const socket = wsRef.current; if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('WebSocket is not open'); log('debug', 'sidepanel', `WebSocket send: ${message.event}`, { taskId: message.taskId, toolCallId: message.toolCallId, payload: responseSummary(message.payload) }); socket.send(JSON.stringify(message)); }, [log]);
  const requestBackground = useCallback(async (stage: string, message: Record<string, unknown>) => { log('debug', 'sidepanel', `Background request: ${stage}`, message); const response = await chrome.runtime.sendMessage(message); if (!response) throw new Error('Background worker returned no response'); if (response.ok === false && (message.type !== 'EXECUTE' || !response.code || response.code === 'SITE_ACCESS_REQUIRED')) throw new BackgroundRequestError(response, response.stage ?? stage); log(response.ok === false ? 'warn' : 'debug', 'background', `${stage} ${response.ok === false ? 'needs recovery' : 'succeeded'}`, responseSummary(response)); return response; }, [log]);
  const refreshAzure = useCallback(async () => {
    if (azureTestInFlight.current) return;
    const version = azureStatusVersion.current;
    setRefreshingAzure(true);
    try {
      const response = await fetch(`${settings.backendUrl}/api/providers/azure/status`, { signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw new Error('Status unavailable');
      const status = await response.json();
      if (version !== azureStatusVersion.current) return;
      if (!['available', 'unavailable', 'unverified', 'unconfigured'].includes(status.availability)) throw new Error('Invalid status');
      setAzureStatus(status); setProviderLabel(`Azure OpenAI · ${status.deployment || 'deployment not configured'}`); setProviderHealth(status.availability === 'available' ? 'reachable' : status.availability === 'unverified' ? 'checking' : 'unavailable'); log('info', 'backend', 'Azure status checked', status);
    } catch { if (version === azureStatusVersion.current) setAzureStatus({ configured: false, availability: 'unknown', reason: 'Azure status is unavailable. Check the backend connection.', checkedAt: new Date().toISOString() }); }
    finally { setRefreshingAzure(false); }
  }, [settings.backendUrl, log]);
  const testAzureConnection = async () => {
    if (azureTestInFlight.current) return;
    azureTestInFlight.current = true; azureStatusVersion.current += 1; setTestingAzure(true); setAzureTestReply(undefined);
    try {
      const runtimeResponse = await fetch(`${settings.backendUrl}/api/settings/runtime`);
      if (!runtimeResponse.ok) throw new Error('Backend configuration is unavailable.');
      const runtime = await runtimeResponse.json();
      const timeoutMs = Number.isInteger(runtime.azureTimeoutMs) && runtime.azureTimeoutMs > 0 ? runtime.azureTimeoutMs : 90000;
      const response = await fetch(`${settings.backendUrl}/api/providers/azure/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(Math.min(timeoutMs + 5000, 2147483647)) });
      const result = await response.json();
      if (result.status && typeof result.status.configured === 'boolean') {
        setAzureStatus(result.status);
        setProviderHealth(result.status.availability === 'available' ? 'reachable' : 'unavailable');
        setProviderLabel(`Azure OpenAI · ${result.status.deployment || 'deployment not configured'}`);
      }
      if (!response.ok) throw new Error(result.error || 'Azure connection test failed. Restart the updated backend and try again.');
      if (result.status?.availability !== 'available' || typeof result.reply !== 'string') throw new Error('Invalid connection test response. Restart the updated backend.');
      setAzureTestReply(result.reply);
      log('info', 'backend', 'Azure connection verified', { elapsedMs: result.elapsedMs });
    } catch (error) { reportError('Testing Azure connection', error); }
    finally { azureTestInFlight.current = false; setTestingAzure(false); }
  };
  useEffect(() => { void refreshAzure(); }, [refreshAzure]);
  useEffect(() => { loadSettings().then(setSettings); }, []);
  useEffect(() => { backendUrlRef.current = settings.backendUrl; }, [settings.backendUrl]);
  useEffect(() => { const timer = window.setInterval(() => void flushDiagnosticQueue(diagnosticQueueRef.current, backendUrlRef.current), 2000); return () => { window.clearInterval(timer); void flushDiagnosticQueue(diagnosticQueueRef.current, backendUrlRef.current); }; }, []);
  useEffect(() => { const listener = (message: any) => { if (message?.type === 'BACKGROUND_DIAGNOSTIC' && message.payload) { const entry = message.payload; log(entry.level ?? 'debug', 'background', entry.event ?? 'background.event', entry.details); } }; chrome.runtime.onMessage.addListener(listener); return () => chrome.runtime.onMessage.removeListener(listener); }, [log]);
  useEffect(() => {
    const refreshActiveSite = () => chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => { const site = activeSiteFromUrl(tab?.url); setActiveSite(site); log('debug', 'sidepanel', 'Active tab updated', 'origin' in site ? { tabId: tab?.id, origin: site.origin } : site); }).catch(error => { setActiveSite({ error: error instanceof Error ? error.message : String(error) }); reportError('Reading active tab', error); });
    const onActivated = () => { void refreshActiveSite(); };
    const onUpdated = (_tabId: number, changeInfo: { url?: string; status?: string }, tab: chrome.tabs.Tab) => { if (tab.active && (changeInfo.url || changeInfo.status === 'complete')) void refreshActiveSite(); };
    void refreshActiveSite();
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => { chrome.tabs.onActivated.removeListener(onActivated); chrome.tabs.onUpdated.removeListener(onUpdated); };
  }, [log, reportError]);
  useEffect(() => { taskRef.current = taskId; }, [taskId]);
  useEffect(() => { if (connection === 'disconnected') void chrome.runtime.sendMessage({ type: 'CLEANUP_INPUT', tabId: boundTabRef.current }).catch(() => undefined); }, [connection]);
  useEffect(() => () => { invalidateExecution('PAUSED'); void chrome.runtime.sendMessage({ type: 'CLEANUP_INPUT', tabId: boundTabRef.current }).catch(() => undefined); }, []);
  useEffect(() => {
    void chrome.runtime.sendMessage({ type: 'GET_VERSION' }).then(response => {
      const matches = workerMatches(response);
      setWorkerReady(matches);
      log(matches ? 'info' : 'warn', 'sidepanel', 'Extension version handshake', { sidepanelVersion: BUILD_VERSION, backgroundVersion: response?.buildVersion ?? 'legacy', matches });
      if (!matches) add('error', 'Reload Local Browser Agent at chrome://extensions, then reopen this panel. The background worker is from an older build.');
    }).catch(error => reportError('Checking extension build', error));
    void fetch(`${settings.backendUrl}/api/settings/runtime`).then(r => r.json()).then(runtime => setProviderLabel(`Azure OpenAI · ${runtime.azureDeployment || "deployment not configured"}`)).catch(() => setProviderLabel("Azure OpenAI - backend unavailable"));
  }, [add, log, reportError, settings.backendUrl]);
  const handleActionRequest = useCallback(async (msg: Envelope) => {
    if (msg.event !== 'server.action_request' || !msg.taskId || msg.taskId !== taskRef.current || ['PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(taskStateRef.current)) return;
    const requestTaskId = msg.taskId;
    const requestKey = msg.payload.tool === 'observe_page' ? msg.requestId : msg.toolCallId;
    if (!requestKey || handledRequests.current.has(requestKey)) return;
    handledRequests.current.add(requestKey);
    const epoch = executionEpoch.current;
    const valid = () => taskRef.current === msg.taskId && executionEpoch.current === epoch && !['PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(taskStateRef.current);
    const run = async () => {
      if (!valid()) return;
      const tabId = (msg as Envelope & { tabId?: number }).tabId ?? boundTabRef.current;
      const retryRequest = { ...msg, tabId };
      try {
        if (msg.payload.tool === 'observe_page') { const obs = await requestBackground('Observe page', { type: 'OBSERVE', taskId: msg.taskId, tabId }); if (valid()) sendWs({ event: 'client.observation', taskId: msg.taskId, requestId: msg.requestId, payload: obs }); return; }
        const result = await requestBackground(`Execute ${msg.payload.tool}`, { type: 'EXECUTE', tool: msg.payload.tool, arguments: msg.payload.arguments, tabId, visibleCursor: settings.visibleCursor }); if (!valid()) return; if (result.screenshotRef) { setScreenshot(result.screenshotRef); setShowShot(true); }
        if (result.code === 'INPUT_UNAVAILABLE') { invalidateExecution('PAUSED'); sendWs({ event: 'client.user_control', taskId: msg.taskId, payload: { action: 'pause' } }); setTaskState('PAUSED'); add('error', result.error ?? 'Browser-level input is unavailable. Close DevTools or another debugger attached to this tab, then resume.'); }
        if (valid()) sendWs({ event: 'client.action_result', taskId: msg.taskId, toolCallId: msg.toolCallId, payload: result });
      } catch (error) {
        if (!valid()) return;
        const response = error instanceof BackgroundRequestError ? await recoverHostAccess(error.response, tabId) : undefined;
        if (!valid()) return;
        if (response?.code === 'SITE_ACCESS_REQUIRED' && response.origin && response.hostname) {
          handledRequests.current.delete(requestKey);
          const next = { taskId: requestTaskId, origin: response.origin, hostname: response.hostname, request: retryRequest };
          setPendingSiteAccess(current => samePendingSiteAccess(current, next) ? current : next);
          log('warn', 'sidepanel', 'Site access required', { taskId: msg.taskId, origin: response.origin, retryable: response.retryable });
          return;
        }
        throw error;
      }
    };
    const queued = actionQueue.current.then(run);
    actionQueue.current = queued.catch(() => undefined);
    await queued;
  }, [add, invalidateExecution, log, requestBackground, sendWs, settings.visibleCursor]);
  useEffect(() => {
    let reconnect: number; let stopped = false; const connect = () => { const wsUrl = settings.backendUrl.replace(/^http/, 'ws') + '/ws'; setConnection('connecting'); log('info', 'sidepanel', 'Connecting WebSocket', { url: wsUrl }); const socket = new WebSocket(wsUrl); wsRef.current = socket; socket.onopen = () => { setConnection('connected'); void refreshAzure(); void fetch(`${settings.backendUrl}/api/settings/runtime`).then(r => r.json()).then(runtime => setProviderLabel(`Azure OpenAI · ${runtime.azureDeployment || "deployment not configured"}`)).catch(() => undefined); log('info', 'sidepanel', 'WebSocket connected', { url: wsUrl }); }; socket.onclose = event => { setConnection('disconnected'); log(stopped ? 'debug' : 'warn', 'sidepanel', 'WebSocket closed', { code: event.code, reason: event.reason || 'No reason supplied', clean: event.wasClean, reconnecting: !stopped }); if (taskRef.current && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(taskStateRef.current)) { invalidateExecution('PAUSED'); setTaskState('PAUSED'); } if (!stopped) reconnect = window.setTimeout(connect, 2000); }; socket.onerror = () => { log('error', 'sidepanel', 'WebSocket transport error', { url: wsUrl }); socket.close(); }; socket.onmessage = event => { try { const message = JSON.parse(event.data) as Envelope; log('debug', 'backend', `WebSocket receive: ${message.event}`, { taskId: message.taskId, toolCallId: message.toolCallId, payload: responseSummary(message.payload) }); void handle(message).catch(error => reportError(`Handling ${message.event}`, error, { taskId: message.taskId, toolCallId: message.toolCallId })); } catch (error) { reportError('Parsing backend WebSocket message', error, { raw: String(event.data).slice(0, 500) }); } }; }; connect(); return () => { stopped = true; clearTimeout(reconnect); wsRef.current?.close(); };
    async function handle(msg: Envelope) {
      if (msg.taskId && msg.taskId !== taskRef.current) return;
      if (msg.event === 'server.task_state' && msg.taskId === taskRef.current) { if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(taskStateRef.current)) return; if (taskStateRef.current === 'PAUSED' && !['PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(msg.payload.state)) return; taskStateRef.current = msg.payload.state; setTaskState(msg.payload.state); if (['PAUSED', 'CANCELLED', 'FAILED', 'COMPLETED'].includes(msg.payload.state)) { invalidateExecution(msg.payload.state); if (msg.payload.state !== 'PAUSED') { setPendingSiteAccess(undefined); setApproval(undefined); } void chrome.runtime.sendMessage({ type: 'CLEANUP_INPUT', tabId: boundTabRef.current }); } }
      if (msg.event === 'server.provider_progress') {
        const progress = msg.payload as ProviderProgress;
        setProviderProgress(progress);
        const provider = 'Azure OpenAI';
        setProviderLabel(`${provider} · ${progress.model} · ${progress.phase}`);
        if (progress.provider === 'azure' && ['failed', 'succeeded'].includes(progress.phase)) void refreshAzure();
        if (progress.phase !== 'waiting') {
          log(progress.phase === 'failed' ? 'warn' : 'info', 'backend', `${provider}: ${progress.phase}`, progress);
          add(progress.phase === 'failed' ? 'error' : 'agent', `${progress.message}${progress.elapsedMs !== undefined ? ` (${(progress.elapsedMs / 1000).toFixed(1)}s)` : ''}`, progress);
        }
      }
      if (msg.event === 'server.activity' && msg.payload.message !== 'Connected to local agent.') add('agent', msg.payload.message, msg.payload.detail);
      if (msg.event === 'server.error') { log('error', 'backend', msg.payload.stage ?? 'Backend error', msg.payload); add('error', msg.payload.message, msg.payload); }
      if (msg.event === 'server.approval_request' && !['PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(taskStateRef.current)) setApproval({ ...msg.payload, toolCallId: msg.toolCallId });
      await handleActionRequest(msg);
    }
  }, [add, handleActionRequest, log, reportError, settings.backendUrl, refreshAzure, invalidateExecution]);
  useEffect(() => { const url = `${settings.backendUrl}/health`; log('debug', 'sidepanel', 'Backend health check started', { url }); fetch(url).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(`Health endpoint returned HTTP ${response.status}`); setProviderHealth(data.azureAvailability === 'available' ? 'reachable' : data.azureConfigured ? 'checking' : 'unavailable'); log('info', 'backend', 'Backend health check completed', data); }).catch(error => { setProviderHealth('unavailable'); reportError('Backend health check', error, { url }); }); }, [log, reportError, settings.backendUrl]);
  const send = async () => { const text = goal.trim(); if (startingTask.current || !text || connection !== 'connected' || !workerReady || azureStatus?.configured === false) return; if ('error' in activeSite) { reportError('Site access preflight', new Error(activeSite.error)); return; } startingTask.current = true; try { log('info', 'sidepanel', 'Site permission requested', { origin: activeSite.origin }); const granted = await chrome.permissions.contains({ origins: [activeSite.origin] }); log(granted ? 'info' : 'warn', 'sidepanel', 'Site permission result', { origin: activeSite.origin, granted }); if (!granted) { add('error', `Access to ${activeSite.hostname} was not granted. Allow site access in Chrome and try again.`); return; } add('user', text); setGoal(''); log('info', 'sidepanel', 'Creating agent task', { goalLength: text.length, activeOrigin: activeSite.origin }); const response = await fetch(`${settings.backendUrl}/api/agent/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: text, approvalMode: settings.approvalMode }) }); const task = await response.json(); if (!response.ok) throw new Error(task.error ?? `Task creation returned HTTP ${response.status}`); log('info', 'backend', 'Agent task created', { taskId: task.id, state: task.state }); if (taskRef.current) { sendWs({ event: 'client.user_control', taskId: taskRef.current, payload: { action: 'stop' } }); await chrome.runtime.sendMessage({ type: 'CLEANUP_INPUT', tabId: boundTabRef.current }).catch(() => undefined); } invalidateExecution(task.state); handledRequests.current.clear(); setProviderProgress(undefined); setPendingSiteAccess(undefined); setApproval(undefined); taskRef.current = task.id; boundTabRef.current = (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id; setTaskId(task.id); setTaskState(task.state); await handleActionRequest({ event: 'server.action_request', taskId: task.id, requestId: task.observationRequestId, payload: { tool: 'observe_page', arguments: {} } }); } catch (error) { reportError('Starting task', error, { activeOrigin: activeSite.origin }); } finally { startingTask.current = false; } };
  const control = async (action: string) => {
    if (!taskId || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(taskStateRef.current)) return;
    if (['pause', 'stop', 'take_control'].includes(action)) invalidateExecution(action === 'stop' ? 'CANCELLED' : 'PAUSED');
    if (['pause', 'stop', 'take_control'].includes(action)) await chrome.runtime.sendMessage({ type: 'CLEANUP_INPUT', tabId: boundTabRef.current }).catch(() => undefined);
    if (action === 'stop') { setPendingSiteAccess(undefined); taskRef.current = undefined; setTaskState('CANCELLED'); }
    if (action === 'resume' && pendingSiteAccess) { await grantPendingSiteAccess(); return; }
    if (action === 'approve' && approval?.arguments && typeof approval.arguments === 'object') {
      const destinationUrl = (approval.arguments as Record<string, unknown>).url;
      if (typeof destinationUrl === 'string') {
        const destination = siteFromUrl(destinationUrl);
        if (destination) {
          try {
            const granted = await chrome.permissions.request({ origins: [destination.origin] });
            if (!granted) { add('error', `Access to ${destination.hostname} was not granted, so navigation was cancelled.`); return; }
          } catch (error) { reportError('Requesting destination access', error, { destination: destination.origin }); return; }
        }
      }
    }
    if (action === 'resume') taskStateRef.current = 'WAITING_FOR_PAGE';
    try { sendWs({ event: 'client.user_control', taskId, payload: { action } }); } catch (error) { reportError(`Sending ${action} control`, error, { taskId }); return; }
    if (action === 'approve' || action === 'deny') setApproval(undefined);
  };
  const pauseForDeniedSiteAccess = useCallback(async (deniedTaskId: string) => {
    if (taskRef.current !== deniedTaskId || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(taskStateRef.current)) return;
    invalidateExecution('PAUSED');
    sendWs({ event: 'client.user_control', taskId: deniedTaskId, payload: { action: 'pause' } });
    setTaskState('PAUSED');
  }, [sendWs, invalidateExecution]);
  const grantPendingSiteAccess = async () => retryGate.current.run(async () => {
    const pending = pendingSiteAccess;
    if (!pending) return;
    try {
      log('info', 'sidepanel', 'Redirected site permission requested', { origin: pending.origin, taskId: pending.taskId });
      const outcome = await resolveSiteAccess(pending, {
        request: origin => chrome.permissions.request({ origins: [origin] }),
        retry: async request => { if (taskRef.current !== pending.taskId || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(taskStateRef.current)) return; setPendingSiteAccess(undefined); if (taskStateRef.current === 'PAUSED') { taskStateRef.current = 'WAITING_FOR_PAGE'; sendWs({ event: 'client.user_control', taskId: pending.taskId, payload: { action: 'resume' } }); } else { log('info', 'sidepanel', 'Retrying preserved request', { taskId: pending.taskId, origin: pending.origin }); await handleActionRequest(request); } },
        pause: pauseForDeniedSiteAccess,
      });
      if (taskRef.current !== pending.taskId) return;
      log(outcome === 'granted' ? 'info' : 'warn', 'sidepanel', `Redirected site permission ${outcome}`, { origin: pending.origin, taskId: pending.taskId });
      if (outcome === 'denied') { add('error', `Access to ${pending.hostname} was not granted. The task is paused; grant site access and resume to try again.`); }
    } catch (error) { reportError('Granting redirected site access', error, { origin: pending.origin, taskId: pending.taskId }); }
  });
  const denyPendingSiteAccess = async () => {
    const pending = pendingSiteAccess;
    if (!pending) return;
    try { await pauseForDeniedSiteAccess(pending.taskId); add('system', `Task paused without granting access to ${pending.hostname}.`); }
    catch (error) { reportError('Pausing for denied site access', error, { origin: pending.origin, taskId: pending.taskId }); }
  };
  const statusText = useMemo(() => taskState.replaceAll('_', ' ').toLowerCase(), [taskState]);
  return <main className="shell">
    <header><div className="brand"><span className="mark">L</span><div><strong>Local Agent</strong><small>{providerLabel}</small></div></div><button className="icon" onClick={() => setShowSettings(!showSettings)} aria-label="Settings">⚙</button></header>
    <section className="statusbar"><span className={`dot ${connection}`} /><span>{connection}</span><span className="divider" /><span className={`dot ${providerProgress ? providerProgress.phase === 'failed' ? 'unavailable' : providerProgress.phase === 'succeeded' ? 'reachable' : 'checking' : providerHealth}`} /><span>{providerLabel}</span>{taskId && <><span className="divider" /><span>{statusText}</span></>}</section>
    {showSettings ? <SettingsPanel settings={settings} deployment={azureStatus?.deployment} onSave={async s => { await saveSettings(s); setSettings(s); setShowSettings(false); }} /> : <>
      <section className="provider-progress" aria-label="Azure OpenAI status"><strong>Azure OpenAI: {testingAzure ? 'testing' : azureStatus?.availability ?? 'checking'}</strong>{azureStatus && <><span>{testingAzure ? 'Sending hi to Azure and waiting for its reply…' : azureStatus.reason}</span>{azureStatus.lastRequest && <small>Last request: {azureStatus.lastRequest.outcome} &middot; {new Date(azureStatus.lastRequest.timestamp).toLocaleString()}</small>}</>}{azureTestReply && <span>Azure reply: {azureTestReply}</span>}<button onClick={() => void testAzureConnection()} disabled={testingAzure || !azureStatus?.configured}>{testingAzure ? 'Testing Azure…' : 'Test Azure connection'}</button><button onClick={() => void refreshAzure()} disabled={refreshingAzure || testingAzure}>Refresh Azure status</button></section>
      {providerProgress && <section className={`provider-progress ${providerProgress.phase}`} aria-live="polite"><strong>{'Azure OpenAI'} · {providerProgress.model}</strong><span>{providerProgress.message}</span><small>{providerProgress.step ? `Step ${providerProgress.step} · ` : ''}{providerProgress.phase}{providerProgress.elapsedMs !== undefined ? ` · ${(providerProgress.elapsedMs / 1000).toFixed(1)}s` : ''}</small></section>}
      <section className="conversation">{activities.map(item => <article key={item.id} className={`message ${item.kind}`}>{item.timestamp && <time className="activity-time">{new Date(item.timestamp).toLocaleTimeString()}</time>}<div>{item.text}</div>{item.detail != null && <details><summary>Technical details</summary><pre>{JSON.stringify(item.detail, null, 2)}</pre></details>}</article>)}
        {approval && <article className="approval"><div className="risk">{approval.risk} RISK · APPROVAL NEEDED</div><h3>{approval.actionSummary}</h3><p>{approval.site}</p>{approval.arguments != null && <pre>{JSON.stringify(approval.arguments, null, 2)}</pre>}<div className="row"><button className="primary" onClick={() => control('approve')}>Approve once</button><button onClick={() => control('deny')}>Deny</button></div></article>}
        {screenshot && <section className="shot"><button onClick={() => setShowShot(!showShot)}>Latest screenshot {showShot ? '▴' : '▾'}</button>{showShot && <img src={screenshot} alt="Latest ephemeral browser screenshot" />}</section>}
        {pendingSiteAccess && <article className="site-access"><div className="risk">SITE ACCESS NEEDED</div><h3>Continue on {pendingSiteAccess.hostname}</h3><p>The page redirected to a different site. Grant access to this site only so the current task can continue.</p><code>{pendingSiteAccess.origin}</code><div className="row"><button className="primary" onClick={grantPendingSiteAccess}>Grant access &amp; continue</button><button onClick={denyPendingSiteAccess}>Pause task</button></div></article>}
        <DiagnosticPanel logs={diagnostics} onClear={() => setDiagnostics([])} />
      </section>
      {taskId && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(taskState) && <nav className="controls"><button onClick={() => control('pause')}>Pause</button><button onClick={() => control('resume')}>Resume</button><button onClick={() => control('take_control')}>Take control</button><button className="danger" onClick={() => control('stop')}>Stop</button></nav>}
      <footer><div className="composer"><textarea value={goal} onChange={e => setGoal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Ask me to work in your browser…" rows={2} /><button className="send" onClick={send} disabled={!goal.trim() || connection !== 'connected' || !workerReady || azureStatus?.configured === false}>↑</button></div><small>Task data stays ephemeral. Azure OpenAI receives task and page context.</small></footer>
    </>}
  </main>;
}

function DiagnosticPanel({ logs, onClear }: { logs: DiagnosticLog[]; onClear: () => void }) {
  const [copyLabel, setCopyLabel] = useState('Copy logs');
  const text = logs.map(({ timestamp, level, source, event, details }) => JSON.stringify({ timestamp, level, source, event, details })).join('\n');
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopyLabel('Copied'); }
    catch { setCopyLabel('Copy failed'); }
    window.setTimeout(() => setCopyLabel('Copy logs'), 1500);
  };
  return <details className="diagnostics" open>
    <summary>Diagnostics ({logs.length})</summary>
    <div className="diagnostic-actions"><button onClick={copy} disabled={!logs.length}>{copyLabel}</button><button onClick={onClear} disabled={!logs.length}>Clear</button></div>
    {!logs.length ? <p>No diagnostic events yet.</p> : <div className="diagnostic-list">{[...logs].reverse().map(item => <article key={item.id} className={`diagnostic-entry ${item.level}`}><time>{new Date(item.timestamp).toLocaleTimeString()}</time><strong>{item.source} · {item.event}</strong>{item.details !== undefined && <pre>{JSON.stringify(item.details, null, 2)}</pre>}</article>)}</div>}
  </details>;
}

function SettingsPanel({ settings, deployment, onSave }: { settings: Settings; deployment?: string; onSave: (s: Settings) => void }) { const [s, setS] = useState(settings); const field = (key: keyof Settings, value: string | number | boolean) => setS(v => ({ ...v, [key]: value })); return <section className="settings"><h2>Settings</h2><p className="eyebrow">GENERAL</p><label>Backend URL<input value={s.backendUrl} onChange={e => field('backendUrl', e.target.value)} /></label><p className="eyebrow">AI</p><p>Azure OpenAI &middot; GPT-5.4 mini</p><p>Deployment: {deployment || 'Not configured'}</p><p>Configure Azure credentials in the backend environment.</p><p className="eyebrow">AUTOMATION</p><label>Approval mode<select value={s.approvalMode} onChange={e => field('approvalMode', e.target.value)}><option value="always">Always allow actions</option><option value="auto">Ask for consequential actions</option><option value="manual">Manual</option></select></label><label className="toggle"><input type="checkbox" checked={s.visibleCursor} onChange={e => field('visibleCursor', e.target.checked)} />Show agent cursor and click indicators</label><label>Maximum steps<input type="number" value={s.maxSteps} onChange={e => field('maxSteps', Number(e.target.value))} /></label><p className="eyebrow">PRIVACY</p><div className="notice">Task memory is temporary. Task and page context is sent to your Azure OpenAI deployment. The API key stays in the backend environment.</div><p className="eyebrow">DEVELOPER</p><label>Log level<select value={s.logLevel} onChange={e => field('logLevel', e.target.value)}><option>error</option><option>warn</option><option>info</option><option>debug</option></select></label><button className="primary full" onClick={() => onSave(s)}>Save settings</button></section>; }

export { App };
const mount = document.getElementById('root');
if (mount) createRoot(mount).render(<React.StrictMode><App /></React.StrictMode>);
