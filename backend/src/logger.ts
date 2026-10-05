import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const weights: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const sensitiveKey = /password|token|secret|cookie|authorization|apiKey|capturedText|pageText|prompt|content|semanticContent|screenshotRef|value|^title$|^text$|^summary$|^question$/i;

function diagnosticField(key: string, value: unknown, depth: number): unknown {
  if (sensitiveKey.test(key)) return '[REDACTED]';
  if (/url$|^site$/i.test(key) && typeof value === 'string') {
    try { return new URL(value).origin; } catch { return '[REDACTED_URL]'; }
  }
  return sanitizeLogData(value, depth);
}

export function sanitizeLogData(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[MAX_DEPTH]';
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (typeof value === 'string') return value.length > 1000 ? `${value.slice(0, 1000)}…[truncated]` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeLogData(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, diagnosticField(key, item, depth + 1)]));
  return value;
}

export class RotatingFileSink {
  private bytes = 0;
  private initialized = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(readonly path: string, readonly maxBytes: number, readonly retainedFiles: number) {}

  write(line: string) {
    this.queue = this.queue.then(() => this.append(`${line}\n`)).catch(error => {
      console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'ERROR', source: 'backend', event: 'logger.file_write.failed', error: describeError(error) }));
    });
  }

  flush() { return this.queue; }

  private async append(line: string) {
    if (!this.initialized) {
      await mkdir(dirname(this.path), { recursive: true });
      try { this.bytes = (await stat(this.path)).size; } catch { this.bytes = 0; }
      this.initialized = true;
    }
    const size = Buffer.byteLength(line);
    if (this.bytes > 0 && this.bytes + size > this.maxBytes) await this.rotate();
    await appendFile(this.path, line, 'utf8');
    this.bytes += size;
  }

  private async rotate() {
    const retained = Math.max(1, this.retainedFiles);
    if (retained === 1) { await rm(this.path, { force: true }); this.bytes = 0; return; }
    await rm(`${this.path}.${retained - 1}`, { force: true });
    for (let index = retained - 1; index >= 2; index -= 1) {
      const from = `${this.path}.${index - 1}`;
      const to = `${this.path}.${index}`;
      try { await rename(from, to); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    try { await rename(this.path, `${this.path}.1`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    this.bytes = 0;
  }
}

const logPath = fileURLToPath(new URL('../logs/backend.jsonl', import.meta.url));
const sink = new RotatingFileSink(logPath, config.logMaxFileBytes, config.logRetainedFiles);

export function log(level: LogLevel, event: string, details: Record<string, unknown> = {}) {
  const configured = config.logLevel.toLowerCase() as LogLevel;
  const entry = JSON.stringify({ timestamp: new Date().toISOString(), level: level.toUpperCase(), source: 'backend', event, ...sanitizeLogData(details) as Record<string, unknown> });
  sink.write(entry);
  if (weights[level] < (weights[configured] ?? weights.info)) return;
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.log(entry);
}

export const flushLogs = () => sink.flush();
export const describeError = (error: unknown) => error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) };
