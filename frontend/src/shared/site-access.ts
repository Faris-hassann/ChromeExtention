export type Site = { origin: string; hostname: string };

export type SiteAccessRequired = {
  ok: false;
  code: 'SITE_ACCESS_REQUIRED';
  error: string;
  origin: string;
  hostname: string;
  retryable: true;
};

export type PendingSiteAccess<T = unknown> = Site & {
  taskId: string;
  request: T;
};

export function siteFromUrl(rawUrl?: string): Site | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return { origin: `${url.protocol}//${url.host}/*`, hostname: url.hostname };
  } catch {
    return undefined;
  }
}

export function siteAccessRequired(rawUrl?: string): SiteAccessRequired | undefined {
  const site = siteFromUrl(rawUrl);
  if (!site) return undefined;
  return {
    ok: false,
    code: 'SITE_ACCESS_REQUIRED',
    error: `Access to ${site.hostname} is required to continue.`,
    ...site,
    retryable: true,
  };
}

export async function checkSiteAccess(
  rawUrl: string | undefined,
  contains: (origin: string) => Promise<boolean>,
): Promise<SiteAccessRequired | undefined> {
  const required = siteAccessRequired(rawUrl);
  if (!required) return undefined;
  return await contains(required.origin) ? undefined : required;
}

export function samePendingSiteAccess<T>(current: PendingSiteAccess<T> | undefined, next: PendingSiteAccess<T>) {
  return current?.taskId === next.taskId && current.origin === next.origin;
}

export async function resolveSiteAccess<T>(
  pending: PendingSiteAccess<T>,
  dependencies: {
    request: (origin: string) => Promise<boolean>;
    retry: (request: T) => Promise<void>;
    pause: (taskId: string) => Promise<void> | void;
  },
): Promise<'granted' | 'denied'> {
  const granted = await dependencies.request(pending.origin);
  if (granted) {
    await dependencies.retry(pending.request);
    return 'granted';
  }
  await dependencies.pause(pending.taskId);
  return 'denied';
}
