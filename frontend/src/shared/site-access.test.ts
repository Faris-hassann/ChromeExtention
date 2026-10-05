import { describe, expect, it, vi } from 'vitest';
import { checkSiteAccess, resolveSiteAccess, samePendingSiteAccess, siteAccessRequired, siteFromUrl, type PendingSiteAccess } from './site-access';

describe('site access', () => {
  it('uses an exact-origin, all-paths permission pattern', () => {
    expect(siteFromUrl('https://chatgpt.com/c/123?model=test')).toEqual({ origin: 'https://chatgpt.com/*', hostname: 'chatgpt.com' });
  });

  it('allows an origin that was already granted without prompting', async () => {
    const contains = vi.fn().mockResolvedValue(true);
    await expect(checkSiteAccess('https://www.google.com/', contains)).resolves.toBeUndefined();
    expect(contains).toHaveBeenCalledWith('https://www.google.com/*');
  });

  it('returns a structured, retryable response for a redirected landing origin', async () => {
    await expect(checkSiteAccess('https://chatgpt.com/', vi.fn().mockResolvedValue(false))).resolves.toEqual({
      ok: false,
      code: 'SITE_ACCESS_REQUIRED',
      error: 'Access to chatgpt.com is required to continue.',
      origin: 'https://chatgpt.com/*',
      hostname: 'chatgpt.com',
      retryable: true,
    });
  });

  it('rejects unsupported and malformed browser URLs as site permissions', () => {
    expect(siteAccessRequired('chrome://extensions/')).toBeUndefined();
    expect(siteAccessRequired('not a url')).toBeUndefined();
    expect(siteAccessRequired(undefined)).toBeUndefined();
  });

  it('grants the landing origin and retries the preserved request', async () => {
    const retry = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    const pending: PendingSiteAccess<string> = { taskId: 'task-1', origin: 'https://chatgpt.com/*', hostname: 'chatgpt.com', request: 'observe' };
    await expect(resolveSiteAccess(pending, { request: vi.fn().mockResolvedValue(true), retry, pause })).resolves.toBe('granted');
    expect(retry).toHaveBeenCalledWith('observe');
    expect(pause).not.toHaveBeenCalled();
  });

  it('pauses without retrying when the landing origin is denied', async () => {
    const retry = vi.fn();
    const pause = vi.fn();
    const pending: PendingSiteAccess<string> = { taskId: 'task-1', origin: 'https://chatgpt.com/*', hostname: 'chatgpt.com', request: 'observe' };
    await expect(resolveSiteAccess(pending, { request: vi.fn().mockResolvedValue(false), retry, pause })).resolves.toBe('denied');
    expect(pause).toHaveBeenCalledWith('task-1');
    expect(retry).not.toHaveBeenCalled();
  });

  it('deduplicates repeated access events for the same task and origin', () => {
    const current: PendingSiteAccess<string> = { taskId: 'task-1', origin: 'https://chatgpt.com/*', hostname: 'chatgpt.com', request: 'first' };
    expect(samePendingSiteAccess(current, { ...current, request: 'duplicate' })).toBe(true);
    expect(samePendingSiteAccess(current, { ...current, origin: 'https://example.com/*' })).toBe(false);
    expect(samePendingSiteAccess(current, { ...current, taskId: 'task-2' })).toBe(false);
  });
});
