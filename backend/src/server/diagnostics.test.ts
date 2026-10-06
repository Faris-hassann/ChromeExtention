import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { openRouterStatus } from '../llm/openrouter-status.js';

const servers: Array<ReturnType<ReturnType<typeof createApp>['app']['listen']>> = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); });

describe('diagnostic ingestion', () => {
  it('serves safe provider status and forwards explicit refresh requests', async () => {
    const status = { configured: true, credentialValidity: 'valid' as const, availability: 'unavailable' as const, quota: { used: 59, limit: 50, remaining: 0 }, reason: 'Daily free quota exhausted', checkedAt: new Date().toISOString() };
    const check = vi.spyOn(openRouterStatus, 'status').mockResolvedValue(status);
    const { app } = createApp(); const server = app.listen(0); servers.push(server);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/providers/openrouter/status?refresh=true`);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(status); expect(response.headers.get('cache-control')).toBe('no-store'); expect(check).toHaveBeenCalledWith(true);
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
