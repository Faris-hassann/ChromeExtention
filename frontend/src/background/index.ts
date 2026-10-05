import { collectPage, executeInPage } from './collector';
import type { Observation } from '../shared/types';
import { checkSiteAccess, siteAccessRequired, type SiteAccessRequired } from '../shared/site-access';
import { BUILD_VERSION } from '../shared/build-version';
import { InputController } from './input-controller';

function diagnostic(level: 'debug' | 'info' | 'warn' | 'error', event: string, details?: unknown) {
  const entry = { timestamp: new Date().toISOString(), level, source: 'background', event, details };
  const method = level === 'debug' ? 'debug' : level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'info';
  console[method](JSON.stringify(entry));
  void chrome.runtime.sendMessage({ type: 'BACKGROUND_DIAGNOSTIC', payload: entry }).catch(() => undefined);
}

chrome.runtime.onInstalled.addListener(() => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }));
chrome.action.onClicked.addListener(tab => { if (tab.windowId) chrome.sidePanel.open({ windowId: tab.windowId }); });
const input = new InputController();
chrome.debugger.onDetach.addListener(source => input.markDetached(source.tabId));
chrome.tabs.onRemoved.addListener(tabId => { void input.cleanup(tabId); });

let previousSummary = '';
async function activeTab(tabId?: number) { if (tabId) return chrome.tabs.get(tabId); const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (!tab?.id) throw new Error('No active browser tab'); return tab; }
async function waitForTab(tabId: number, timeoutMs = 30_000) {
  const current = await chrome.tabs.get(tabId); if (current.status === 'complete') return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error('Navigation timed out')); }, timeoutMs);
    const listener = (updatedId: number, change: { status?: string }) => { if (updatedId === tabId && change.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); } };
    chrome.tabs.onUpdated.addListener(listener);
  });
}
const containsOrigin = (origin: string) => chrome.permissions.contains({ origins: [origin] });
const isHostAccessError = (error: unknown) => /cannot access contents|manifest must request permission|missing host permission/i.test(error instanceof Error ? error.message : String(error));
async function redirectedAccessRequired(error: unknown, tabId?: number): Promise<SiteAccessRequired | undefined> {
  if (!isHostAccessError(error)) return undefined;
  return siteAccessRequired((await activeTab(tabId)).url);
}
async function observe(taskId: string, tabId?: number): Promise<Observation | SiteAccessRequired> {
  const tab = await activeTab(tabId);
  if (!tab.url?.startsWith('http')) throw new Error('This page cannot be automated. Open an http(s) website.');
  const accessRequired = await checkSiteAccess(tab.url, containsOrigin);
  if (accessRequired) return accessRequired;
  let result: ReturnType<typeof collectPage> | undefined;
  try {
    [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: collectPage });
  } catch (error) {
    const redirected = await redirectedAccessRequired(error, tab.id);
    if (redirected) return redirected;
    throw error;
  }
  if (!result) throw new Error('The page observation returned no data');
  const summary = JSON.stringify({ url: result.url, title: result.title, elements: result.interactiveElements.length, text: result.semanticContent.slice(0, 500) });
  const observation: Observation = { ...result, observationId: crypto.randomUUID(), taskId, timestamp: new Date().toISOString(), tabId: String(tab.id), diff: previousSummary && previousSummary !== summary ? { changed: true } : { changed: false } };
  previousSummary = summary; return observation;
}
async function runTool(tool: string, args: Record<string, any>, tabId?: number, visibleCursor = true) {
  const tab = await activeTab(tabId);
  if (tool === 'navigate') {
    const requestedUrl = new URL(String(args.url));
    if (!['http:', 'https:'].includes(requestedUrl.protocol)) throw new Error('Navigation requires an HTTP(S) URL');
    // Register before updating so a fast redirect cannot finish before the listener exists.
    const loaded = new Promise<void>((resolve, reject) => {
      const listener = (id: number, info: { status?: string }) => { if (id === tab.id && info.status === 'complete') { cleanup(); resolve(); } };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Navigation timed out')); }, 30000);
      const cleanup = () => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); };
      chrome.tabs.onUpdated.addListener(listener);
      void chrome.tabs.update(tab.id!, { url: requestedUrl.href }).catch(error => { cleanup(); reject(error); });
    });
    await loaded;
    const final = await chrome.tabs.get(tab.id!);
    diagnostic('info', 'navigation.completed', { requestedOrigin: requestedUrl.origin, finalOrigin: final.url ? new URL(final.url).origin : undefined, tabId: tab.id, buildVersion: BUILD_VERSION });
    return { ok: true, tabId: tab.id, finalUrl: final.url };
  }
  if (tool === 'go_back' || tool === 'go_forward') { await chrome.tabs[tool === 'go_back' ? 'goBack' : 'goForward'](tab.id!); await waitForTab(tab.id!); return { ok: true }; }
  if (tool === 'reload') { await chrome.tabs.reload(tab.id!); await waitForTab(tab.id!); return { ok: true }; }
  if (tool === 'open_tab') { const created = await chrome.tabs.create({ url: String(args.url ?? 'about:blank'), active: false }); return { ok: true, tabId: created.id }; }
  if (tool === 'list_tabs') { const tabs = await chrome.tabs.query({ currentWindow: true }); return { ok: true, tabs: tabs.map(t => ({ tabId: t.id, url: t.url, title: t.title, active: t.active })) }; }
  if (tool === 'switch_tab') { await chrome.tabs.update(Number(args.tabId), { active: true }); return { ok: true }; }
  if (tool === 'close_tab') { await chrome.tabs.remove(Number(args.tabId ?? tab.id)); return { ok: true }; }
  if (tool === 'take_screenshot') { return { ok: true, screenshotRef: await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 65 }) }; }
  const accessRequired = await checkSiteAccess(tab.url, containsOrigin);
  if (accessRequired) return accessRequired;
  if (tool === 'wait_for_element') {
    await new Promise(resolve => setTimeout(resolve, Math.min(5000, Math.max(100, Number(args.timeoutMs ?? 1000)))));
    if (args.elementId) {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: (id: string) => !!document.querySelector(`[data-local-agent-id="${CSS.escape(id)}"]`), args: [String(args.elementId)] });
      return result ? { ok: true } : { ok: false, code: 'ELEMENT_NOT_FOUND', error: 'Waited for the element; observe again.' };
    }
    return { ok: true, waited: true };
  }
  if (tool === 'observe_page' || tool.startsWith('read_') || tool === 'find_element') return { ok: true };
  if (args.frameId) return { ok: false, code: 'UNSUPPORTED_FRAME', error: 'Browser-level input currently supports only the top-level page and open shadow DOM.' };
  if (input.handles(tool)) {
    try { return await input.run(tab.id!, tool, args, visibleCursor); }
    catch (error) { const message = error instanceof Error ? error.message : String(error); return { ok: false, code: /cancelled/i.test(message) ? 'INPUT_CANCELLED' : 'INPUT_UNAVAILABLE', error: message, retryable: !/cancelled/i.test(message) }; }
  }
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: executeInPage, args: [tool, args] }); return result;
  } catch (error) {
    const redirected = await redirectedAccessRequired(error, tab.id);
    if (redirected) return redirected;
    // Enter may successfully navigate while its injected verification is awaiting.
    // Do not repeat submission: let the next observation verify the new page.
    if (tool === 'press_key' && args.key === 'Enter' && /context.*destroyed|frame.*removed|document.*unloaded/i.test(error instanceof Error ? error.message : String(error))) {
      await waitForTab(tab.id!);
      return { ok: true, needsVerification: true };
    }
    throw error;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'BACKGROUND_DIAGNOSTIC') return false;
  if (message.type === 'GET_VERSION') { sendResponse({ ok: true, buildVersion: BUILD_VERSION }); return false; }
  if (message.type === 'CLEANUP_INPUT') { void input.cleanup(message.tabId).then(() => sendResponse({ ok: true })); return true; }
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  const stage = message.type === 'OBSERVE' ? 'background.observe' : message.type === 'EXECUTE' ? `background.execute.${message.tool ?? 'unknown'}` : 'background.message';
  diagnostic('info', 'request.started', { requestId, stage, taskId: message.taskId, tool: message.tool, argumentKeys: Object.keys(message.arguments ?? {}) });
  (async () => {
    if (message.type === 'OBSERVE') return observe(message.taskId, message.tabId);
    if (message.type === 'EXECUTE') return runTool(message.tool, message.arguments ?? {}, message.tabId, message.visibleCursor !== false);
    throw new Error('Unknown extension request');
  })().then(result => {
    diagnostic('info', 'request.completed', { requestId, stage, durationMs: Math.round(performance.now() - startedAt), ok: !(result && typeof result === 'object' && 'ok' in result && result.ok === false) });
    sendResponse(result);
  }).catch(error => {
    const details = { timestamp: new Date().toISOString(), level: 'ERROR', source: 'background', event: 'request.failed', requestId, stage, durationMs: Math.round(performance.now() - startedAt), error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) } };
    diagnostic('error', 'request.failed', details);
    sendResponse({ ok: false, error: details.error.message, stage, requestId });
  });
  return true;
});
