import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectFrames, FrameRegistry, scriptTarget } from './frames';
import { InputController } from './input-controller';

afterEach(() => vi.unstubAllGlobals());
describe('frame discovery and action routing', () => {
  it('combines frame content, prioritizes editor controls and reports inaccessible frames', async () => {
    vi.stubGlobal('chrome', {
      webNavigation: { getAllFrames: async () => [0, 2, 3].map(frameId => ({ frameId, parentFrameId: frameId ? 0 : -1, url: `https://app.powerbi.com/frame/${frameId}` })) },
      scripting: { executeScript: async ({ target, func }: any) => {
        const frameId = target.frameIds?.[0] ?? Number(target.documentIds[0].replace('chrome-doc-', ''));
        if (frameId === 3) throw new Error('Missing host access');
        if (['installFrameGeometry', 'collectTableTargets'].includes(func.name)) return [];
        return [{ documentId: `chrome-doc-${frameId}`, result: { documentId: `token-${frameId}`, url: 'https://app.powerbi.com/', title: 'Report', loadingState: 'complete', semanticContent: `frame ${frameId}`, interactiveElements: [{ elementId: `el_${frameId}_001`, name: frameId ? 'Title' : 'Navigation', priority: frameId ? 4 : 1 }], tables: [], forms: [], dialogs: [], toasts: [], powerBi: { mode: 'edit', saveControlId: frameId ? 'el_2_001' : undefined, saveMessages: frameId ? ['Report saved'] : [] } } }];
      } },
    });
    const result = await collectFrames(7);
    expect(result.interactiveElements[0]).toMatchObject({ elementId: 'el_2_001', frameId: '2', documentId: 'chrome-doc-2', documentToken: 'token-2' });
    expect(result.semanticContent).toContain('frame 2');
    expect(result.frames.find(frame => frame.frameId === '3')).toMatchObject({ accessible: false, error: 'Missing host access' });
    expect(result.powerBi).toMatchObject({ saveControlId: 'el_2_001', saveMessages: ['Report saved'] });
  });
  it('routes from observed IDs, rejects stale or conflicting references and isolates tabs', () => {
    const registry = new FrameRegistry();
    registry.remember(7, [{ elementId: 'el_child_001', frameId: '2', documentId: 'document', documentToken: 'token' }]);
    expect(registry.route(7, { elementId: 'el_child_001', value: 'Revenue' })).toMatchObject({ frameId: '2', documentId: 'document', documentToken: 'token' });
    expect(() => registry.route(7, { elementId: 'el_child_001', frameId: '0' })).toThrow(/STALE_DOCUMENT/);
    expect(() => registry.route(7, { elementId: 'el_child_001', documentId: 'old' })).toThrow(/STALE_DOCUMENT/);
    registry.remember(7, [{ elementId: 'el_new_001' }]);
    expect(() => registry.route(7, { elementId: 'el_child_001' })).toThrow(/STALE_ELEMENT/);
    expect(registry.route(8, { elementId: 'el_child_001' })).not.toHaveProperty('documentId');
    expect(scriptTarget(7, { documentId: 'document', frameId: '2' })).toEqual({ tabId: 7, documentIds: ['document'] });
    expect(() => scriptTarget(7, { frameId: 'frame_2' })).toThrow();
  });
  it('injects resolution and readback into the same document and scrolls the specified pane', async () => {
    const executeScript = vi.fn(async ({ func }: any) => [{ result: func.name === 'resolveInputTarget' ? { ok: true, x: 200, y: 150, editable: true } : func.name === 'readInputTarget' ? { exists: true, value: 'Revenue' } : undefined }]);
    const command = vi.fn().mockResolvedValue({});
    vi.stubGlobal('chrome', { scripting: { executeScript }, debugger: { attach: vi.fn().mockResolvedValue(undefined) } });
    const input = new InputController(command);
    const args = { elementId: 'el_child_001', frameId: '2', documentId: 'document', documentToken: 'token', value: 'Revenue' };
    expect(await input.run(7, 'fill', args, false)).toMatchObject({ ok: true });
    for (const call of executeScript.mock.calls.map(call => call[0]).filter(call => ['resolveInputTarget', 'readInputTarget'].includes(call.func.name))) {
      expect(call.target).toEqual({ tabId: 7, documentIds: ['document'] }); expect(call.args).toEqual(['el_child_001', 'token']);
    }
    expect(await input.run(7, 'scroll', { ...args, direction: 'down', amount: 100 }, false)).toMatchObject({ ok: true });
    expect(command).toHaveBeenCalledWith({ tabId: 7 }, 'Input.dispatchMouseEvent', expect.objectContaining({ type: 'mouseWheel', x: 200, y: 150, deltaY: 100 }));
  });
  it('rejects stale documents before dispatching any mouse input', async () => {
    vi.stubGlobal('chrome', { scripting: { executeScript: async () => [{ result: { ok: false, code: 'STALE_DOCUMENT' } }] }, debugger: { attach: vi.fn().mockResolvedValue(undefined) } });
    const command = vi.fn(); const input = new InputController(command);
    expect(await input.run(7, 'click', { elementId: 'el_child', documentId: 'old' })).toMatchObject({ code: 'STALE_DOCUMENT' });
    expect(command).not.toHaveBeenCalled();
  });
});
