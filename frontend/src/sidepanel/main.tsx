import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Envelope, Settings } from '../shared/types';
import { defaults } from '../shared/types';
import { loadSettings, saveSettings } from '../storage/settings';
import './styles.css';

type Activity = { id: string; kind: 'user' | 'agent' | 'system' | 'error'; text: string; detail?: unknown };
type Approval = { site: string; risk: string; actionSummary: string; arguments?: unknown; toolCallId?: string };

function App() {
  const [settings, setSettings] = useState<Settings>(defaults); const [showSettings, setShowSettings] = useState(false);
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'disconnected'>('connecting'); const [ollama, setOllama] = useState<'checking' | 'reachable' | 'unavailable'>('checking');
  const [models, setModels] = useState<string[]>([]); const [goal, setGoal] = useState(''); const [taskId, setTaskId] = useState<string>(); const [taskState, setTaskState] = useState('IDLE');
  const [activities, setActivities] = useState<Activity[]>([{ id: crypto.randomUUID(), kind: 'agent', text: 'I’m ready. Tell me what you want to do in your browser.' }]); const [approval, setApproval] = useState<Approval>();
  const [screenshot, setScreenshot] = useState<string>(); const [showShot, setShowShot] = useState(false); const wsRef = useRef<WebSocket | undefined>(undefined); const taskRef = useRef<string | undefined>(undefined);
  const add = (kind: Activity['kind'], text: string, detail?: unknown) => setActivities(list => [...list, { id: crypto.randomUUID(), kind, text, detail }]);
  useEffect(() => { loadSettings().then(setSettings); }, []);
  useEffect(() => { taskRef.current = taskId; }, [taskId]);
  useEffect(() => { let reconnect: number; let stopped = false; const connect = () => { setConnection('connecting'); const socket = new WebSocket(settings.backendUrl.replace(/^http/, 'ws') + '/ws'); wsRef.current = socket; socket.onopen = () => setConnection('connected'); socket.onclose = () => { setConnection('disconnected'); if (taskRef.current) setTaskState('PAUSED'); if (!stopped) reconnect = window.setTimeout(connect, 2000); }; socket.onerror = () => socket.close(); socket.onmessage = e => handle(JSON.parse(e.data)); }; connect(); return () => { stopped = true; clearTimeout(reconnect); wsRef.current?.close(); };
    async function handle(msg: Envelope) {
      if (msg.event === 'server.task_state') setTaskState(msg.payload.state);
      if (msg.event === 'server.activity' && msg.payload.message !== 'Connected to local agent.') add('agent', msg.payload.message, msg.payload.detail);
      if (msg.event === 'server.error') add('error', msg.payload.message);
      if (msg.event === 'server.approval_request') setApproval({ ...msg.payload, toolCallId: msg.toolCallId });
      if (msg.event === 'server.action_request' && msg.taskId) {
        if (msg.payload.tool === 'observe_page') { const obs = await chrome.runtime.sendMessage({ type: 'OBSERVE', taskId: msg.taskId }); wsRef.current?.send(JSON.stringify({ event: 'client.observation', taskId: msg.taskId, payload: obs })); return; }
        const result = await chrome.runtime.sendMessage({ type: 'EXECUTE', tool: msg.payload.tool, arguments: msg.payload.arguments }); if (result.screenshotRef) { setScreenshot(result.screenshotRef); setShowShot(true); }
        wsRef.current?.send(JSON.stringify({ event: 'client.action_result', taskId: msg.taskId, toolCallId: msg.toolCallId, payload: result }));
      }
    }
  }, [settings.backendUrl]);
  useEffect(() => { fetch(`${settings.backendUrl}/health`).then(r => r.json()).then(data => { setOllama(data.ollama === 'reachable' ? 'reachable' : 'unavailable'); setModels(data.models ?? []); }).catch(() => setOllama('unavailable')); }, [settings.backendUrl]);
  const send = async () => { const text = goal.trim(); if (!text || connection !== 'connected') return; try { const permission = await chrome.runtime.sendMessage({ type: 'REQUEST_SITE_ACCESS' }); if (!permission.granted) { add('error', 'Site access was not granted. I can’t inspect or control this page.'); return; } add('user', text); setGoal(''); const response = await fetch(`${settings.backendUrl}/api/agent/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: text }) }); const task = await response.json(); if (!response.ok) throw new Error(task.error); setTaskId(task.id); setTaskState(task.state); const obs = await chrome.runtime.sendMessage({ type: 'OBSERVE', taskId: task.id }); wsRef.current?.send(JSON.stringify({ event: 'client.observation', taskId: task.id, payload: obs })); } catch (error) { add('error', error instanceof Error ? error.message : String(error)); } };
  const control = (action: string) => { if (!taskId) return; wsRef.current?.send(JSON.stringify({ event: 'client.user_control', taskId, payload: { action } })); if (action === 'approve' || action === 'deny') setApproval(undefined); };
  const statusText = useMemo(() => taskState.replaceAll('_', ' ').toLowerCase(), [taskState]);
  return <main className="shell">
    <header><div className="brand"><span className="mark">L</span><div><strong>Local Agent</strong><small>Qwen · private on-device</small></div></div><button className="icon" onClick={() => setShowSettings(!showSettings)} aria-label="Settings">⚙</button></header>
    <section className="statusbar"><span className={`dot ${connection}`}/><span>{connection}</span><span className="divider"/><span className={`dot ${ollama}`}/><span>Ollama {ollama}</span>{taskId && <><span className="divider"/><span>{statusText}</span></>}</section>
    {showSettings ? <SettingsPanel settings={settings} models={models} onSave={async s => { await saveSettings(s); setSettings(s); setShowSettings(false); }} /> : <>
      <section className="conversation">{activities.map(item => <article key={item.id} className={`message ${item.kind}`}><div>{item.text}</div>{item.detail != null && <details><summary>Technical details</summary><pre>{JSON.stringify(item.detail, null, 2)}</pre></details>}</article>)}
        {approval && <article className="approval"><div className="risk">{approval.risk} RISK · APPROVAL NEEDED</div><h3>{approval.actionSummary}</h3><p>{approval.site}</p>{approval.arguments != null && <pre>{JSON.stringify(approval.arguments, null, 2)}</pre>}<div className="row"><button className="primary" onClick={() => control('approve')}>Approve once</button><button onClick={() => control('deny')}>Deny</button></div></article>}
        {screenshot && <section className="shot"><button onClick={() => setShowShot(!showShot)}>Latest screenshot {showShot ? '▴' : '▾'}</button>{showShot && <img src={screenshot} alt="Latest ephemeral browser screenshot"/>}</section>}
      </section>
      {taskId && <nav className="controls"><button onClick={() => control('pause')}>Pause</button><button onClick={() => control('resume')}>Resume</button><button onClick={() => control('take_control')}>Take control</button><button className="danger" onClick={() => control('stop')}>Stop</button></nav>}
      <footer><div className="composer"><textarea value={goal} onChange={e => setGoal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder="Ask me to work in your browser…" rows={2}/><button className="send" onClick={send} disabled={!goal.trim() || connection !== 'connected'}>↑</button></div><small>Browser data stays ephemeral. Consequential actions require approval.</small></footer>
    </>}
  </main>;
}

function SettingsPanel({ settings, models, onSave }: { settings: Settings; models: string[]; onSave: (s: Settings) => void }) { const [s, setS] = useState(settings); const field = (key: keyof Settings, value: string | number) => setS(v => ({ ...v, [key]: value })); return <section className="settings"><h2>Settings</h2><p className="eyebrow">GENERAL</p><label>Backend URL<input value={s.backendUrl} onChange={e => field('backendUrl', e.target.value)}/></label><p className="eyebrow">AI</p><label>Main model<select value={s.mainModel} onChange={e => field('mainModel', e.target.value)}>{models.length ? models.map(m => <option key={m}>{m}</option>) : <option>{s.mainModel}</option>}</select></label><label>Vision model<select value={s.visionModel} onChange={e => field('visionModel', e.target.value)}><option value="">Not configured</option>{models.map(m => <option key={m}>{m}</option>)}</select></label><p className="eyebrow">AUTOMATION</p><label>Approval mode<select value={s.approvalMode} onChange={e => field('approvalMode', e.target.value)}><option value="auto">Auto normal actions</option><option value="manual">Manual</option></select></label><label>Maximum steps<input type="number" value={s.maxSteps} onChange={e => field('maxSteps', Number(e.target.value))}/></label><p className="eyebrow">PRIVACY</p><div className="notice">Chat, page content, screenshots, and task memory are never saved as history.</div><p className="eyebrow">DEVELOPER</p><label>Log level<select value={s.logLevel} onChange={e => field('logLevel', e.target.value)}><option>error</option><option>warn</option><option>info</option><option>debug</option></select></label><button className="primary full" onClick={() => onSave(s)}>Save settings</button></section>; }

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
