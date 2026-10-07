import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { config } from '../config.js';

const servers: Array<ReturnType<ReturnType<typeof createApp>['app']['listen']>> = [];
const originalConfig = { ...config };
beforeEach(() => { Object.assign(config, { azureEndpoint: 'https://resource.openai.azure.com/', azureApiKey: 'private-api-key', azureDeployment: 'deployed-mini', azureApiVersion: '2025-04-01-preview' }); });
afterEach(async () => { Object.assign(config, originalConfig); vi.restoreAllMocks(); await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); });

describe('diagnostic ingestion', () => {
  it('verifies access with one greeting and updates the running backend status', async () => {
    const { app } = createApp(); const server = app.listen(0); servers.push(server);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const originalFetch = globalThis.fetch;
    const azureCalls = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'Hi!' } }] })));
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => String(url).startsWith('https://resource.openai.azure.com') ? azureCalls(url, init) : originalFetch(url, init));
    expect((await (await fetch(`${base}/api/providers/azure/status`)).json()).availability).toBe('unverified');
    const response = await fetch(`${base}/api/providers/azure/test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const body = await response.json();
    expect(response.status).toBe(200); expect(body).toMatchObject({ reply: 'Hi!', status: { availability: 'available', lastRequest: { outcome: 'succeeded' } } });
    expect(JSON.stringify(body)).not.toContain('private-api-key');
    expect((await (await fetch(`${base}/api/providers/azure/status`)).json()).availability).toBe('available');
    expect(azureCalls).toHaveBeenCalledTimes(1);
    expect(JSON.parse(azureCalls.mock.calls[0]![1].body).messages).toEqual([{ role: 'user', content: 'hi' }]);
  });
  it('reports a failed connection test in status without retrying', async () => {
    const { app } = createApp(); const server = app.listen(0); servers.push(server);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const originalFetch = globalThis.fetch;
    const azureCalls = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'Unauthorized', message: 'private-api-key' } }), { status: 401 }));
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => String(url).startsWith('https://resource.openai.azure.com') ? azureCalls(url, init) : originalFetch(url, init));
    const response = await fetch(`${base}/api/providers/azure/test`, { method: 'POST' });
    const body = await response.json();
    expect(response.status).toBe(502); expect(body).toMatchObject({ code: 'AUTHENTICATION', status: { availability: 'unavailable' } });
    expect(JSON.stringify(body)).not.toContain('private-api-key'); expect(azureCalls).toHaveBeenCalledTimes(1);
  });
  it('serves safe Azure status without making inference or discovery requests', async () => {
    const { app } = createApp(); const server = app.listen(0); servers.push(server);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await fetch(`${base}/api/providers/azure/status`);
    const status = await response.json();
    expect(response.status).toBe(200); expect(status).toMatchObject({ configured: true, availability: 'unverified', deployment: 'deployed-mini' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    for (const path of ['/health', '/api/models', '/api/settings/runtime']) {
      const data = await (await fetch(`${base}${path}`)).json();
      expect(JSON.stringify(data)).not.toContain('private-api-key');
      expect(JSON.stringify(data)).not.toMatch(/openrouter|ollama/i);
    }
    expect(JSON.stringify(status)).not.toContain('private-api-key');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect((await fetch(`${base}/api/providers/openrouter/status`)).status).toBe(404);
  });
  it('keeps health available but rejects tasks when Azure settings are missing', async () => {
    config.azureApiKey = ''; config.azureApiVersion = '';
    const { app } = createApp(); const server = app.listen(0); servers.push(server);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await fetch(`${base}/health`)).status).toBe(200);
    const response = await fetch(`${base}/api/agent/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'Open example.com' }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'AZURE_CONFIGURATION', missing: ['Azure_openAI_API_KEY', 'azure_openai_API_version'] });
  });
  it('creates a configured task and fails once on Azure error without dispatch or replay', async () => {
    const instance = createApp(); const server = instance.app.listen(0); servers.push(server);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const task = await (await fetch(`${base}/api/agent/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'Open example.com', approvalMode: 'always' }) })).json();
    const originalFetch = globalThis.fetch;
    const azureCalls = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'Unauthorized', message: 'private-api-key' } }), { status: 401 }));
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => String(url).startsWith('https://resource.openai.azure.com') ? azureCalls(url, init) : originalFetch(url, init));
    const observation = { observationId: 'fresh', taskId: task.id, timestamp: '', tabId: '1', url: 'https://example.com/', title: 'Example', loadingState: 'complete' as const, interactiveElements: [] };
    await instance.orchestrator.observe(task.id, observation, task.observationRequestId);
    await instance.orchestrator.observe(task.id, observation, task.observationRequestId);
    expect(instance.orchestrator.tasks.get(task.id)?.state).toBe('FAILED');
    expect(azureCalls).toHaveBeenCalledTimes(1);
    const status = await (await fetch(`${base}/api/providers/azure/status`)).json();
    expect(status).toMatchObject({ availability: 'unavailable', lastRequest: { outcome: 'failed', code: 'AUTHENTICATION' } });
    expect(JSON.stringify(status)).not.toContain('private-api-key');
  });
  it('accepts a bounded valid batch and rejects invalid batches', async () => {
    const { app } = createApp(); const server = app.listen(0); servers.push(server);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port; const url = `http://127.0.0.1:${port}/api/diagnostics/events`;
    const valid = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: [{ timestamp: new Date().toISOString(), level: 'error', source: 'sidepanel', event: 'test.failed', details: { password: 'hidden' } }] }) });
    expect(valid.status).toBe(200); expect(await valid.json()).toEqual({ ok: true, accepted: 1 });
    const invalid = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: Array.from({ length: 101 }, () => ({ timestamp: 'now', level: 'info', source: 'sidepanel', event: 'too-many' })) }) });
    expect(invalid.status).toBe(400); expect(await invalid.json()).toMatchObject({ stage: 'http.diagnostics.validation' });
    const oversized = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: [{ timestamp: 'now', level: 'info', source: 'sidepanel', event: 'too-large', details: { text: 'x'.repeat(130 * 1024) } }] }) });
    expect(oversized.status).toBe(413); expect(await oversized.json()).toMatchObject({ stage: 'http.diagnostics.size' });
  });
});
