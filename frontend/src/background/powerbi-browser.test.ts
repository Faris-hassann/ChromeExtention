import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser, type Frame, type Page } from 'playwright';
import { collectPage, executeInPage, resolveInputTarget, verifyReportChange } from './collector';
import { installFrameGeometry } from './frame-geometry';
import { collectFrames, FrameRegistry } from './frames';
import { InputController } from './input-controller';
import { collectTableTargets } from './table-targets';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); }, 30000);
afterAll(async () => { await browser?.close(); });
afterEach(() => vi.unstubAllGlobals());
const evaluate = <F extends (...args: any[]) => any>(frame: Frame | Page, func: F, args: unknown[] = []): Promise<Awaited<ReturnType<F>>> => frame.evaluate(`(${func.toString()})(...${JSON.stringify(args)})`);

describe('Power BI editing and frame geometry in Chromium', () => {
  it('collects real filter evidence and excludes checkbox choices awaiting Apply', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<section class="filterCard" aria-label="Process Name filter"><label><input type="checkbox" checked>825444_Care_UK_CBUPorting</label><button onclick="this.disabled=true">Apply</button></section><div class="visualContainer" aria-label="Related dashboard">825444_Care_UK_CBUPorting: 12 ports</div><div class="visualContainer" aria-label="Processes"><table><tr><th>Process Name</th></tr><tr><td>825444_Care_UK_CBUPorting</td></tr></table></div>');
      const pending = await evaluate(page, collectPage, []);
      expect(pending.dashboardEvidence.filters).toHaveLength(0);
      expect(pending.interactiveElements.find(element => element.name === 'Apply')?.widget).toBe('Process Name filter');
      await page.getByRole('button', { name: 'Apply' }).click();
      const applied = await evaluate(page, collectPage, []);
      expect(applied.dashboardEvidence.filters).toMatchObject([{ label: 'Process Name filter', value: '825444_Care_UK_CBUPorting' }]);
      expect(applied.dashboardEvidence.visuals.find(visual => visual.key === 'Related dashboard')).toMatchObject({ processTable: false, text: '825444_Care_UK_CBUPorting: 12 ports' });
      expect(applied.dashboardEvidence.visuals.find(visual => visual.key === 'Processes')?.processTable).toBe(true);
    } finally { await page.close(); }
  });
  it('refreshes a stale process target locally and observes cross-selection in another visual', async () => {
    const page = await browser.newPage();
    try {
      const identifier = '825444_Care_UK_CBUPorting';
      await page.setContent(`<div class="visualContainer" aria-label="Processes"><table><tr><th>Process Name</th></tr><tr><td aria-selected="false" onclick="this.setAttribute('aria-selected','true');document.querySelector('#related').textContent='${identifier}: filtered ports';">${identifier}</td></tr></table></div><div id="related" class="visualContainer" aria-label="Related dashboard">All processes</div>`);
      const first = await evaluate(page, collectPage, []);
      const old = await evaluate(page, collectTableTargets, [{ text: identifier, column: 'Process Name' }]);
      await evaluate(page, collectPage, []);
      expect(await evaluate(page, resolveInputTarget, [old.chosenElementId])).toMatchObject({ ok: false, code: 'STALE_ELEMENT' });
      const fresh = await evaluate(page, collectTableTargets, [{ text: identifier, column: 'Process Name' }]);
      expect(fresh.chosenElementId).not.toBe(old.chosenElementId);
      expect(await evaluate(page, executeInPage, ['click', { elementId: fresh.chosenElementId }])).toMatchObject({ ok: true });
      const after = await evaluate(page, collectPage, []);
      const rows = await evaluate(page, collectTableTargets, [{ text: identifier, column: 'Process Name' }]);
      expect(rows.interactiveElements.some(element => 'searchMatch' in element && element.searchMatch && 'selected' in element && element.selected)).toBe(true);
      expect(after.dashboardEvidence.visuals.find(visual => visual.key === 'Related dashboard')?.text).toBe(identifier + ': filtered ports');
      expect(first.dashboardEvidence.visuals.find(visual => visual.key === 'Related dashboard')?.text).toBe('All processes');
    } finally { await page.close(); }
  });
  it('finds the exact process in its column and clicks the first duplicate row', async () => {
    const context = await browser.newContext();
    const processName = '848427_business_vois_VCSPricing';
    try {
      await context.route('https://app.powerbi.com/**', route => route.fulfill({ contentType: 'text/html', body: `<input aria-label="Search"><button>${processName}</button>${Array.from({ length: 280 }, (_, i) => `<button>Navigation ${i}</button>`).join('')}<div class="visualContainer" style="width:800px;height:200px"><table aria-label="Processes"><thead><tr><th>Process Name</th><th>Reusable Name</th><th>YearAndMonth</th></tr></thead><tbody><tr><td>Different process</td><td>${processName}</td><td>2026 APR</td></tr><tr><td>${processName}_Backup</td><td>Others</td><td>2026 APR</td></tr><tr data-row="first"><td>${processName}</td><td>Others</td><td>2026 MAY</td></tr><tr data-row="second"><td>${processName}</td><td>Others</td><td>2026 APR</td></tr></tbody></table></div><output></output><script>document.querySelectorAll('td').forEach(cell=>cell.onclick=()=>{document.querySelector('output').textContent=cell.parentElement.dataset.row||'wrong';cell.parentElement.setAttribute('aria-selected','true');});</script>` }));
      const page = await context.newPage(); await page.goto('https://app.powerbi.com/groups/w/reports/r');
      const frames = page.frames(); const session = await context.newCDPSession(page);
      vi.stubGlobal('chrome', {
        webNavigation: { getAllFrames: async () => [{ frameId: 0, parentFrameId: -1, url: page.url() }] },
        scripting: { executeScript: async ({ func, args = [] }: any) => [{ frameId: 0, documentId: 'document', result: await evaluate(frames[0], func, args) }] },
        debugger: { attach: async () => undefined, detach: async () => undefined },
      });
      const observation = await collectFrames(7, { text: processName, column: 'Process Name' });
      const cells = observation.interactiveElements as Array<any>;
      const matches = cells.filter(cell => cell.searchMatch);
      expect(matches).toHaveLength(2);
      expect(cells[0]).toMatchObject({ role: 'gridcell', text: processName, columnName: 'Process Name' });
      expect(cells[0].rowText).toContain('2026 MAY');
      const registry = new FrameRegistry(); registry.remember(7, cells);
      const input = new InputController(async (_target, method, params) => session.send(method as any, params as any));
      expect(await input.run(7, 'click', registry.route(7, { elementId: cells[0].elementId }), false)).toMatchObject({ ok: true });
      expect(await page.locator('output').textContent()).toBe('first');
      const after = await collectFrames(7, { text: processName, column: 'Process Name' });
      expect(after.interactiveElements[0]).toMatchObject({ selected: true });
      expect(after.interactiveElements[0].elementId).not.toBe(cells[0].elementId);
      await input.cleanup(7); await session.detach();
    } finally { await context.close(); }
  }, 15000);

  it('uses column indices in accessible grids and finds rows rendered after table scrolling', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<div role="grid" aria-label="Processes" style="height:120px;width:600px;overflow:auto"><div role="row"><span role="columnheader" aria-colindex="2">Month</span><span role="columnheader" aria-colindex="1">Process Name</span></div><div id="rows"><div role="row" aria-rowindex="2"><span role="gridcell" aria-colindex="1">Other</span><span role="gridcell" aria-colindex="2">2026 MAY</span></div></div><div style="height:1000px"></div></div><script>document.querySelector("[role=grid]").onscroll=()=>{document.querySelector("#rows").innerHTML="<div role=row aria-rowindex=10><span role=gridcell aria-colindex=1>848427_business_vois_VCSPricing</span><span role=gridcell aria-colindex=2>2026 APR</span></div>";};</script>');
      const query = { text: '848427_business_vois_VCSPricing', column: 'Process Name' };
      expect((await evaluate(page, collectTableTargets, [query])).matchCount).toBe(0);
      await page.locator('[role=grid]').evaluate(el => { el.scrollTop = 300; });
      await page.locator('[role=gridcell]').first().filter({ hasText: query.text }).waitFor({ state: 'attached' });
      const result = await evaluate(page, collectTableTargets, [query]);
      expect(result.matchCount).toBe(1);
      expect(result.interactiveElements.find(el => el.elementId === result.chosenElementId)).toMatchObject({ columnName: 'Process Name', rowIndex: 10 });
      expect((await evaluate(page, collectTableTargets, [{ ...query, column: 'Month' }])).matchCount).toBe(0);
    } finally { await page.close(); }
  });
  it('discovers and edits a nested cross-origin frame using top-level mouse coordinates', async () => {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    try {
      await context.route('https://app.powerbi.com/**', route => route.fulfill({ contentType: 'text/html', body: '<button>Save</button><button>Navigation</button><div style="height:700px"></div><iframe title="Report" src="https://reports.test/frame" style="width:800px;height:550px;border:8px solid black"></iframe>' }));
      await context.route('https://reports.test/**', route => route.fulfill({ contentType: 'text/html', body: '<input aria-label="Outer title"><div style="height:450px"></div><iframe src="https://visuals.test/editor" style="margin-left:70px;width:500px;height:300px;border:6px solid black;transform:scale(.8);transform-origin:top left"></iframe>' }));
      await context.route('https://visuals.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div class="visualContainer selected" aria-label="Revenue chart" style="width:200px;height:60px">Revenue</div><section aria-label="Format visual"><label>Title text<input value="Old title"></label><input aria-label="Colour hex" value="#ff0000"><button role="option" aria-selected="true" aria-label="Bar chart">Bar chart</button><div role="region" aria-label="Formatting pane" style="height:70px;overflow:auto"><button>Pane control</button><div style="height:500px"></div></div></section>' }));
      const page = await context.newPage(); await page.goto('https://app.powerbi.com/groups/w/reports/r');
      await page.frameLocator('iframe').frameLocator('iframe').locator('input').first().waitFor();
      const frames = page.frames(); const sessions = await context.newCDPSession(page);
      vi.stubGlobal('chrome', {
        webNavigation: { getAllFrames: async () => frames.map((frame, frameId) => ({ frameId, parentFrameId: frames.indexOf(frame.parentFrame()!), url: frame.url() })) },
        scripting: { executeScript: async ({ target, func, args = [] }: any) => {
          const frameId = target.documentIds ? Number(target.documentIds[0].replace('document-', '')) : target.frameIds?.[0] ?? 0;
          return [{ frameId, documentId: `document-${frameId}`, result: await evaluate(frames[frameId], func, args) }];
        } },
        debugger: { attach: async () => undefined, detach: async () => undefined },
      });
      const observation = await collectFrames(7); const registry = new FrameRegistry(); registry.remember(7, observation.interactiveElements);
      const title = observation.interactiveElements.find(el => el.name === 'Title text')!;
      const color = observation.interactiveElements.find(el => el.name === 'Colour hex')!;
      expect(observation.frames.every(frame => frame.accessible)).toBe(true);
      expect(new Set(observation.interactiveElements.map(el => el.elementId)).size).toBe(observation.interactiveElements.length);
      expect(observation.interactiveElements.some(el => el.role === 'visual')).toBe(true);
      const editor = frames.find(frame => frame.url().includes('visuals.test'))!;
      const resolved = await evaluate(editor, resolveInputTarget, [title.elementId, title.documentToken]);
      expect(resolved).toMatchObject({ ok: true });
      const box = await editor.locator('input').first().boundingBox();
      expect(resolved.x).toBeCloseTo(box!.x + box!.width / 2, 0);
      expect(resolved.y).toBeCloseTo(box!.y + box!.height / 2, 0);
      const input = new InputController(async (_target, method, params) => sessions.send(method as any, params as any));
      expect(await input.run(7, 'fill', registry.route(7, { elementId: title.elementId, value: 'Revenue 2026' }), false)).toMatchObject({ ok: true });
      expect(await editor.locator('input').first().inputValue()).toBe('Revenue 2026');
      expect(await evaluate(editor, verifyReportChange, [title.elementId, title.documentToken])).toMatchObject({ ok: true, actualValue: 'Revenue 2026', label: 'Title text' });
      expect(await input.run(7, 'fill', registry.route(7, { elementId: color.elementId, value: '#0000ff' }), false)).toMatchObject({ ok: true });
      const pane = observation.interactiveElements.find(el => el.name === 'Pane control')!;
      expect(await input.run(7, 'scroll', registry.route(7, { elementId: pane.elementId, direction: 'down', amount: 150 }), false)).toMatchObject({ ok: true });
      await expect.poll(() => editor.locator('[role=region]').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
      await input.cleanup(7); await sessions.detach();
    } finally { await context.close(); }
  }, 20000);

  it('rejects covered frames, stale observations, changed documents and missing parent bridges', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<iframe srcdoc="<button>Action</button>" style="width:300px;height:200px"></iframe>');
      const child = page.frames()[1];
      await evaluate(page, installFrameGeometry, ['channel']); await evaluate(child, installFrameGeometry, ['channel']);
      const observation = await evaluate(child, collectPage); const target = observation.interactiveElements[0];
      await page.evaluate(() => { const cover = document.createElement('div'); cover.style.cssText = 'position:fixed;inset:0;background:white;z-index:9999'; document.body.append(cover); });
      expect(await evaluate(child, resolveInputTarget, [target.elementId, observation.documentId])).toMatchObject({ ok: false, code: 'FRAME_NOT_ACCESSIBLE' });
      await evaluate(child, collectPage);
      expect(await evaluate(child, resolveInputTarget, [target.elementId])).toMatchObject({ code: 'STALE_ELEMENT' });
      const fresh = await evaluate(child, collectPage);
      expect(await evaluate(child, resolveInputTarget, [fresh.interactiveElements[0].elementId, 'old-document'])).toMatchObject({ code: 'STALE_DOCUMENT' });
      await page.evaluate(() => (globalThis as any).__agentGeometry.dispose());
      expect(await evaluate(child, resolveInputTarget, [fresh.interactiveElements[0].elementId])).toMatchObject({ code: 'FRAME_NOT_ACCESSIBLE' });
    } finally { await page.close(); }
  }, 10000);

  it('prioritizes formatting controls, reads selection and records save feedback', async () => {
    const context = await browser.newContext();
    try {
      await context.route('https://app.powerbi.com/**', route => route.fulfill({ contentType: 'text/html', body: `${Array.from({ length: 300 }, (_, i) => `<button>Navigation ${i}</button>`).join('')}<button id="save">Save</button><div class="visualContainer selected" aria-label="Sales chart" style="width:200px;height:40px">Sales</div><button role="tab" aria-selected="true">Overview</button><section aria-label="Format visual"><span id="title-label">Title text</span><input aria-labelledby="title-label" value="Sales"><input aria-label="Colour hex" value="#0000ff"><button role="option" aria-selected="true" aria-label="Bar chart">Bar chart</button></section><p role="status"></p><script>const title=document.querySelector('[aria-labelledby=title-label]');title.value=localStorage.getItem('report-title')||'Sales';document.querySelector('#save').onclick=()=>{localStorage.setItem('report-title',title.value);document.querySelector('#save').disabled=true;document.querySelector('[role=status]').textContent='Report saved successfully';};</script>` }));
      const page = await context.newPage(); await page.goto('https://app.powerbi.com/groups/w/reports/r');
      const before = await evaluate(page, collectPage);
      expect(before.interactiveElements.slice(0, 10).map((el: any) => el.name)).toEqual(expect.arrayContaining(['Save', 'Title text', 'Colour hex', 'Bar chart']));
      const selected = before.interactiveElements.find((el: any) => el.name === 'Bar chart')!;
      expect(await evaluate(page, verifyReportChange, [selected.elementId, before.documentId])).toMatchObject({ ok: true, selected: true, actualValue: 'Bar chart' });
      const title = before.interactiveElements.find(el => el.name === 'Title text')!;
      expect(await evaluate(page, executeInPage, ['fill', { elementId: title.elementId, value: 'Revenue 2026' }])).toMatchObject({ ok: true });
      expect(await evaluate(page, verifyReportChange, [title.elementId, before.documentId])).toMatchObject({ ok: true, actualValue: 'Revenue 2026' });
      await page.locator('#save').click();
      expect((await evaluate(page, collectPage)).powerBi).toMatchObject({ saveDisabled: true, saveMessages: ['Report saved successfully'] });
      await page.reload();
      expect(await page.locator('[aria-labelledby=title-label]').inputValue()).toBe('Revenue 2026');
    } finally { await context.close(); }
  });
});
