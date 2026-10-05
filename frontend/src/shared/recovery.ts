import { siteAccessRequired, type SiteAccessRequired } from './site-access';
import { BUILD_VERSION } from './build-version';

export function workerMatches(response: { buildVersion?: string } | undefined) {
  return response?.buildVersion === BUILD_VERSION;
}

export async function recoverHostAccess(response: Record<string, any>, tabId?: number): Promise<SiteAccessRequired | undefined> {
  if (response.code === 'SITE_ACCESS_REQUIRED') return response as SiteAccessRequired;
  if (!/cannot access contents|manifest must request permission|missing host permission/i.test(String(response.error))) return undefined;
  const tab = tabId ? await chrome.tabs.get(tabId) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  return siteAccessRequired(tab?.url);
}

export class RetryGate {
  private busy = false;
  async run(action: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    try { await action(); } finally { this.busy = false; }
  }
}
