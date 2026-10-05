import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { InputController } from './input-controller';

let currentValue = '';
let currentChecked = false;
let commands: Array<{ method: string; params: any }>;

beforeEach(() => {
  currentValue = ''; currentChecked = false; commands = [];
  vi.stubGlobal('chrome', {
    debugger: { attach: vi.fn().mockResolvedValue(undefined), detach: vi.fn().mockResolvedValue(undefined), sendCommand: vi.fn() },
    scripting: { executeScript: vi.fn(async ({ func }: any) => {
      if (func.name === 'resolveInputTarget') return [{ result: { ok: true, x: 120, y: 80, editable: true, value: currentValue, checked: currentChecked } }];
      if (func.name === 'readInputTarget') return [{ result: { exists: true, value: currentValue, checked: currentChecked, selected: currentValue } }];
      return [{ result: undefined }];
    }) },
  });
});
afterEach(() => vi.unstubAllGlobals());

function controller() {
  return new InputController(async (_target, method, params: any = {}) => {
    commands.push({ method, params });
    if (method === 'Input.insertText') currentValue += params.text;
    if (method === 'Input.dispatchKeyEvent' && params.type === 'rawKeyDown' && params.key === 'Backspace') currentValue = '';
    if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') currentChecked = !currentChecked;
    return {};
  });
}

describe('browser-level input controller', () => {
  it('moves, clicks, and renders a non-interactive overlay through the page helper', async () => {
    const input = controller();
    expect(await input.run(7, 'click', { elementId: 'el_001' })).toMatchObject({ ok: true });
    expect(commands.filter(c => c.method === 'Input.dispatchMouseEvent').map(c => c.params.type)).toEqual([...Array(10).fill('mouseMoved'), 'mousePressed', 'mouseReleased']);
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({ args: [120, 80, true, true, false] }));
  });

  it('types short Unicode text progressively after clearing the field', async () => {
    currentValue = 'old'; const input = controller();
    expect(await input.run(7, 'type', { elementId: 'el_001', value: 'A🙂' })).toMatchObject({ ok: true });
    expect(commands.filter(c => c.method === 'Input.insertText').map(c => c.params.text)).toEqual(['A', '🙂']);
    expect(currentValue).toBe('A🙂');
  });

  it('inserts long transferred text in one exact command', async () => {
    const input = controller(); const value = 'x'.repeat(201);
    expect(await input.run(7, 'paste_text', { elementId: 'el_001', value })).toMatchObject({ ok: true });
    expect(commands.filter(c => c.method === 'Input.insertText')).toEqual([{ method: 'Input.insertText', params: { text: value } }]);
  });

  it('supports modifier combinations and never repeats Enter', async () => {
    const input = controller();
    expect(await input.run(7, 'press_key', { elementId: 'el_001', key: 'Control+Enter' })).toMatchObject({ ok: true });
    const keys = commands.filter(c => c.method === 'Input.dispatchKeyEvent');
    expect(keys).toHaveLength(2); expect(keys[0].params).toMatchObject({ type: 'rawKeyDown', key: 'Enter', modifiers: 2 });
  });

  it('serializes actions and attaches to a tab only once', async () => {
    const input = controller();
    await Promise.all([input.run(7, 'hover', { elementId: 'el_001' }), input.run(7, 'hover', { elementId: 'el_001' })]);
    expect(chrome.debugger.attach).toHaveBeenCalledTimes(1);
  });

  it('detaches, removes overlays, and releases held input on cleanup', async () => {
    const input = controller(); await input.run(7, 'hover', { elementId: 'el_001' }); await input.cleanup(7);
    expect(chrome.debugger.detach).toHaveBeenCalledWith({ tabId: 7 });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({ args: [undefined, undefined, false, false, true] }));
    expect(commands.some(c => c.method === 'Input.dispatchKeyEvent' && c.params.type === 'keyUp')).toBe(true);
  });

  it('returns an actionable error when another debugger owns the tab', async () => {
    vi.mocked(chrome.debugger.attach).mockRejectedValue(new Error('Another debugger is already attached'));
    await expect(controller().run(7, 'click', { elementId: 'el_001' })).rejects.toThrow(/Close DevTools or another debugger/);
  });
});
