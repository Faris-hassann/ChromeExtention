import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RotatingFileSink, sanitizeLogData } from './logger.js';

const created: string[] = [];
afterEach(async () => { await Promise.all(created.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('diagnostic logging', () => {
  it('retains numeric prompt timing metrics while redacting prompt content', () => {
    expect(sanitizeLogData({ promptEvalCount: 120, promptEvalDurationMs: 3500, prompt: 'private task' })).toEqual({ promptEvalCount: 120, promptEvalDurationMs: 3500, prompt: '[REDACTED]' });
  });
  it('keeps only origins and excludes titles and extracted text from diagnostics', () => {
    expect(sanitizeLogData({ url: 'https://www.google.com/search?q=private-answer', title: 'private prompt', text: 'private answer' })).toEqual({ url: 'https://www.google.com', title: '[REDACTED]', text: '[REDACTED]' });
  });
  it('redacts secrets and large browser payloads', () => {
    const result = sanitizeLogData({ password: 'one', nested: { token: 'two', value: 'three', safe: 'ok' }, screenshotRef: 'data:image' });
    expect(result).toEqual({ password: '[REDACTED]', nested: { token: '[REDACTED]', value: '[REDACTED]', safe: 'ok' }, screenshotRef: '[REDACTED]' });
  });

  it('rotates files while enforcing the retention limit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-agent-log-')); created.push(directory);
    const path = join(directory, 'backend.jsonl'); const sink = new RotatingFileSink(path, 80, 3);
    for (let index = 0; index < 8; index += 1) sink.write(JSON.stringify({ index, text: 'x'.repeat(40) }));
    await sink.flush();
    const files = (await readdir(directory)).sort();
    expect(files).toEqual(['backend.jsonl', 'backend.jsonl.1', 'backend.jsonl.2']);
    expect(await readFile(path, 'utf8')).toContain('"index":7');
  });

  it('reports file write failures without rejecting application logging', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'local-agent-log-error-')); created.push(directory);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sink = new RotatingFileSink(directory, 80, 2); sink.write('{"event":"test"}');
    await expect(sink.flush()).resolves.toBeUndefined(); expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
