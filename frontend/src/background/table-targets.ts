export interface TableSearch { text: string; column?: string; exact?: boolean; occurrence?: number }

// Serialized into a frame. Search rendered table cells, including virtualized
// Power BI grids; do not substitute the application's global search box.
export function collectTableTargets(query?: TableSearch | null) {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
  const uniqueId = () => `el_table_${Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, '0')).join('')}`;
  const visible = (el: Element) => { const rect = el.getBoundingClientRect(); const style = getComputedStyle(el); return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; };
  const roots: Array<Document | ShadowRoot> = [document];
  const visit = (root: Document | ShadowRoot) => { for (const el of root.querySelectorAll('*')) if (el.shadowRoot) { roots.push(el.shadowRoot); visit(el.shadowRoot); } }; visit(document);
  const scopeSelector = 'table,[role="grid"],[role="treegrid"],[role="table"],.tablixContainer,.tableEx,.pivotTable';
  const cellSelector = 'td,[role="gridcell"],[role="cell"],.tablixCell,.pivotTableCellWrap';
  const headerSelector = 'th,[role="columnheader"],.tablixColumnHeader';
  const cells: Array<{ elementId: string; role: string; name: string; text: string; columnName?: string; rowText?: string; rowIndex?: number; tableName?: string; selected?: boolean; priority: number; searchMatch?: boolean }> = [];
  const panes: Array<{ elementId: string; role: string; name: string; text: string; tableName: string; priority: number }> = [];
  const tables: Array<{ name: string; columns: string[]; rows: string[][] }> = [];
  for (const root of roots) {
    const scopes = [...root.querySelectorAll(scopeSelector)].filter(el => !el.querySelector(scopeSelector));
    // Some Power BI table layouts expose cells inside a visual rather than a grid.
    for (const cell of root.querySelectorAll(cellSelector)) {
      if (cell.closest(scopeSelector)) continue;
      const visual = cell.closest('.visualContainer,visual-container,[data-testid="visual-container"]');
      if (visual && !scopes.includes(visual)) scopes.push(visual);
    }
    for (const scope of scopes) {
      if (!visible(scope)) continue;
      const headers = [...scope.querySelectorAll(headerSelector)].filter(visible);
      const columns = headers.map(el => normalize((el as HTMLElement).innerText || el.textContent || el.getAttribute('aria-label') || ''));
      const name = scope.getAttribute('aria-label') || scope.closest('[aria-label]')?.getAttribute('aria-label') || `Table ${tables.length + 1}`;
      const rows = [...scope.querySelectorAll('tr,[role="row"],.tablixRow')];
      const allCells = [...scope.querySelectorAll(cellSelector)].filter(el => visible(el) && !el.parentElement?.closest(cellSelector));
      const tableRows: string[][] = [];
      for (const cell of allCells) {
        const text = normalize((cell as HTMLElement).innerText || cell.textContent || cell.getAttribute('aria-label') || '');
        if (!text) continue;
        const row = cell.closest('tr,[role="row"],.tablixRow');
        const siblings = row ? [...row.querySelectorAll(cellSelector)].filter(el => !el.parentElement?.closest(cellSelector)) : allCells;
        const colAttribute = cell.getAttribute('aria-colindex') || cell.getAttribute('column-index');
        const colIndex = colAttribute ? Number(colAttribute) - (cell.hasAttribute('aria-colindex') ? 1 : 0) : siblings.indexOf(cell);
        const labelledHeader = (cell.getAttribute('headers') || '').split(/\s+/).map(id => root.querySelector(`[id="${CSS.escape(id)}"]`)?.textContent).filter(Boolean).join(' ');
        const header = headers.find(el => el.getAttribute('aria-colindex') === String(colIndex + 1));
        const columnName = labelledHeader || (header ? normalize(header.textContent || '') : columns[colIndex % Math.max(1, columns.length)]);
        const rowText = row ? normalize((row as HTMLElement).innerText || row.textContent || '').slice(0, 500) : undefined;
        const rowIndex = row ? Number(row.getAttribute('aria-rowindex')) || rows.indexOf(row) + 1 : undefined;
        const matchesText = query && (query.exact === false ? text.toLowerCase().includes(normalize(query.text).toLowerCase()) : text === normalize(query.text));
        const searchMatch = !!matchesText && (!query?.column || normalize(columnName || '').toLowerCase() === normalize(query.column).toLowerCase());
        const elementId = cell.getAttribute('data-local-agent-id') || uniqueId(); cell.setAttribute('data-local-agent-id', elementId);
        const selected = cell.getAttribute('aria-selected') === 'true' || row?.getAttribute('aria-selected') === 'true' || cell.classList.contains('selected') || row?.classList.contains('selected') || false;
        cells.push({ elementId, role: 'gridcell', name: text, text, columnName, rowText, rowIndex, tableName: name, selected, priority: searchMatch ? 10 : 2, searchMatch });
      }
      for (const row of rows.slice(0, 100)) {
        const values = [...row.querySelectorAll(cellSelector)].filter(visible).map(el => normalize((el as HTMLElement).innerText || el.textContent || ''));
        if (values.length) tableRows.push(values);
      }
      const paneId = scope.getAttribute('data-local-agent-id') || uniqueId(); scope.setAttribute('data-local-agent-id', paneId);
      panes.push({ elementId: paneId, role: 'grid', name, text: columns.join(' | '), tableName: name, priority: query ? 6 : 2 });
      tables.push({ name, columns, rows: tableRows });
    }
  }
  const matches = cells.filter(cell => cell.searchMatch);
  const chosen = matches[(query?.occurrence ?? 1) - 1];
  if (chosen) chosen.priority = 11;
  return { interactiveElements: [...cells, ...panes], tables, matchCount: matches.length, chosenElementId: chosen?.elementId };
}
