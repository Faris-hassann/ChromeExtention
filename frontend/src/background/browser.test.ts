import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { collectPage, executeInPage, resolveInputTarget, updateAgentCursor } from './collector';

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); }, 30000);
afterAll(async () => { await browser?.close(); });
async function execute(page: Page, tool: string, args: Record<string, unknown>) {
  return page.evaluate(`(${executeInPage.toString()})(${JSON.stringify(tool)},${JSON.stringify(args)})`);
}
async function observe(page: Page) { return page.evaluate(collectPage); }

describe('browser interactions in real Chromium', () => {
  it('accepts real DevTools mouse and keyboard input for native controls', async () => {
    const page = await browser.newPage(); const session = await page.context().newCDPSession(page);
    try {
      await page.setContent('<input aria-label="Search"><button>Action</button><input type="checkbox"><output></output><script>const o=document.querySelector("output");document.querySelector("button").addEventListener("dblclick",()=>o.textContent="double");</script>');
      const inputBox = await page.locator('input').first().boundingBox(); const buttonBox = await page.locator('button').boundingBox(); const checkBox = await page.locator('[type=checkbox]').boundingBox();
      const click = async (box: NonNullable<typeof inputBox>, count = 1) => { const x = box.x + box.width / 2, y = box.y + box.height / 2; await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); for (let i = 1; i <= count; i++) { await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: i }); await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: i }); } };
      await click(inputBox!); await session.send('Input.insertText', { text: 'Cairo 🙂' });
      await click(buttonBox!, 2); await click(checkBox!);
      expect(await page.locator('input').first().inputValue()).toBe('Cairo 🙂');
      expect(await page.locator('output').textContent()).toBe('double');
      expect(await page.locator('[type=checkbox]').isChecked()).toBe(true);
    } finally { await session.detach(); await page.close(); }
  });
  it('resolves open-shadow targets, rejects obstruction, and excludes the cursor overlay', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<div id="host"></div><p>Visible page text</p>');
      await page.evaluate(() => { const root = document.querySelector('#host')!.attachShadow({ mode: 'open' }); root.innerHTML = '<button aria-label="Shadow action">Action</button>'; });
      const obs = await observe(page); const target = obs.interactiveElements.find(e => e.name === 'Shadow action')!;
      expect(await page.evaluate(`(${resolveInputTarget.toString()})(${JSON.stringify(target.elementId)})`)).toMatchObject({ ok: true, tag: 'BUTTON' });
      await page.evaluate(`(${updateAgentCursor.toString()})(100,80,true,true,false)`);
      const withOverlay = await observe(page);
      expect(withOverlay.semanticContent).toContain('Visible page text');
      expect(withOverlay.interactiveElements.some(e => e.name?.includes('cursor'))).toBe(false);
      await page.evaluate(() => { const cover = document.createElement('div'); cover.style.cssText = 'position:fixed;inset:0;z-index:2147483645;background:white'; document.body.appendChild(cover); });
      expect(await page.evaluate(`(${resolveInputTarget.toString()})(${JSON.stringify(withOverlay.interactiveElements.find(e => e.name === 'Shadow action')!.elementId)})`)).toMatchObject({ ok: false, code: 'TARGET_OBSTRUCTED' });
    } finally { await page.close(); }
  });
  it('identifies the latest answer in layouts with response controls rather than author attributes', async () => {
    const context = await browser.newContext();
    try {
      await context.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: '<div><p>Old answer</p><div class="turn-action-controls"><button aria-label="Copy"></button></div></div><div><p>Latest complete answer</p><div class="turn-action-controls"><button aria-label="Copy"></button></div></div>' }));
      const page = await context.newPage(); await page.goto('https://chatgpt.com/');
      const obs = await observe(page);
      const result = await execute(page, 'capture_text', { elementId: obs.responseState.latestAnswerId, key: 'answer' }) as any;
      expect(result.capturedText).toBe('Latest complete answer');
    } finally { await context.close(); }
  });
  it('updates a framework-tracked native input using its native setter', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<input aria-label="Search"><output></output>');
      await page.evaluate(() => {
        const input = document.querySelector('input')!; let tracked = '';
        const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
        Object.defineProperty(input, 'value', { get: () => native.get!.call(input), set: value => { tracked = value; native.set!.call(input, value); } });
        input.addEventListener('input', () => { if (input.value !== tracked) { document.querySelector('output')!.textContent = input.value; tracked = input.value; } });
      });
      const field = (await observe(page)).interactiveElements.find(e => e.role === 'textbox')!;
      expect(await execute(page, 'type', { elementId: field.elementId, value: 'today’s news' })).toMatchObject({ ok: true });
      expect(await page.locator('output').textContent()).toBe('today’s news');
    } finally { await page.close(); }
  });
  it('types into contenteditable, detects unfinished answers, and transfers the complete answer to search', async () => {
    const context = await browser.newContext();
    try {
      const answer = 'Today’s news: Cairo, technology & weather.\nSecond line — copied verbatim.';
      await context.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<div contenteditable="true" aria-label="Message"></div><button id="send">Send</button><script>document.querySelector('#send').onclick=()=>{const stop=document.createElement('button');stop.dataset.testid='stop-button';stop.textContent='Stop';document.body.append(stop);const article=document.createElement('article');article.dataset.messageAuthorRole='assistant';article.textContent='Working';document.body.append(article);setTimeout(()=>{article.innerText=${JSON.stringify(answer)};stop.remove();},250);};</script>` }));
      await context.route('https://www.google.com/**', route => {
        if (new URL(route.request().url()).pathname === '/search') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<main id="search">Search results <a href="https://example.com">News result</a></main>' });
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<form action="/search"><textarea name="q" aria-label="Search"></textarea><button>Google Search</button></form>' });
      });
      const page = await context.newPage(); await page.goto('https://chatgpt.com/');
      let obs = await observe(page); const composer = obs.interactiveElements.find(e => e.role === 'textbox')!;
      expect(await execute(page, 'type', { elementId: composer.elementId, value: 'What is today’s news?' })).toMatchObject({ ok: true });
      expect(await page.locator('[contenteditable]').innerText()).toBe('What is today’s news?');
      expect(await execute(page, 'press_key', { elementId: composer.elementId, key: 'Enter' })).toMatchObject({ needsSubmissionVerification: true });
      obs = await observe(page);
      const send = obs.interactiveElements.find(e => e.name === 'Send')!;
      await execute(page, 'click', { elementId: send.elementId });
      obs = await observe(page); expect(obs.responseState.generating).toBe(true);
      expect(await execute(page, 'capture_text', { elementId: obs.responseState.latestAnswerId!, key: 'answer' })).toMatchObject({ code: 'RESPONSE_GENERATING' });
      await page.locator('[data-testid="stop-button"]').waitFor({ state: 'detached' });
      obs = await observe(page); expect(obs.responseState.generating).toBe(false);
      expect(await execute(page, 'capture_text', { elementId: obs.interactiveElements.find(e => e.name === 'Send')!.elementId, key: 'answer' })).toMatchObject({ code: 'WRONG_ANSWER' });
      const captured = await execute(page, 'capture_text', { elementId: obs.responseState.latestAnswerId!, key: 'answer' }) as any;
      expect(captured.capturedText).toBe(answer);
      await page.goto('https://www.google.com/'); obs = await observe(page);
      const query = obs.interactiveElements.find(e => e.role === 'textbox')!;
      await execute(page, 'paste_text', { elementId: query.elementId, value: captured.capturedText });
      expect(await page.locator('textarea').inputValue()).toBe(answer);
      await execute(page, 'press_key', { elementId: query.elementId, key: 'Enter' }).catch(error => { if (!/Execution context was destroyed/.test(String(error))) throw error; });
      await page.waitForURL('**/search?**');
      expect(new URL(page.url()).searchParams.get('q')?.replace(/\r\n/g, '\n')).toBe(answer);
      expect(await page.locator('main').innerText()).toContain('Search results');
    } finally { await context.close(); }
  });
  it('returns an explicit error for text larger than 32 KiB', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent('<article data-message-author-role="assistant"></article>');
      await page.locator('article').evaluate(el => { el.textContent = 'x'.repeat(32769); });
      const obs = await observe(page);
      expect(await execute(page, 'capture_text', { elementId: obs.responseState.latestAnswerId, key: 'answer' })).toMatchObject({ code: 'TEXT_LIMIT' });
    } finally { await page.close(); }
  });
});
