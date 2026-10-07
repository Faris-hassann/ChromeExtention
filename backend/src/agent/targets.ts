import type { BrowserObservation, SemanticElement } from '../types.js';
export const normalize = (value?: string) => (value ?? '').replace(/\s+/g, ' ').trim();
export function sameTarget(a: SemanticElement, b: SemanticElement) {
  return a.role === b.role && normalize(a.name) === normalize(b.name)
    && (a.role === 'textbox' || a.role === 'searchbox' || normalize(a.text) === normalize(b.text))
    && a.frameId === b.frameId && a.documentId === b.documentId && a.documentToken === b.documentToken
    && a.widget === b.widget && a.columnName === b.columnName && a.tableName === b.tableName
    && a.rowText === b.rowText && a.rowIndex === b.rowIndex;
}
export function resolveTarget(target: SemanticElement, observation: BrowserObservation) {
  const matches = observation.interactiveElements.filter(candidate => sameTarget(target, candidate) && !candidate.disabled);
  return matches.length === 1 ? matches[0] : undefined;
}
export function targetArguments(target: SemanticElement) {
  return { elementId: target.elementId, ...(target.frameId ? { frameId: target.frameId } : {}), ...(target.documentId ? { documentId: target.documentId } : {}) };
}
