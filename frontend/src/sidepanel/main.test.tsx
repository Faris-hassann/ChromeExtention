// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { BUILD_VERSION } from '../shared/build-version';
import { App } from './main';
import { snapshot } from '../shared/metrics-fixture';

let socket: any;
let chromeMock: any;
let background: any;
let taskCounter: number;
class Socket {
  static OPEN = 1;
  readyState = 1;
  onopen?: () => void; onmessage?: (event: any) => void; onclose?: (event: any) => void;
  send = vi.fn(); close = vi.fn();
  constructor() { socket = this; queueMicrotask(() => this.onopen?.()); }
}
async function message(msg: any) { if (msg.event === 'server.action_request') { if (msg.payload.tool === 'observe_page') msg.requestId ??= crypto.randomUUID(); else msg.toolCallId ??= crypto.randomUUID(); } await act(async () => { socket.onmessage?.({ data: JSON.stringify(msg) }); }); }
async function startTask() {
  await waitFor(() => expect(screen.getByRole('button', { name: '↑' }).hasAttribute('disabled')).toBe(true));
  fireEvent.change(screen.getByPlaceholderText('Ask me to work in your browser…'), { target: { value: 'open ChatGPT and search the answer on Google' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '↑' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '↑' }));
  await waitFor(() => expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'OBSERVE' })));
}
beforeEach(() => {
  taskCounter = 0;
  background = { observationId: 'o', taskId: 'task-1', url: 'https://google.com/', title: 'Google', loadingState: 'complete', interactiveElements: [] };
  chromeMock = { runtime: { sendMessage: vi.fn(async (m: any) => m.type === 'GET_VERSION' ? { buildVersion: BUILD_VERSION } : background), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } }, permissions: { contains: vi.fn().mockResolvedValue(true), request: vi.fn().mockResolvedValue(true) }, tabs: { query: vi.fn().mockResolvedValue([{ id: 7, url: 'https://google.com/' }]), get: vi.fn().mockResolvedValue({ id: 7, url: 'https://chatgpt.com/' }), onActivated: { addListener: vi.fn(), removeListener: vi.fn() }, onUpdated: { addListener: vi.fn(), removeListener: vi.fn() } }, storage: { local: { get: vi.fn().mockResolvedValue({}) } } };
  vi.stubGlobal('chrome', chromeMock); vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/api/agent/tasks') ? { id: `task-${++taskCounter}`, state: 'WAITING_FOR_PAGE', observationRequestId: `initial-${taskCounter}` } : { configured: true, deployment: 'my-azure-mini', availability: 'unverified', reason: 'Configuration ready; access unverified.', checkedAt: new Date().toISOString(), llmProvider: 'azure', azureDeployment: 'my-azure-mini', azureConfigured: true } })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('side-panel execution guards', () => {
  const action = (id: string) => ({ event: 'server.action_request', taskId: 'task-1', toolCallId: id, payload: { tool: 'click', arguments: { elementId: 'el_001' } } });
  const executed = () => chromeMock.runtime.sendMessage.mock.calls.filter(([request]: any[]) => request.type === 'EXECUTE');
  const sent = (event: string) => socket.send.mock.calls.map(([raw]: string[]) => JSON.parse(raw)).filter((msg: any) => msg.event === event);

  it('executes duplicate action and observation requests only once and returns their IDs', async () => {
    render(<App/>); await startTask();
    expect(sent('client.observation')[0].requestId).toBe('initial-1');
    background = { ok: true };
    await message(action('once')); await message(action('once'));
    expect(executed()).toHaveLength(1);
    expect(sent('client.action_result')).toHaveLength(1);
    expect(sent('client.action_result')[0].toolCallId).toBe('once');
    background = { observationId: 'fresh', taskId: 'task-1' };
    const observationRequest = { event: 'server.action_request', taskId: 'task-1', requestId: 'observe-once', payload: { tool: 'observe_page' } };
    await message(observationRequest); await message(observationRequest);
    expect(sent('client.observation').filter((msg: any) => msg.requestId === 'observe-once')).toHaveLength(1);
  });

  it('serializes browser requests and drops queued work and late results after completion', async () => {
    render(<App/>); await startTask();
    let finish!: (result: any) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const original = chromeMock.runtime.sendMessage.getMockImplementation();
    chromeMock.runtime.sendMessage.mockImplementation((request: any) => request.type === 'EXECUTE' ? pending : original(request));
    await message(action('first')); await message(action('queued'));
    expect(executed()).toHaveLength(1);
    await message({ event: 'server.task_state', taskId: 'task-1', payload: { state: 'COMPLETED' } });
    await act(async () => { finish({ ok: true }); });
    await message(action('after-completion'));
    expect(executed()).toHaveLength(1);
    expect(sent('client.action_result')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    await message({ event: 'server.task_state', taskId: 'task-1', payload: { state: 'RUNNING' } });
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
  });

  it.each(['Pause', 'Stop'] as const)('drops queued actions and late results after %s', async control => {
    render(<App/>); await startTask();
    let finish!: (result: any) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const original = chromeMock.runtime.sendMessage.getMockImplementation();
    chromeMock.runtime.sendMessage.mockImplementation((request: any) => request.type === 'EXECUTE' ? pending : original(request));
    await message(action('first')); await message(action('queued'));
    fireEvent.click(screen.getByRole('button', { name: control }));
    await act(async () => { finish({ ok: true }); });
    expect(executed()).toHaveLength(1);
    expect(sent('client.action_result')).toHaveLength(0);
    await message({ event: 'server.task_state', taskId: 'task-1', payload: { state: 'RUNNING' } });
    await message(action('stale-after-control'));
    expect(executed()).toHaveLength(1);
  });

  it('drops pending results and queued actions after disconnection', async () => {
    render(<App/>); await startTask();
    let finish!: (result: any) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const original = chromeMock.runtime.sendMessage.getMockImplementation();
    chromeMock.runtime.sendMessage.mockImplementation((request: any) => request.type === 'EXECUTE' ? pending : original(request));
    await message(action('first')); await message(action('queued'));
    await act(async () => { socket.onclose({ code: 1006, wasClean: false }); finish({ ok: true }); });
    expect(executed()).toHaveLength(1);
    expect(sent('client.action_result')).toHaveLength(0);
  });

  it('prevents rapid duplicate task submissions', async () => {
    render(<App/>);
    fireEvent.change(screen.getByPlaceholderText('Ask me to work in your browser…'), { target: { value: 'Open example.com' } });
    const button = screen.getByRole('button', { name: '↑' });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    let grant!: (value: boolean) => void;
    chromeMock.permissions.contains.mockReturnValue(new Promise(resolve => { grant = resolve; }));
    fireEvent.click(button); fireEvent.click(button);
    await act(async () => { grant(true); });
    await waitFor(() => expect(taskCounter).toBe(1));
  });
});

describe('side-panel recovery controls', () => {
  it('tests Azure from the panel, suppresses duplicate clicks and displays the verified reply', async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    let finish!: (response: any) => void;
    const check = vi.fn().mockReturnValue(new Promise(resolve => { finish = resolve; }));
    vi.mocked(fetch).mockImplementation((url: any, init?: any) => String(url).endsWith('/api/providers/azure/test') ? check(url, init) : original(url, init));
    render(<App/>); await screen.findByText('Azure: Not connected'); fireEvent.click(screen.getByRole('button', {name:'Settings'})); await screen.findByText('Azure OpenAI: unverified');
    const button = screen.getByRole('button', { name: 'Test Azure connection' });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    expect(check).toHaveBeenCalledWith(expect.stringContaining('/api/providers/azure/test'), expect.objectContaining({ method: 'POST' }));
    expect(screen.getByRole('button', { name: 'Testing Azure…' }).hasAttribute('disabled')).toBe(true);
    await act(async () => { finish({ ok: true, json: async () => ({ status: { configured: true, deployment: 'my-azure-mini', availability: 'available', reason: 'Azure connection verified.' }, reply: 'Hi! How can I help?', elapsedMs: 1700 }) }); });
    await screen.findByText('Azure OpenAI: available');
    expect(screen.getByText('Azure reply: Hi! How can I help?')).toBeTruthy();
  });
  it('displays a failed Azure test without claiming verified access', async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url: any, init?: any) => String(url).endsWith('/api/providers/azure/test') ? { ok: false, json: async () => ({ error: 'Azure access was denied.', status: { configured: true, availability: 'unavailable', reason: 'Azure access was denied.' } }) } as any : original(url, init));
    render(<App/>); await screen.findByText('Azure: Not connected'); fireEvent.click(screen.getByRole('button', {name:'Settings'})); await screen.findByText('Azure OpenAI: unverified');
    fireEvent.click(screen.getByRole('button', { name: 'Test Azure connection' }));
    await screen.findByText('Azure OpenAI: unavailable');
    expect(screen.getByText('Azure access was denied.')).toBeTruthy(); expect(screen.getByText('Azure: Not connected')).toBeTruthy();
    expect(screen.queryByText(/Azure reply:/)).toBeNull();
  });
  it('blocks submission with missing Azure configuration and exposes no model or credential selectors', async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url: any, init?: any) => String(url).includes('/api/providers/azure/status') ? { ok: true, json: async () => ({ configured: false, availability: 'unconfigured', missing: ['Azure_openAI_API_KEY'], reason: 'Missing Azure_openAI_API_KEY. Add it to backend/.env.', checkedAt: new Date().toISOString() }) } as any : original(url, init));
    render(<App/>); await screen.findByText('Azure: Not connected');
    fireEvent.change(screen.getByPlaceholderText('Ask me to work in your browser…'), { target: { value: 'Open example.com' } });
    expect(screen.getByRole('button', { name: '↑' }).hasAttribute('disabled')).toBe(true);
    fireEvent.keyDown(screen.getByPlaceholderText('Ask me to work in your browser…'), { key: 'Enter' });
    expect(taskCounter).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByText(/Azure OpenAI.*GPT-5.4 mini/)).toBeTruthy();
    expect(screen.queryByLabelText('Main model')).toBeNull(); expect(screen.queryByLabelText('Vision model')).toBeNull();
    expect(screen.queryByRole('textbox', { name: /API key/i })).toBeNull();
  });
  it('shows configuration readiness without claiming Azure access is verified', async () => {
    render(<App/>); await screen.findByText('Azure: Not connected'); fireEvent.click(screen.getByRole('button', {name:'Settings'})); await screen.findByText('Azure OpenAI: unverified');
    expect(screen.getByText('Configuration ready; access unverified.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Azure status' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/providers/azure/status'), expect.anything()));
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('openrouter'))).toBe(false);
    fireEvent.click(screen.getByRole('button', {name:'Back to task'})); await startTask(); expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  });
  it('shows Azure failure, waiting and elapsed results without fallback', async () => {
    render(<App/>); await startTask();
    await message({ event: 'server.provider_progress', taskId: 'task-1', payload: { provider: 'azure', phase: 'failed', model: 'my-azure-mini', message: 'Azure rate limit reached.', elapsedMs: 850, status: 429 } });
    expect(screen.getAllByText(/Azure rate limit reached/).length).toBeGreaterThan(0);
    await message({ event: 'server.provider_progress', taskId: 'task-1', payload: { provider: 'azure', phase: 'waiting', model: 'my-azure-mini', message: 'Waiting for Azure OpenAI...', elapsedMs: 5000 } });
    expect(screen.queryByRole('region', {name:'Azure OpenAI status'})).toBeNull();
    await message({ event: 'server.provider_progress', taskId: 'task-1', payload: { provider: 'azure', phase: 'succeeded', model: 'my-azure-mini', message: 'Azure request succeeded.', elapsedMs: 6200 } });
    expect(screen.getAllByText(/Azure request succeeded/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('region', {name:'Diagnostics'})).toBeNull();
    await message({ event: 'server.activity', taskId: 'task-1', payload: { message: 'After Click: Table cell selected in Process Name.' } });
    expect(screen.getAllByText(/Table cell selected/).length).toBeGreaterThan(0);
    await message({ event: 'server.provider_progress', taskId: 'unrelated-task', payload: { provider: 'azure', phase: 'failed', model: 'other', message: 'Unrelated failure' } });
    expect(screen.queryByText('Unrelated failure')).toBeNull();
  });
  it('starts in always-allow mode without requesting an already-granted site', async () => {
    render(<App/>); await startTask();
    expect(chromeMock.permissions.request).not.toHaveBeenCalled();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining('/api/agent/tasks'), expect.objectContaining({ body: expect.stringContaining('"approvalMode":"always"') }));
  });
  it('sends recoverable stale-element failures through the existing action-result flow', async () => {
    render(<App/>); await startTask();
    background = { ok: false, code: 'STALE_ELEMENT', error: 'Observe again.' };
    await message({ event: 'server.action_request', taskId: 'task-1', toolCallId: 'call-1', payload: { tool: 'type', arguments: { elementId: 'el_001', value: 'news' } } });
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'EXECUTE', visibleCursor: true }));
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"code":"STALE_ELEMENT"'));
    expect(screen.queryByText(/Handling server.action_request:/)).toBeNull();
  });
  it('recovers legacy errors, preserves denial, and resumes from the grant button', async () => {
    render(<App/>); await startTask();
    background = { ok: false, error: 'Cannot access contents of url "https://chatgpt.com/". Extension manifest must request permission to access this host.' };
    await message({ event: 'server.action_request', taskId: 'task-1', payload: { tool: 'observe_page' } });
    await screen.findByRole('button', { name: 'Grant access & continue' });
    chromeMock.permissions.request.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Grant access & continue' }));
    await screen.findByText(/The task is paused/);
    expect(screen.getByRole('button', { name: 'Grant access & continue' })).toBeTruthy();
    background = { observationId: 'fresh', taskId: 'task-1', url: 'https://chatgpt.com/' };
    fireEvent.click(screen.getByRole('button', { name: 'Grant access & continue' }));
    await waitFor(() => expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"action":"resume"')));
    expect(chromeMock.permissions.request).toHaveBeenLastCalledWith({ origins: ['https://chatgpt.com/*'] });
    await message({ event: 'server.action_request', taskId: 'task-1', payload: { tool: 'observe_page' } });
    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"observationId":"fresh"'));
  });
  it('clears the preserved request on stop and blocks late retries', async () => {
    render(<App/>); await startTask();
    background = { ok: false, code: 'SITE_ACCESS_REQUIRED', origin: 'https://chatgpt.com/*', hostname: 'chatgpt.com', retryable: true };
    await message({ event: 'server.action_request', taskId: 'task-1', payload: { tool: 'observe_page' } });
    await screen.findByRole('button', { name: 'Grant access & continue' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Grant access & continue' })).toBeNull());
  });
  it('blocks starting tasks with an incompatible worker version', async () => {
    chromeMock.runtime.sendMessage.mockResolvedValue({ buildVersion: 'legacy' });
    render(<App/>);
    await screen.findByText(/Reload Local Browser Agent/);
    fireEvent.change(screen.getByPlaceholderText('Ask me to work in your browser…'), { target: { value: 'open ChatGPT' } });
    expect(screen.getByRole('button', { name: '↑' }).hasAttribute('disabled')).toBe(true);
  });
});


describe('task metrics transport', () => {
  it('shows greeting metrics separately without changing task totals or persisting metric snapshots', async () => {
    render(<App/>); await startTask();
    await message({ event: 'server.task_metrics', taskId: 'task-1', payload: snapshot() });
    const original = vi.mocked(fetch).getMockImplementation()!;
    const greeting = { ...snapshot(), taskId: null, requestCount: 5 };
    vi.mocked(fetch).mockImplementation((url: any, init?: any) => String(url).endsWith('/api/providers/azure/test') ? Promise.resolve({ ok: true, json: async () => ({ reply: 'Hi!', status: { configured: true, availability: 'available', reason: 'Verified' }, metrics: greeting }) } as Response) : original(url, init));
    fireEvent.click(screen.getByRole('button', {name:'Settings'})); fireEvent.click(screen.getByRole('button', { name: 'Test Azure connection' }));
    expect((await screen.findByRole('region', { name: 'Azure connection test metrics' })).textContent).toContain('LLM requests5');
    expect(screen.queryByRole('region', {name:'Task metrics'})).toBeNull(); fireEvent.click(screen.getByRole('button', {name:'Back to task'})); expect(screen.getByText(/Azure requests sent:/).textContent).toContain('1');
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/api/diagnostics/events')).every(([, init]) => !String(init?.body).includes('server.task_metrics'))).toBe(true);
  });
  it('keeps terminal metrics, accepts late settlement and ignores old or unrelated snapshots', async () => {
    render(<App/>); await startTask();
    const metrics = snapshot();
    await message({ event: 'server.task_metrics', taskId: 'task-1', payload: metrics });
    expect(screen.queryByRole('region', {name:'Task metrics'})).toBeNull(); expect(screen.getByText(/Azure requests sent:/).textContent).toContain('1');
    await message({ event: 'server.task_state', taskId: 'task-1', payload: { state: 'COMPLETED' } });
    await message({ event: 'server.task_metrics', taskId: 'task-1', payload: { ...metrics, revision: 3, requestCount: 2 } });
    expect(screen.getByRole('region', { name: 'Task metrics' }).textContent).toContain('LLM requests2');
    await message({ event: 'server.task_metrics', taskId: 'task-1', payload: metrics });
    await message({ event: 'server.task_metrics', taskId: 'other', payload: { ...metrics, taskId: 'other', revision: 100 } });
    expect(screen.getByRole('region', { name: 'Task metrics' }).textContent).toContain('LLM requests2');
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New task' } });
    fireEvent.click(screen.getByRole('button', { name: '↑' }));
    await waitFor(() => expect(taskCounter).toBe(2));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Task metrics' })).toBeNull());
  });
  it('accepts cancelled-task accounting after Stop', async () => {
    render(<App/>); await startTask(); fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await message({ event: 'server.task_metrics', taskId: 'task-1', payload: snapshot() });
    expect(screen.getByRole('region', { name: 'Task metrics' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
  });
  it('restores metrics on reconnect', async () => {
    render(<App/>); await startTask();
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation((url: any, init?: any) => String(url).endsWith('/task-1/metrics') ? Promise.resolve({ ok: true, json: async () => ({...snapshot(),state:'PAUSED',reason:{code:'DISCONNECTED',message:'Backend connection lost.'}}) } as Response) : original(url, init));
    await act(async () => { socket.onopen(); });
    await screen.findByRole('region', { name: 'Task metrics' });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/agent/tasks/task-1/metrics'));
  });
});


describe('panel views and interruption summaries', () => {
  it('shows disconnection and preserves a frontend input interruption through a generic backend pause',async()=>{
    render(<App/>);await startTask();await message({event:'server.task_metrics',taskId:'task-1',payload:snapshot()});
    background={ok:false,code:'INPUT_UNAVAILABLE',error:'Input is unavailable.'};
    await message({event:'server.action_request',taskId:'task-1',payload:{tool:'click',arguments:{elementId:'el_1'}}});
    await message({event:'server.task_state',taskId:'task-1',payload:{state:'PAUSED',reason:{code:'USER_PAUSE',message:'You paused this task.'}}});
    expect(screen.getByRole('article',{name:'Round summary'}).textContent).toContain('The browser cannot accept automated input.');
    fireEvent.click(screen.getByRole('button',{name:'Resume'}));
    await act(async()=>{socket.onclose({code:1006,wasClean:false});});
    expect(screen.getByRole('article',{name:'Round summary'}).textContent).toContain('The connection to the backend was lost.');
    expect(screen.getByText('Azure: Not connected')).toBeDefined();
  });
  it('does not let a delayed reconnect snapshot replace a newer completion',async()=>{
    render(<App/>);await startTask();const original=vi.mocked(fetch).getMockImplementation()!;
    let finish!: (response:any)=>void;
    vi.mocked(fetch).mockImplementation((url:any,init?:any)=>String(url).endsWith('/task-1/metrics')?new Promise(resolve=>{finish=resolve;}):original(url,init));
    await act(async()=>{socket.onopen();});
    await message({event:'server.task_state',taskId:'task-1',payload:{state:'COMPLETED',reason:{code:'GOAL_VERIFIED',message:'All requested work is verified.'}}});
    await act(async()=>{finish({ok:true,json:async()=>({...snapshot(),state:'RUNNING'})});});
    expect(screen.getByRole('article',{name:'Round summary'}).textContent).toContain('All requested work is verified.');
    expect(screen.queryByRole('button',{name:'Resume'})).toBeNull();
  });
  it('keeps executing while Diagnostics and Settings are open and preserves the conversation', async () => {
    render(<App/>); await startTask();
    expect(screen.queryByRole('button',{name:'Test Azure connection'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Diagnostics'}));
    expect(screen.getByRole('region',{name:'Diagnostics'})).toBeDefined();
    background={ok:true}; await message({event:'server.action_request',taskId:'task-1',toolCallId:'in-logs',payload:{tool:'click',arguments:{elementId:'el_1'}}});
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({type:'EXECUTE'}));
    fireEvent.click(screen.getByRole('button',{name:'Settings'})); expect(screen.queryByRole('region',{name:'Diagnostics'})).toBeNull();
    expect(screen.getByRole('button',{name:'Test Azure connection'})).toBeDefined();
    await message({event:'server.task_state',taskId:'task-1',payload:{state:'COMPLETED',reason:{code:'GOAL_VERIFIED',message:'The dashboard filter is verified.'}}});
    await message({event:'server.task_metrics',taskId:'task-1',payload:snapshot()});
    fireEvent.click(screen.getByRole('button',{name:'Back to task'}));
    expect(screen.getByRole('article',{name:'Round summary'}).textContent).toContain('The dashboard filter is verified.');
    expect(screen.getByText('open ChatGPT and search the answer on Google')).toBeDefined();
  });
  it('shows only the request counter while running and hides the summary on Resume',async()=>{
    render(<App/>); await startTask();await message({event:'server.task_metrics',taskId:'task-1',payload:snapshot()});
    expect(screen.getByText(/Azure requests sent:/).textContent).toContain('1');expect(screen.queryByRole('table',{name:'Task metrics'})).toBeNull();
    await message({event:'server.task_state',taskId:'task-1',payload:{state:'PAUSED',reason:{code:'NO_PROGRESS',message:'No visible progress.',nextAction:'Review the page.'}}});
    expect(screen.getByRole('article',{name:'Round summary'}).textContent).toContain('No visible progress.');
    fireEvent.click(screen.getByRole('button',{name:'Resume'}));
    expect(screen.queryByRole('article',{name:'Round summary'})).toBeNull();expect(screen.getByText(/Azure requests sent:/).textContent).toContain('1');
    await message({event:'server.task_state',taskId:'task-1',payload:{state:'PAUSED',reason:{code:'INPUT_REQUIRED',message:'Which process should I use?'}}});
    await message({event:'server.task_state',taskId:'task-1',payload:{state:'PAUSED',reason:{code:'INPUT_REQUIRED',message:'Which process should I use?'}}});
    expect(screen.getAllByRole('article',{name:'Round summary'})).toHaveLength(1);expect(screen.getByRole('article',{name:'Round summary'}).textContent).toContain('Which process should I use?');
  });
  it('shows metrics for approval and site access while keeping their action controls',async()=>{
    render(<App/>);await startTask();await message({event:'server.task_metrics',taskId:'task-1',payload:snapshot()});
    await message({event:'server.approval_request',taskId:'task-1',toolCallId:'approval',payload:{risk:'HIGH',actionSummary:'Submit form',site:'https://google.com'}});
    expect(screen.getByRole('article',{name:'Round summary'}).textContent).toContain('approval');expect(screen.getByRole('button',{name:'Approve once'})).toBeDefined();
    fireEvent.click(screen.getByRole('button',{name:'Stop'}));
    expect(screen.queryByRole('button',{name:'Approve once'})).toBeNull();expect(screen.getByRole('article',{name:'Round summary'}).textContent).toContain('You stopped this task.');
  });
  it('shows permission and disconnection explanations, and rejects stale reconnect state',async()=>{
    render(<App/>);await startTask();await message({event:'server.task_metrics',taskId:'task-1',payload:snapshot()});
    background={ok:false,code:'SITE_ACCESS_REQUIRED',origin:'https://chatgpt.com/*',hostname:'chatgpt.com',retryable:true};
    await message({event:'server.action_request',taskId:'task-1',payload:{tool:'observe_page'}});
    expect(screen.getByRole('article',{name:'Round summary'}).textContent).toContain('Website permission is needed');
    fireEvent.click(screen.getByRole('button',{name:'Stop'}));
    await message({event:'server.task_metrics',taskId:'task-1',payload:{...snapshot(),revision:3,state:'RUNNING'}});
    expect(screen.getByRole('article',{name:'Round summary'}).textContent).toContain('Task stopped');
    expect(screen.getByText('Azure: Not connected')).toBeDefined();
  });
  it('logs each actual request once without storing its usage in diagnostic events',async()=>{
    render(<App/>);await startTask();const metrics={...snapshot(),requests:[{requestId:'one',taskId:'task-1',outcome:'pending'}]};
    await message({event:'server.task_metrics',taskId:'task-1',payload:metrics});await message({event:'server.task_metrics',taskId:'task-1',payload:{...metrics,revision:3,requests:[{...metrics.requests[0],outcome:'succeeded'}]}});
    fireEvent.click(screen.getByRole('button',{name:'Diagnostics'}));expect(screen.getAllByText('Request sent to Azure')).toHaveLength(1);
    expect(chromeMock.storage.local.get).toHaveBeenCalled();expect(chromeMock.storage.local.set).toBeUndefined();
  });
});
