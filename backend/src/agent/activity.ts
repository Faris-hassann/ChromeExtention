import type { BrowserObservation, ToolRequest } from '../types.js';

export function actionDescription(request: ToolRequest, observation?: BrowserObservation) {
  const target = observation?.interactiveElements.find(el => el.elementId === request.arguments.elementId);
  const name = target?.name || target?.text;
  const label = name && target?.role !== 'textbox' ? ` "${name.slice(0, 120)}"` : '';
  if (request.tool === 'find_element') return `Find "${String(request.arguments.text).slice(0, 120)}"${request.arguments.column ? ` in ${request.arguments.column}` : ''}`;
  if (request.tool === 'click') return `Click${label}${target?.columnName ? ` in ${target.columnName}` : ''}`;
  if (['type', 'fill', 'paste_text', 'clear'].includes(request.tool)) return `${request.tool === 'clear' ? 'Clear' : 'Update'} ${target?.role === 'textbox' ? 'the text field' : 'the observed field'}`;
  if (request.tool === 'verify_report_change') return `Verify report ${request.arguments.property}`;
  return request.tool.replaceAll('_', ' ');
}

export function observedChanges(before: BrowserObservation, after: BrowserObservation): string[] {
  const changes: string[] = [];
  if (before.url !== after.url) changes.push('Page URL changed');
  if (before.title !== after.title) changes.push('Page title changed');
  const signature = (el: BrowserObservation['interactiveElements'][number]) => JSON.stringify([el.role, el.name, el.text, el.columnName, el.rowText, el.frameId]);
  const prior = new Map(before.interactiveElements.map(el => [signature(el), el]));
  for (const el of after.interactiveElements) {
    const old = prior.get(signature(el)); if (!old) continue;
    if (old.selected !== el.selected && el.selected === true) changes.push(el.columnName ? `Table cell selected in ${el.columnName}` : 'Selection changed');
    if (old.checked !== el.checked) changes.push('Checkbox state changed');
    if (old.value !== el.value && el.value !== '[REDACTED]') changes.push('A field value changed');
  }
  for (const toast of after.toasts ?? []) if (typeof toast === 'string' && !(before.toasts ?? []).includes(toast)) changes.push('A new page notification appeared');
  if (before.powerBi?.saveDisabled === false && after.powerBi?.saveDisabled === true && !after.powerBi.saving) changes.push('Save control became disabled');
  if (JSON.stringify(before.tables) !== JSON.stringify(after.tables)) changes.push('Visible table data changed');
  if (before.semanticContent !== after.semanticContent) changes.push('Visible page text changed');
  return [...new Set(changes)].slice(0, 5);
}
