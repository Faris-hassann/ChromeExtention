# Backend — Express + TypeScript

## Required

The backend is a local Express application.

Must support:

```bash
npm install
npm run dev
```

## Default endpoints

Suggested:

```text
GET  /health
GET  /api/models
GET  /api/settings/runtime
POST /api/agent/tasks
POST /api/agent/tasks/:id/control
WS   /ws
```

Exact REST paths may be adapted, but transport responsibilities must remain clean.

## Health

Return backend status, Ollama status and model-discovery status without leaking secrets.

## CORS/network

Bind to `127.0.0.1` by default, not all interfaces.

Validate Origin/extension identity as appropriate. Do not expose a permissive LAN automation API by default.
