// This function is serialized into the active page. Keep it dependency-free.
export function collectPage() {
  const isVisible = (el: Element) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const roots: Array<Document | ShadowRoot> = [document];
  const visit = (root: Document | ShadowRoot) => { root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) { roots.push(el.shadowRoot); visit(el.shadowRoot); } }); }; visit(document);
  const selectors = 'a[href],button,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[contenteditable="true"],[tabindex]';
  const elements: Element[] = []; for (const root of roots) root.querySelectorAll(selectors).forEach(el => { if (isVisible(el) && !elements.includes(el)) elements.push(el); });
  const registry = elements.slice(0, 250).map((el, index) => { const node = el as HTMLInputElement; const id = `el_${String(index + 1).padStart(3, '0')}`; el.setAttribute('data-local-agent-id', id); const role = el.getAttribute('role') || ({ A: 'link', BUTTON: 'button', INPUT: node.type === 'checkbox' ? 'checkbox' : node.type === 'radio' ? 'radio' : 'textbox', TEXTAREA: 'textbox', SELECT: 'combobox' } as Record<string, string>)[el.tagName]; const label = node.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.getAttribute('title') || node.placeholder || (el.textContent ?? '').trim().slice(0, 160); return { elementId: id, role, name: label || undefined, text: (el.textContent ?? '').trim().slice(0, 300) || undefined, value: /password/i.test(node.type) ? '[REDACTED]' : node.value?.slice(0, 300), disabled: node.disabled || undefined, checked: node.checked, selected: node instanceof HTMLOptionElement ? node.selected : undefined }; });
  const text = (document.body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 12000);
  const tables = [...document.querySelectorAll('table')].slice(0, 20).map(table => [...table.rows].slice(0, 100).map(row => [...row.cells].map(cell => cell.innerText.trim().slice(0, 300))));
  const forms = [...document.forms].map(form => ({ name: form.getAttribute('aria-label') || form.name || undefined, fields: [...form.elements].slice(0, 100).map(el => { const n = el as HTMLInputElement; return { name: n.labels?.[0]?.innerText || n.name || n.placeholder, type: n.type, value: n.type === 'password' ? '[REDACTED]' : n.value }; }) }));
  const dialogs = [...document.querySelectorAll('[role="dialog"],dialog[open]')].filter(isVisible).map(el => (el.textContent ?? '').trim().slice(0, 1000));
  const toasts = [...document.querySelectorAll('[role="alert"],[aria-live="assertive"],[aria-live="polite"]')].filter(isVisible).map(el => (el.textContent ?? '').trim().slice(0, 500));
  const frames = [...document.querySelectorAll('iframe')].map((f, i) => ({ frameId: `frame_${i + 1}`, title: f.title, src: f.src, accessible: false }));
  const active = document.activeElement?.getAttribute('data-local-agent-id') ?? undefined;
  return { title: document.title, url: location.href, loadingState: document.readyState, focusedElementId: active, interactiveElements: registry, semanticContent: text, tables, forms, dialogs, toasts, frames };
}

export function executeInPage(tool: string, args: Record<string, any>) {
  const el = args.elementId ? document.querySelector(`[data-local-agent-id="${CSS.escape(args.elementId)}"]`) as HTMLElement | null : null;
  if (args.elementId && !el) return { ok: false, code: 'STALE_ELEMENT', error: 'Element ID is stale; observe again.' };
  const input = el as HTMLInputElement | null;
  const events = () => { el?.dispatchEvent(new Event('input', { bubbles: true })); el?.dispatchEvent(new Event('change', { bubbles: true })); };
  switch (tool) {
    case 'click': el!.click(); break; case 'double_click': el!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); break;
    case 'fill': case 'type': input!.focus(); input!.value = String(args.value ?? ''); events(); break; case 'clear': input!.value = ''; events(); break;
    case 'focus': el!.focus(); break; case 'hover': el!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); break;
    case 'check': input!.checked = true; events(); break; case 'uncheck': input!.checked = false; events(); break;
    case 'select_option': input!.value = String(args.value); events(); break; case 'press_key': (el ?? document.activeElement)?.dispatchEvent(new KeyboardEvent('keydown', { key: String(args.key), bubbles: true })); break;
    case 'scroll': window.scrollBy({ top: (args.direction === 'up' ? -1 : 1) * Number(args.amount ?? 600), behavior: 'smooth' }); break;
    case 'submit_form': (el!.closest('form') as HTMLFormElement | null)?.requestSubmit(); break;
    default: return { ok: false, code: 'UNSUPPORTED', error: `Unsupported page tool: ${tool}` };
  }
  if (el) { const old = el.style.outline; el.style.outline = '3px solid #8b5cf6'; setTimeout(() => { el.style.outline = old; }, 1200); }
  return { ok: true };
}
