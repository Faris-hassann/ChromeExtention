import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSettings, saveSettings } from './settings';
afterEach(() => vi.unstubAllGlobals());
describe('approval settings', () => {
  it.each([
    [{}, 'always'],
    [{ approvalMode: 'auto' }, 'always'],
    [{ approvalMode: 'manual' }, 'manual'],
    [{ approvalMode: 'auto', approvalPolicyVersion: 2 }, 'auto'],
  ])('loads or migrates approval mode correctly', async (settings, expected) => {
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn().mockResolvedValue({ settings }) } } });
    expect((await loadSettings()).approvalMode).toBe(expected);
  });
  it('enables the visible cursor by default and preserves an explicit opt-out', async () => {
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ settings: { visibleCursor: false } }) } } });
    expect((await loadSettings()).visibleCursor).toBe(true);
    expect((await loadSettings()).visibleCursor).toBe(false);
  });
  it('drops obsolete model settings and credentials when loading and saving', async () => {
    const saved = { mainModel: 'old-model', visionModel: 'old-vision', ollamaUrl: 'http://localhost:11434', Azure_openAI_API_KEY: 'private-key', backendUrl: 'http://127.0.0.1:4444', visibleCursor: false };
    const set = vi.fn();
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn().mockResolvedValue({ settings: saved }), set } } });
    const settings = await loadSettings();
    expect(settings).toMatchObject({ backendUrl: 'http://127.0.0.1:4444', visibleCursor: false });
    expect(settings).not.toHaveProperty('mainModel'); expect(settings).not.toHaveProperty('Azure_openAI_API_KEY');
    await saveSettings({ ...settings, ...saved } as any);
    expect(JSON.stringify(set.mock.calls)).not.toContain('private-key');
    expect(set.mock.calls[0]![0].settings).not.toHaveProperty('ollamaUrl');
  });
});
