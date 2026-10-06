import { collectPage } from './collector';
import { installFrameGeometry } from './frame-geometry';
import { collectTableTargets, type TableSearch } from './table-targets';
import type { ElementInfo } from '../shared/types';

export class FrameRegistry {
  private tabs = new Map<number, Map<string, ElementInfo>>();
  remember(tabId: number, elements: ElementInfo[]) { this.tabs.set(tabId, new Map(elements.map(el => [el.elementId, el]))); }
  forget(tabId?: number) { if (tabId === undefined) this.tabs.clear(); else this.tabs.delete(tabId); }
  route(tabId: number, args: Record<string, any>) {
    const element = args.elementId ? this.tabs.get(tabId)?.get(args.elementId) : undefined;
    if (args.elementId && this.tabs.has(tabId) && !element) throw new Error('STALE_ELEMENT: Observe again; this target is no longer in the observation.');
    if (element && ((args.frameId !== undefined && String(args.frameId) !== element.frameId) || (args.documentId && args.documentId !== element.documentId))) throw new Error('STALE_DOCUMENT: Target frame or document does not match the observation.');
    return { ...args, ...(element ? { frameId: element.frameId, documentId: element.documentId, documentToken: element.documentToken } : {}) };
  }
}

export function scriptTarget(tabId: number, args: { frameId?: unknown; documentId?: unknown }) {
  if (typeof args.documentId === 'string') return { tabId, documentIds: [args.documentId] };
  if (args.frameId !== undefined) {
    const frameId = Number(args.frameId);
    if (!Number.isInteger(frameId) || frameId < 0) throw new Error('Invalid frame ID. Observe again.');
    return { tabId, frameIds: [frameId] };
  }
  return { tabId };
}

export async function collectFrames(tabId: number, query?: TableSearch) {
  const channel = crypto.randomUUID();
  const frames = await chrome.webNavigation.getAllFrames({ tabId }) ?? [];
  const collected = await Promise.all(frames.map(async frame => {
    try {
      await chrome.scripting.executeScript({ target: { tabId, frameIds: [frame.frameId] }, func: installFrameGeometry, args: [channel] });
      const [injection] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frame.frameId] }, func: collectPage });
      if (!injection?.result) throw new Error('Frame returned no observation.');
      const result = injection.result;
      const [tableInjection] = await chrome.scripting.executeScript({ target: { tabId, documentIds: [injection.documentId] }, func: collectTableTargets, args: [query ?? null] });
      const tableResult = tableInjection?.result;
      if (tableResult) {
        result.interactiveElements = [...new Map([...result.interactiveElements, ...tableResult.interactiveElements].map(el => [el.elementId, el])).values()] as typeof result.interactiveElements;
        result.tables = [...result.tables, ...tableResult.tables] as typeof result.tables;
      }
      // Chrome's document ID is authoritative for routing. The isolated-world token
      // is retained separately for helper readback checks.
      return { frame, result, documentId: injection.documentId, accessible: true as const };
    } catch (error) { return { frame, accessible: false as const, error: error instanceof Error ? error.message : String(error) }; }
  }));
  const main = collected.find(entry => entry.frame.frameId === 0);
  if (!main?.accessible) throw new Error(main?.error ?? 'The main page could not be read.');
  const readable = collected.filter(entry => entry.accessible);
  const contentFrames = main.result.powerBi ? [...readable].sort((a, b) => Number(b.result.interactiveElements.some(el => el.role === 'visual')) - Number(a.result.interactiveElements.some(el => el.role === 'visual'))) : readable;
  const interactiveElements = readable.flatMap(entry => entry.result.interactiveElements.map(el => ({ ...el, frameId: String(entry.frame.frameId), documentId: entry.documentId, documentToken: entry.result.documentId }))).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)).slice(0, 500);
  return {
    ...main.result,
    documentId: main.documentId,
    interactiveElements,
    semanticContent: contentFrames.map(entry => `[frame ${entry.frame.frameId}] ${entry.result.semanticContent}`).join('\n').slice(0, 24000),
    tables: readable.flatMap(entry => entry.result.tables), forms: readable.flatMap(entry => entry.result.forms),
    dialogs: readable.flatMap(entry => entry.result.dialogs), toasts: readable.flatMap(entry => entry.result.toasts),
    powerBi: main.result.powerBi ? { ...(readable.find(entry => entry.result.powerBi?.saveControlId)?.result.powerBi ?? main.result.powerBi), selectedVisualId: readable.find(entry => entry.result.powerBi?.selectedVisualId)?.result.powerBi?.selectedVisualId, saving: readable.some(entry => entry.result.powerBi?.saving), saveMessages: [...new Set(readable.flatMap(entry => [...entry.result.toasts, ...(entry.result.powerBi?.saveMessages ?? [])]))].filter(message => /sav(ed|ing|e)|couldn.t|failed|error/i.test(message)) } : undefined,
    frames: collected.map(entry => ({ frameId: String(entry.frame.frameId), parentFrameId: String(entry.frame.parentFrameId), url: entry.frame.url, documentId: entry.accessible ? entry.documentId : undefined, accessible: entry.accessible, ...(!entry.accessible ? { error: entry.error } : {}) })),
  };
}
