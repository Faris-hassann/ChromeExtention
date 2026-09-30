import { collectPage, executeInPage } from './collector';
import type { Observation } from '../shared/types';

chrome.runtime.onInstalled.addListener(() => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }));
chrome.action.onClicked.addListener(tab => { if (tab.windowId) chrome.sidePanel.open({ windowId: tab.windowId }); });

let previousSummary = '';
async function activeTab() { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (!tab?.id) throw new Error('No active browser tab'); return tab; }
async function waitForTab(tabId: number, timeoutMs = 30_000) {
  const current = await chrome.tabs.get(tabId); if (current.status === 'complete') return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error('Navigation timed out')); }, timeoutMs);
    const listener = (updatedId: number, change: { status?: string }) => { if (updatedId === tabId && change.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); } };
    chrome.tabs.onUpdated.addListener(listener);
  });
}
async function observe(taskId: string): Promise<Observation> {
  const tab = await activeTab();
  if (!tab.url?.startsWith('http')) throw new Error('This page cannot be automated. Open an http(s) website.');
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: collectPage });
  if (!result) throw new Error('The page observation returned no data');
  const summary = JSON.stringify({ url: result.url, title: result.title, elements: result.interactiveElements.length, text: result.semanticContent.slice(0, 500) });
  const observation: Observation = { ...result, observationId: crypto.randomUUID(), taskId, timestamp: new Date().toISOString(), tabId: String(tab.id), diff: previousSummary && previousSummary !== summary ? { changed: true } : { changed: false } };
  previousSummary = summary; return observation;
}
async function runTool(tool: string, args: Record<string, any>) {
  const tab = await activeTab();
  if (tool === 'navigate') { await chrome.tabs.update(tab.id!, { url: String(args.url) }); await waitForTab(tab.id!); return { ok: true }; }
  if (tool === 'go_back' || tool === 'go_forward') { await chrome.tabs[tool === 'go_back' ? 'goBack' : 'goForward'](tab.id!); await waitForTab(tab.id!); return { ok: true }; }
  if (tool === 'reload') { await chrome.tabs.reload(tab.id!); await waitForTab(tab.id!); return { ok: true }; }
  if (tool === 'open_tab') { const created = await chrome.tabs.create({ url: String(args.url ?? 'about:blank'), active: false }); return { ok: true, tabId: created.id }; }
  if (tool === 'list_tabs') { const tabs = await chrome.tabs.query({ currentWindow: true }); return { ok: true, tabs: tabs.map(t => ({ tabId: t.id, url: t.url, title: t.title, active: t.active })) }; }
  if (tool === 'switch_tab') { await chrome.tabs.update(Number(args.tabId), { active: true }); return { ok: true }; }
  if (tool === 'close_tab') { await chrome.tabs.remove(Number(args.tabId ?? tab.id)); return { ok: true }; }
  if (tool === 'take_screenshot') { return { ok: true, screenshotRef: await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 65 }) }; }
  if (tool === 'observe_page' || tool.startsWith('read_') || tool === 'find_element' || tool === 'wait_for_element') return { ok: true };
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: executeInPage, args: [tool, args] }); return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === 'REQUEST_SITE_ACCESS') { const tab = await activeTab(); const url = new URL(tab.url!); const origin = `${url.protocol}//${url.host}/*`; const granted = await chrome.permissions.request({ origins: [origin] }); return { granted, origin }; }
    if (message.type === 'OBSERVE') return observe(message.taskId);
    if (message.type === 'EXECUTE') return runTool(message.tool, message.arguments ?? {});
    throw new Error('Unknown extension request');
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
