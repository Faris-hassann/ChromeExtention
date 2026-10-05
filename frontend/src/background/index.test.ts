import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { BUILD_VERSION } from '../shared/build-version';
import { recoverHostAccess, RetryGate, workerMatches } from '../shared/recovery';

let listener: any;
let chromeMock: any;
let updates: Set<any>;
const pageData = { url: 'https://chatgpt.com/', title: 'ChatGPT', loadingState: 'complete', interactiveElements: [], semanticContent: 'ready' };
async function request(message: any): Promise<any> {
  return new Promise(resolve => listener(message, {}, resolve));
}
beforeEach(async () => {
  vi.resetModules(); updates = new Set();
  const tab = { id: 7, url: 'https://chatgpt.com/', status: 'complete', windowId: 1 };
  chromeMock = {
    runtime: { onMessage: { addListener: vi.fn(fn => { listener = fn; }) }, onInstalled: { addListener: vi.fn() }, sendMessage: vi.fn().mockResolvedValue(undefined) },
    action: { onClicked: { addListener: vi.fn() } }, sidePanel: { setPanelBehavior: vi.fn() },
    tabs: { query: vi.fn().mockResolvedValue([tab]), get: vi.fn().mockResolvedValue(tab), onUpdated: { addListener: (fn: any) => updates.add(fn), removeListener: (fn: any) => updates.delete(fn) }, onRemoved: { addListener: vi.fn() }, update: vi.fn(async () => { for (const fn of updates) fn(7, { status: 'complete' }); return tab; }) },
    permissions: { contains: vi.fn().mockResolvedValue(true) }, scripting: { executeScript: vi.fn().mockResolvedValue([{ result: pageData }]) },
    debugger: { attach: vi.fn().mockResolvedValue(undefined), detach: vi.fn().mockResolvedValue(undefined), sendCommand: vi.fn().mockResolvedValue({}), onDetach: { addListener: vi.fn() } },
  };
  vi.stubGlobal('chrome', chromeMock);
  await import('./index');
});
afterEach(() => vi.unstubAllGlobals());

describe('real background handler and access recovery', () => {
  it('sends Enter once and requires observation instead of repeating submission', async () => {
    chromeMock.scripting.executeScript.mockImplementation(async ({ func }: any) => func.name === 'resolveInputTarget' ? [{ result: { ok: true, x: 20, y: 30 } }] : [{ result: undefined }]);
    expect(await request({ type: 'EXECUTE', tool: 'press_key', tabId: 7, arguments: { elementId: 'el_001', key: 'Enter' } })).toMatchObject({ ok: true, needsSubmissionVerification: true });
    const keys = chromeMock.debugger.sendCommand.mock.calls.filter((call: any[]) => call[1] === 'Input.dispatchKeyEvent');
    expect(keys.map((call: any[]) => call[2].type)).toEqual(['rawKeyDown', 'keyUp']);
  });
  it('returns the running worker version', async () => {
    expect(workerMatches(await request({ type: 'GET_VERSION' }))).toBe(true);
    expect(workerMatches({ buildVersion: 'old' })).toBe(false);
    expect(workerMatches({ buildVersion: BUILD_VERSION })).toBe(true);
  });
  it('observes a granted origin through the actual handler', async () => {
    expect(await request({ type: 'OBSERVE', taskId: 'task', tabId: 7 })).toMatchObject({ taskId: 'task', url: 'https://chatgpt.com/' });
    expect(chromeMock.permissions.contains).toHaveBeenCalledWith({ origins: ['https://chatgpt.com/*'] });
  });
  it('returns structured access and never injects before a landing-site grant', async () => {
    chromeMock.permissions.contains.mockResolvedValue(false);
    expect(await request({ type: 'OBSERVE', taskId: 'task', tabId: 7 })).toMatchObject({ code: 'SITE_ACCESS_REQUIRED', origin: 'https://chatgpt.com/*', retryable: true });
    expect(chromeMock.scripting.executeScript).not.toHaveBeenCalled();
    chromeMock.permissions.contains.mockResolvedValue(true);
    expect(await request({ type: 'OBSERVE', taskId: 'task', tabId: 7 })).toMatchObject({ taskId: 'task' });
  });
  it('handles Chrome permission errors when the grant changes during injection', async () => {
    chromeMock.scripting.executeScript.mockRejectedValue(new Error('Cannot access contents of url "https://chatgpt.com/". Extension manifest must request permission to access this host.'));
    expect(await request({ type: 'OBSERVE', taskId: 'task', tabId: 7 })).toMatchObject({ code: 'SITE_ACCESS_REQUIRED' });
  });
  it('waits through navigation and records the final redirect URL', async () => {
    expect(await request({ type: 'EXECUTE', tool: 'navigate', tabId: 7, arguments: { url: 'https://chat.openai.com/' } })).toMatchObject({ ok: true, finalUrl: 'https://chatgpt.com/', tabId: 7 });
    expect(updates.size).toBe(0);
  });
  it('resolves legacy errors against the failed tab rather than a newly active tab', async () => {
    chromeMock.tabs.query.mockResolvedValue([{ id: 8, url: 'https://unrelated.test/' }]);
    expect(await recoverHostAccess({ error: 'Cannot access contents of url' }, 7)).toMatchObject({ origin: 'https://chatgpt.com/*' });
    expect(chromeMock.tabs.query).not.toHaveBeenCalled();
  });
  it('rejects browser-internal pages', async () => {
    chromeMock.tabs.get.mockResolvedValue({ id: 7, url: 'chrome://extensions/' });
    expect(await request({ type: 'OBSERVE', taskId: 'task', tabId: 7 })).toMatchObject({ ok: false, error: expect.stringMatching(/cannot be automated/) });
  });
  it('prevents repeated grant clicks from executing twice', async () => {
    const gate = new RetryGate(); let resolve!: () => void;
    const action = vi.fn(() => new Promise<void>(r => { resolve = r; }));
    const first = gate.run(action); await gate.run(action); expect(action).toHaveBeenCalledTimes(1); resolve(); await first;
  });
});
