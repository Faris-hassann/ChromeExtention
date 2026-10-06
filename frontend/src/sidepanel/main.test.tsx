// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { BUILD_VERSION } from '../shared/build-version';
import { App } from './main';

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
async function message(msg: any) { await act(async () => { socket.onmessage?.({ data: JSON.stringify(msg) }); }); }
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
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/api/agent/tasks') ? { id: `task-${++taskCounter}`, state: 'WAITING_FOR_PAGE' } : { ollama: 'reachable', models: [], llmProvider: 'openrouter', openrouterConfigured: true } })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('side-panel recovery controls', () => {
  it('shows exhausted quota and refreshes availability without changing task controls', async () => {
    let quota = 0;
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url: any, init?: any) => {
      if (String(url).includes('/api/providers/openrouter/status')) return { ok: true, json: async () => ({ configured: true, credentialValidity: 'valid', availability: quota ? 'available' : 'unavailable', quota: { used: quota ? 40 : 59, limit: 50, remaining: quota }, reason: quota ? 'Free quota is available' : 'Daily free quota exhausted', checkedAt: new Date().toISOString(), nextRetryAt: quota ? undefined : '2026-10-07T00:00:00.000Z' }) } as any;
      return original(url, init);
    });
    render(<App/>);
    await screen.findByText('OpenRouter: unavailable');
    expect(screen.getByText(/59\/50 used; 0 remaining/)).toBeTruthy(); expect(screen.getByText(/Next retry:/)).toBeTruthy();
    quota = 10; fireEvent.click(screen.getByRole('button', { name: 'Refresh OpenRouter status' }));
    await screen.findByText('OpenRouter: available'); expect(screen.queryByText(/Next retry:/)).toBeNull();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('?refresh=true'), expect.anything());
    await startTask(); expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  });
  it('shows OpenRouter failures, local fallback and elapsed provider results', async () => {
    render(<App/>); await startTask();
    await message({ event: 'server.provider_progress', taskId: 'task-1', payload: { provider: 'openrouter', phase: 'failed', model: 'openrouter/free', message: 'OpenRouter HTTP 429 (Rate limit reached). Switching to local Qwen.', elapsedMs: 850, status: 429 } });
    expect(screen.getAllByText(/OpenRouter HTTP 429/).length).toBeGreaterThan(0);
    await message({ event: 'server.provider_progress', taskId: 'task-1', payload: { provider: 'ollama', phase: 'started', model: 'qwen2.5:7b', message: 'Using local Qwen (qwen2.5:7b).', step: 1 } });
    expect(screen.getAllByText(/qwen2.5:7b/).length).toBeGreaterThan(0);
    await message({ event: 'server.provider_progress', taskId: 'task-1', payload: { provider: 'ollama', phase: 'waiting', model: 'qwen2.5:7b', message: 'Local Qwen is still calculating the next action...', elapsedMs: 5000 } });
    expect(screen.getByText(/waiting · 5.0s/)).toBeTruthy();
    await message({ event: 'server.provider_progress', taskId: 'task-1', payload: { provider: 'ollama', phase: 'succeeded', model: 'qwen2.5:7b', message: 'Local Qwen succeeded (qwen2.5:7b).', elapsedMs: 6200 } });
    expect(screen.getAllByText(/Local Qwen succeeded/).length).toBeGreaterThan(0);
    const summary = screen.getByText(/Diagnostics \(/);
    expect(summary.closest('details')?.open).toBe(true);
    await message({ event: 'server.activity', taskId: 'task-1', payload: { message: 'After Click: Table cell selected in Process Name.' } });
    expect(screen.getAllByText(/Table cell selected/).length).toBeGreaterThan(0);
    await message({ event: 'server.provider_progress', taskId: 'unrelated-task', payload: { provider: 'openrouter', phase: 'failed', model: 'other', message: 'Unrelated failure' } });
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
