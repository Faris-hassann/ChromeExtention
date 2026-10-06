import cors from 'cors';
import express from 'express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { config } from '../config.js';
import { AgentOrchestrator } from '../agent/orchestrator.js';
import { OllamaProvider } from '../llm/ollama.js';
import { FallbackProvider } from '../llm/provider.js';
import { openRouterStatus } from '../llm/openrouter-status.js';
import type { BrowserObservation, Envelope } from '../types.js';
import { describeError, log, type LogLevel } from '../logger.js';

const diagnosticEventSchema = z.object({
  timestamp: z.string().max(64), level: z.enum(['debug', 'info', 'warn', 'error']), source: z.enum(['sidepanel', 'background', 'backend']), event: z.string().min(1).max(200), details: z.unknown().optional(),
}).strict();
const diagnosticBatchSchema = z.object({ events: z.array(diagnosticEventSchema).max(100) }).strict();

export function createApp() {
  const app = express(); const ollama = new OllamaProvider();
  app.use((req, res, next) => { const requestId = randomUUID(); const startedAt = performance.now(); log('info', 'http.request.started', { requestId, method: req.method, path: req.path, origin: req.headers.origin }); res.on('finish', () => log(res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', 'http.request.completed', { requestId, method: req.method, path: req.path, status: res.statusCode, durationMs: Math.round(performance.now() - startedAt) })); next(); });
  app.use(express.json({ limit: '2mb' }));
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || origin.startsWith('chrome-extension://') || origin.startsWith('edge-extension://') || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) }));
  app.get('/health', async (_req, res) => { const status = await ollama.health(); res.status(200).json({ backend: 'healthy', address: `${config.host}:${config.port}`, websocket: 'available', llmProvider: config.llmProvider, primaryModel: config.openrouterModel, openrouterConfigured: !!config.openrouterApiKey, fallbackAvailable: status.reachable, ollama: status.reachable ? 'reachable' : 'unavailable', models: status.models.map(m => m.name), guidance: status.reachable ? undefined : `Start Ollama at ${config.ollamaUrl}` }); });
  app.get('/api/models', async (_req, res) => { const status = await ollama.health(); res.status(status.reachable ? 200 : 503).json(status); });
  app.get('/api/providers/openrouter/status', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await openRouterStatus.status(req.query.refresh === 'true'));
  });
  app.get('/api/settings/runtime', (_req, res) => res.json({ llmProvider: config.llmProvider, openrouterModel: config.openrouterModel, openrouterConfigured: !!config.openrouterApiKey, openrouterTimeoutMs: config.openrouterTimeoutMs, openrouterCooldownMs: config.openrouterCooldownMs, openrouterMaxTokens: config.openrouterMaxTokens, ollamaUrl: config.ollamaUrl, mainModel: config.mainModel, visionModel: config.visionModel, maxSteps: config.maxSteps, recoveryLimit: config.recoveryLimit, llmTimeoutMs: config.llmTimeoutMs, llmAttemptTimeoutMs: config.llmAttemptTimeoutMs, ollamaKeepAlive: config.ollamaKeepAlive, ollamaNumCtx: config.ollamaNumCtx, ollamaNumPredict: config.ollamaNumPredict }));
  app.post('/api/diagnostics/events', (req, res) => {
    if (Buffer.byteLength(JSON.stringify(req.body ?? null)) > 128 * 1024) return res.status(413).json({ error: 'Diagnostic batch exceeds 128 KiB', stage: 'http.diagnostics.size' });
    const parsed = diagnosticBatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid diagnostic batch', stage: 'http.diagnostics.validation', detail: parsed.error.issues });
    for (const event of parsed.data.events) log(event.level as LogLevel, `client.${event.event}`, { clientTimestamp: event.timestamp, clientSource: event.source, details: event.details });
    return res.json({ ok: true, accepted: parsed.data.events.length });
  });
  let orchestrator: AgentOrchestrator;
  app.post('/api/agent/tasks', (req, res) => { const goal = typeof req.body?.goal === 'string' ? req.body.goal.trim() : ''; if (!goal) return res.status(400).json({ error: 'goal is required', stage: 'http.create_task' }); const approvalMode = req.body?.approvalMode ?? 'auto'; if (!['auto', 'manual', 'always'].includes(approvalMode)) return res.status(400).json({ error: 'Invalid approval mode' }); res.status(201).json(orchestrator.create(goal, approvalMode)); });
  app.post('/api/agent/tasks/:id/control', (req, res) => { try { orchestrator.control(req.params.id, req.body?.action); res.json({ ok: true }); } catch (error) { log('error', 'http.task_control.failed', { taskId: req.params.id, action: req.body?.action, error: describeError(error) }); res.status(404).json({ error: (error as Error).message, stage: 'http.task_control' }); } });
  const attachWebSocket = (server: Server) => {
    const wss = new WebSocketServer({ server, path: '/ws' });
    const broadcast = (message: Envelope) => { const data = JSON.stringify(message); const recipients = [...wss.clients].filter(client => client.readyState === WebSocket.OPEN); log('debug', 'websocket.broadcast', { event: message.event, taskId: message.taskId, toolCallId: message.toolCallId, recipientCount: recipients.length }); for (const client of recipients) client.send(data); };
    orchestrator = new AgentOrchestrator(new FallbackProvider(undefined, ollama), undefined, broadcast);
    wss.on('connection', socket => {
      const connectionId = randomUUID();
      log('info', 'websocket.connected', { connectionId, clientCount: wss.clients.size });
      socket.send(JSON.stringify({ event: 'server.activity', payload: { message: 'Connected to local agent.' } }));
      socket.on('message', async raw => { let msg: Envelope<any> | undefined; try { msg = JSON.parse(raw.toString()) as Envelope<any>; log('debug', 'websocket.message.received', { connectionId, event: msg.event, taskId: msg.taskId, toolCallId: msg.toolCallId, byteLength: raw.toString().length }); if (msg.event === 'client.observation' && msg.taskId) await orchestrator.observe(msg.taskId, msg.payload as BrowserObservation); else if (msg.event === 'client.action_result' && msg.taskId) orchestrator.actionResult(msg.taskId, msg.payload); else if (msg.event === 'client.user_control' && msg.taskId) orchestrator.control(msg.taskId, msg.payload.action); else throw new Error(`Unsupported or incomplete WebSocket event: ${msg.event}`); } catch (error) { const failure = describeError(error); log('error', 'websocket.message.failed', { connectionId, event: msg?.event, taskId: msg?.taskId, error: failure }); socket.send(JSON.stringify({ event: 'server.error', taskId: msg?.taskId, payload: { message: failure.message, stage: 'websocket.message', detail: failure } })); } });
      socket.on('error', error => log('error', 'websocket.client.error', { connectionId, error: describeError(error) }));
      socket.on('close', (code, reason) => { log('warn', 'websocket.disconnected', { connectionId, code, reason: reason.toString() || 'No reason supplied', clientCount: wss.clients.size }); orchestrator.disconnect(); });
    });
    wss.on('error', error => log('error', 'websocket.server.error', { error: describeError(error) }));
    wss.on('close', () => { log('warn', 'websocket.server.closed'); orchestrator.disconnect(); });
    return wss;
  };
  // Initialized before requests in startServer; retained for direct test use.
  orchestrator = new AgentOrchestrator(new FallbackProvider(undefined, ollama));
  return { app, attachWebSocket, get orchestrator() { return orchestrator; } };
}
