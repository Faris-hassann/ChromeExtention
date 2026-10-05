import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSettings } from './settings';
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
});
