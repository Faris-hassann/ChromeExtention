// Serialized into each permitted frame's isolated extension world.
export function installFrameGeometry(channel: string) {
  const state = globalThis as typeof globalThis & { __agentGeometry?: { channel: string; project: (x: number, y: number) => Promise<{ ok: boolean; x?: number; y?: number; error?: string }>; dispose: () => void } };
  if (state.__agentGeometry?.channel === channel) return;
  state.__agentGeometry?.dispose();
  const project = (x: number, y: number): Promise<{ ok: boolean; x?: number; y?: number; error?: string }> => {
    if (window === window.top) return Promise.resolve({ ok: true, x, y });
    return new Promise(resolve => {
      const ports = new MessageChannel();
      const timer = setTimeout(() => { ports.port1.close(); resolve({ ok: false, error: 'Parent frame is inaccessible. Observe again or allow its site access.' }); }, 1500);
      ports.port1.onmessage = event => { clearTimeout(timer); ports.port1.close(); resolve(event.data); };
      window.parent.postMessage({ channel, x, y, width: innerWidth, height: innerHeight }, '*', [ports.port2]);
    });
  };
  const listener = async (event: MessageEvent) => {
    if (event.data?.channel !== channel || !event.ports[0]) return;
    const find = (root: Document | ShadowRoot): HTMLIFrameElement | undefined => {
      for (const el of root.querySelectorAll('iframe')) if (el.contentWindow === event.source) return el;
      for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { const found = find(el.shadowRoot); if (found) return found; }
    };
    const frame = find(document); if (!frame) return;
    const port = event.ports[0];
    const fail = (error: string) => { port.postMessage({ ok: false, error }); port.close(); };
    const { x, y, width, height } = event.data;
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0 || x < 0 || y < 0 || x >= width || y >= height) return fail('Invalid frame coordinates.');
    frame.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    const rect = frame.getBoundingClientRect();
    const style = getComputedStyle(frame);
    // Rotation/skew would require a quadrilateral transform; reject instead of guessing.
    if (style.transform && style.transform !== 'none' && !/^matrix\([^,]+,\s*0,\s*0,/.test(style.transform)) return fail('Rotated or skewed frames cannot be targeted.');
    if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none') return fail('Frame is not visible.');
    const scaleX = rect.width / frame.offsetWidth; const scaleY = rect.height / frame.offsetHeight;
    const px = rect.left + (frame.clientLeft + x * frame.clientWidth / width) * scaleX;
    const py = rect.top + (frame.clientTop + y * frame.clientHeight / height) * scaleY;
    let hit = document.elementFromPoint(px, py);
    while (hit?.shadowRoot) { const deeper = hit.shadowRoot.elementFromPoint(px, py); if (!deeper || deeper === hit) break; hit = deeper; }
    if (hit !== frame || px < 0 || py < 0 || px >= innerWidth || py >= innerHeight) return fail('Frame is clipped or covered by another element.');
    port.postMessage(await project(px, py)); port.close();
  };
  window.addEventListener('message', listener);
  state.__agentGeometry = { channel, project, dispose: () => window.removeEventListener('message', listener) };
}
