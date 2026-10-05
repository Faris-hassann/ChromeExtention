// This function is serialized into the active page. Keep it dependency-free.
export function collectPage() {
  const isVisible = (el: Element) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  let answerNodes = [...document.querySelectorAll('[data-message-author-role="assistant"]')].filter(isVisible);
  // Newer ChatGPT layouts expose response action controls instead of author attributes.
  if (!answerNodes.length && location.hostname === 'chatgpt.com') {
    answerNodes = [...document.querySelectorAll('.turn-action-controls')].filter(control => control.querySelector('button[aria-label="Copy"]')).map(control => control.parentElement!).filter(isVisible);
  }
  for (const answer of answerNodes) answer.setAttribute('data-local-agent-answer', 'true');
  const roots: Array<Document | ShadowRoot> = [document];
  const visit = (root: Document | ShadowRoot) => { root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) { roots.push(el.shadowRoot); visit(el.shadowRoot); } }); }; visit(document);
  const selectors = 'a[href],button,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[contenteditable="true"],[tabindex],[data-message-author-role="assistant"],[data-local-agent-answer="true"]';
  const elements: Element[] = []; for (const root of roots) root.querySelectorAll(selectors).forEach(el => { if (isVisible(el) && !elements.includes(el)) elements.push(el); });
  const prioritized = elements.filter(el => el.matches('input,textarea,[contenteditable="true"],[data-message-author-role="assistant"],[data-local-agent-answer="true"],button[aria-label*="Send"],button[data-testid*="send"],button[aria-label*="Stop"],button[aria-label*="Search"]'));
  elements.sort((a, b) => Number(prioritized.includes(b)) - Number(prioritized.includes(a)));
  const registry = elements.slice(0, 250).map((el, index) => { const node = el as HTMLInputElement; const id = `el_${String(index + 1).padStart(3, '0')}`; el.setAttribute('data-local-agent-id', id); const role = (el as HTMLElement).isContentEditable ? 'textbox' : el.getAttribute('role') || ({ A: 'link', BUTTON: 'button', INPUT: node.type === 'checkbox' ? 'checkbox' : node.type === 'radio' ? 'radio' : 'textbox', TEXTAREA: 'textbox', SELECT: 'combobox' } as Record<string, string>)[el.tagName]; const label = node.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || node.placeholder || (el.textContent ?? '').trim().slice(0, 160); return { elementId: id, role, name: label || undefined, text: (el.textContent ?? '').trim().slice(0, 300) || undefined, value: /password/i.test(node.type) ? '[REDACTED]' : node.value?.slice(0, 300), disabled: node.disabled || undefined, checked: node.checked, selected: node instanceof HTMLOptionElement ? node.selected : undefined }; });
  const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 12000);
  const tables = [...document.querySelectorAll('table')].slice(0, 20).map(table => [...table.rows].slice(0, 100).map(row => [...row.cells].map(cell => cell.innerText.trim().slice(0, 300))));
  const forms = [...document.forms].map(form => ({ name: form.getAttribute('aria-label') || form.name || undefined, fields: [...form.elements].slice(0, 100).map(el => { const n = el as HTMLInputElement; return { name: n.labels?.[0]?.innerText || n.name || n.placeholder, type: n.type, value: n.type === 'password' ? '[REDACTED]' : n.value }; }) }));
  const dialogs = [...document.querySelectorAll('[role="dialog"],dialog[open]')].filter(isVisible).map(el => (el.textContent ?? '').trim().slice(0, 1000));
  const toasts = [...document.querySelectorAll('[role="alert"],[aria-live="assertive"],[aria-live="polite"]')].filter(isVisible).map(el => (el.textContent ?? '').trim().slice(0, 500));
  const frames = [...document.querySelectorAll('iframe')].map((f, i) => ({ frameId: `frame_${i + 1}`, title: f.title, src: f.src, accessible: false }));
  const active = document.activeElement?.getAttribute('data-local-agent-id') ?? undefined;
  for (const element of registry) {
    const node = document.querySelector(`[data-local-agent-id="${element.elementId}"]`) as HTMLElement | null;
    if (node?.isContentEditable) element.role = 'textbox';
    if (answerNodes.includes(node!)) element.role = 'article';
  }
  const latestAnswerId = answerNodes.at(-1)?.getAttribute('data-local-agent-id') ?? undefined;
  const generating = !!document.querySelector('[data-is-streaming="true"],.result-streaming,button[data-testid*="stop"],button[aria-label="Stop"],button[aria-label="Stop generating"],button[aria-label="Stop streaming"]');
  const searchResultsVisible = /(^|\.)google\.[a-z.]+$/.test(location.hostname) && location.pathname === '/search' && [...document.querySelectorAll('#search a,#rso a')].some(isVisible);
  return { title: document.title, url: location.href, loadingState: document.readyState, focusedElementId: active, interactiveElements: registry, semanticContent: text, tables, forms, dialogs, toasts, frames, responseState: { generating, latestAnswerId }, searchResultsVisible };
}

export async function executeInPage(tool: string, args: Record<string, any>) {
  const el = args.elementId ? document.querySelector(`[data-local-agent-id="${CSS.escape(args.elementId)}"]`) as HTMLElement | null : null;
  if (args.elementId && !el) return { ok: false, code: 'STALE_ELEMENT', error: 'Element ID is stale; observe again.' };
  const input = el as HTMLInputElement | null;
  const events = () => { el?.dispatchEvent(new Event('input', { bubbles: true })); el?.dispatchEvent(new Event('change', { bubbles: true })); };
  const fill = (value: string) => {
    if (!el) return false;
    el.focus();
    if (el.isContentEditable) {
      const selection = window.getSelection();
      const range = document.createRange(); range.selectNodeContents(el); selection?.removeAllRanges(); selection?.addRange(range);
      if (!document.execCommand('insertText', false, value)) { el.textContent = value; el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })); }
      return (el.innerText ?? el.textContent ?? '') === value;
    }
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return false;
    const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(el, value);
    events();
    return (el as HTMLInputElement).value === value;
  };
  switch (tool) {
    case 'capture_text': {
      if (document.querySelector('[data-is-streaming="true"],.result-streaming,button[data-testid*="stop"],button[aria-label="Stop"],button[aria-label="Stop generating"],button[aria-label="Stop streaming"]')) return { ok: false, code: 'RESPONSE_GENERATING', error: 'Wait for the answer to finish before capturing it.' };
      const authorAnswers = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
      const answers = authorAnswers.length ? authorAnswers : [...document.querySelectorAll('[data-local-agent-answer="true"]')];
      if (location.hostname === 'chatgpt.com' && el !== answers.at(-1)) return { ok: false, code: 'WRONG_ANSWER', error: 'Capture responseState.latestAnswerId, not a navigation link or previous answer.' };
      const capturedText = el?.innerText ?? el?.textContent ?? '';
      await new Promise(resolve => setTimeout(resolve, 500));
      if (capturedText !== (el?.innerText ?? el?.textContent ?? '')) return { ok: false, code: 'RESPONSE_GENERATING', error: 'The answer is still changing. Wait and observe again.' };
      if (!capturedText.trim()) return { ok: false, code: 'EMPTY_TEXT', error: 'The observed element has no text.' };
      if (new TextEncoder().encode(capturedText).length > 32768) return { ok: false, code: 'TEXT_LIMIT', error: 'Captured text exceeds 32 KiB.' };
      return { ok: true, capturedText };
    }
    case 'click': el!.click(); break; case 'double_click': el!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); break;
    case 'fill': case 'type': case 'paste_text': case 'clear': {
      if (!fill(tool === 'clear' ? '' : String(args.value ?? ''))) return { ok: false, code: 'INPUT_MISMATCH', error: 'The field did not retain the requested text.' };
      break;
    }
    case 'focus': el!.focus(); break; case 'hover': el!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); break;
    case 'check': input!.checked = true; events(); break; case 'uncheck': input!.checked = false; events(); break;
    case 'select_option': input!.value = String(args.value); events(); break;
    case 'press_key': {
      const target = el ?? document.activeElement as HTMLElement | null;
      target?.focus();
      const before = document.body.innerText;
      const key = String(args.key);
      const allowed = target?.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
      target?.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true }));
      if (key === 'Enter' && allowed && target instanceof HTMLElement && !target.isContentEditable) (target.closest('form') as HTMLFormElement | null)?.requestSubmit();
      if (key === 'Enter') {
        await new Promise(resolve => setTimeout(resolve, 500));
        return { ok: true, submissionVerified: document.body.innerText !== before, needsSubmissionVerification: document.body.innerText === before };
      }
      break;
    }
    case 'scroll': window.scrollBy({ top: (args.direction === 'up' ? -1 : 1) * Number(args.amount ?? 600), behavior: 'smooth' }); break;
    case 'submit_form': { const form = el!.closest('form') as HTMLFormElement | null; if (!form) return { ok: false, code: 'NO_FORM', error: 'Use the observed Send/Search button.' }; form.requestSubmit(); break; }
    default: return { ok: false, code: 'UNSUPPORTED', error: `Unsupported page tool: ${tool}` };
  }
  if (el) { const old = el.style.outline; el.style.outline = '3px solid #8b5cf6'; setTimeout(() => { el.style.outline = old; }, 1200); }
  return { ok: true };
}

// These helpers are serialized into the active page. Keep them dependency-free.
export function resolveInputTarget(elementId?: string) {
  const deepFind = (root: Document | ShadowRoot, id: string): HTMLElement | null => {
    const own = root.querySelector(`[data-local-agent-id="${CSS.escape(id)}"]`) as HTMLElement | null;
    if (own) return own;
    for (const node of root.querySelectorAll('*')) if (node.shadowRoot) { const found = deepFind(node.shadowRoot, id); if (found) return found; }
    return null;
  };
  const el = elementId ? deepFind(document, elementId) : document.activeElement as HTMLElement | null;
  if (!el) return { ok: false, code: 'STALE_ELEMENT', error: 'Element ID is stale; observe again.' };
  el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const rect = el.getBoundingClientRect(); const style = getComputedStyle(el);
  if (!rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return { ok: false, code: 'TARGET_NOT_VISIBLE', error: 'The target is not visible.' };
  if ((el as HTMLInputElement).disabled || el.getAttribute('aria-disabled') === 'true') return { ok: false, code: 'TARGET_DISABLED', error: 'The target is disabled.' };
  const x = Math.max(1, Math.min(innerWidth - 1, rect.left + rect.width / 2)); const y = Math.max(1, Math.min(innerHeight - 1, rect.top + rect.height / 2));
  const hit = document.elementFromPoint(x, y);
  const reaches = (from: Node | null, target: Node | null) => { let node = from; while (node) { if (node === target) return true; node = node.parentNode || ((node as ShadowRoot).host ?? null); } return false; };
  if (!reaches(hit, el) && !reaches(el, hit)) return { ok: false, code: 'TARGET_OBSTRUCTED', error: 'Another visible element covers the target. Observe again or dismiss it.' };
  const input = el as HTMLInputElement;
  return { ok: true, x, y, tag: el.tagName, editable: el.isContentEditable || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement, contentEditable: el.isContentEditable, value: el.isContentEditable ? (el.innerText ?? el.textContent ?? '') : input.value, checked: input.checked, type: input.type, select: el instanceof HTMLSelectElement };
}

export function updateAgentCursor(x?: number, y?: number, visible = true, click = false, remove = false) {
  const id = '__local_agent_cursor_overlay__';
  document.querySelectorAll('[data-local-agent-overlay]').forEach(node => { if (remove) node.remove(); });
  if (remove || !visible || x === undefined || y === undefined) return;
  let cursor = document.getElementById(id) as HTMLElement | null;
  if (!cursor) { cursor = document.createElement('div'); cursor.id = id; cursor.setAttribute('data-local-agent-overlay', 'true'); cursor.style.cssText = 'position:fixed;z-index:2147483647;width:18px;height:24px;pointer-events:none;transition:left 140ms ease-out,top 140ms ease-out;filter:drop-shadow(0 1px 2px #0008)'; cursor.innerHTML = '<svg viewBox="0 0 18 24" width="18" height="24" aria-hidden="true"><path d="M1 1l1 18 5-5 4 8 3-2-4-8h7z" fill="#7c3aed" stroke="white" stroke-width="1.5"/></svg>'; document.documentElement.appendChild(cursor); }
  cursor.style.left = `${x}px`; cursor.style.top = `${y}px`;
  if (click) { const ring = document.createElement('div'); ring.setAttribute('data-local-agent-overlay', 'true'); ring.style.cssText = `position:fixed;pointer-events:none;z-index:2147483646;left:${x - 15}px;top:${y - 15}px;width:30px;height:30px;border:3px solid #8b5cf6;border-radius:50%;animation:local-agent-click .45s ease-out forwards`; const style = document.createElement('style'); style.setAttribute('data-local-agent-overlay', 'true'); style.textContent = '@keyframes local-agent-click{to{transform:scale(1.8);opacity:0}}'; document.documentElement.append(style, ring); setTimeout(() => { ring.remove(); style.remove(); }, 500); }
}

export function readInputTarget(elementId?: string) {
  const find = (root: Document | ShadowRoot, id: string): HTMLElement | null => { const own = root.querySelector(`[data-local-agent-id="${CSS.escape(id)}"]`) as HTMLElement | null; if (own) return own; for (const node of root.querySelectorAll('*')) if (node.shadowRoot) { const found = find(node.shadowRoot, id); if (found) return found; } return null; };
  const el = elementId ? find(document, elementId) : document.activeElement as HTMLElement | null;
  if (!el) return { exists: false };
  const input = el as HTMLInputElement;
  return { exists: true, value: el.isContentEditable ? (el.innerText ?? el.textContent ?? '') : input.value, checked: input.checked, selected: el instanceof HTMLSelectElement ? el.value : undefined };
}
