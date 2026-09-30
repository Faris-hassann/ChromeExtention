import cors from 'cors';
import express from 'express';
import type { Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { config } from '../config.js';
import { AgentOrchestrator } from '../agent/orchestrator.js';
import { OllamaProvider } from '../llm/ollama.js';
import type { BrowserObservation, Envelope } from '../types.js';

export function createApp() {
  const app = express(); const ollama = new OllamaProvider();
  app.use(express.json({ limit: '2mb' }));
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || origin.startsWith('chrome-extension://') || origin.startsWith('edge-extension://') || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) }));
  app.get('/health', async (_req, res) => { const status = await ollama.health(); res.status(200).json({ backend: 'healthy', address: `${config.host}:${config.port}`, websocket: 'available', ollama: status.reachable ? 'reachable' : 'unavailable', models: status.models.map(m => m.name), guidance: status.reachable ? undefined : `Start Ollama at ${config.ollamaUrl}` }); });
  app.get('/api/models', async (_req, res) => { const status = await ollama.health(); res.status(status.reachable ? 200 : 503).json(status); });
  app.get('/api/settings/runtime', (_req, res) => res.json({ ollamaUrl: config.ollamaUrl, mainModel: config.mainModel, visionModel: config.visionModel, maxSteps: config.maxSteps, recoveryLimit: config.recoveryLimit }));
  let orchestrator: AgentOrchestrator;
  app.post('/api/agent/tasks', (req, res) => { const goal = typeof req.body?.goal === 'string' ? req.body.goal.trim() : ''; if (!goal) return res.status(400).json({ error: 'goal is required' }); res.status(201).json(orchestrator.create(goal)); });
  app.post('/api/agent/tasks/:id/control', (req, res) => { try { orchestrator.control(req.params.id, req.body?.action); res.json({ ok: true }); } catch (error) { res.status(404).json({ error: (error as Error).message }); } });
  const attachWebSocket = (server: Server) => {
    const wss = new WebSocketServer({ server, path: '/ws' });
    const broadcast = (message: Envelope) => { const data = JSON.stringify(message); for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(data); };
    orchestrator = new AgentOrchestrator(ollama, undefined, broadcast);
    wss.on('connection', socket => {
      socket.send(JSON.stringify({ event: 'server.activity', payload: { message: 'Connected to local agent.' } }));
      socket.on('message', async raw => { try { const msg = JSON.parse(raw.toString()) as Envelope<any>; if (msg.event === 'client.observation' && msg.taskId) await orchestrator.observe(msg.taskId, msg.payload as BrowserObservation); else if (msg.event === 'client.action_result' && msg.taskId) orchestrator.actionResult(msg.taskId, msg.payload); else if (msg.event === 'client.user_control' && msg.taskId) orchestrator.control(msg.taskId, msg.payload.action); } catch (error) { socket.send(JSON.stringify({ event: 'server.error', payload: { message: (error as Error).message } })); } });
      socket.on('close', () => orchestrator.disconnect());
    });
    wss.on('close', () => orchestrator.disconnect());
    return wss;
  };
  // Initialized before requests in startServer; retained for direct test use.
  orchestrator = new AgentOrchestrator(ollama);
  return { app, attachWebSocket, get orchestrator() { return orchestrator; } };
}
