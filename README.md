# Local Browser Agent

The repository root is the application workspace:

- `frontend/` — React, TypeScript, Vite, Manifest V3 extension
- `backend/` — Express, WebSocket, TypeScript, Ollama/Qwen service
- `contracts/` — shared reference contracts
- `tests/` — product acceptance contracts
- `BrowserAgent_Codex_Claude_Pack/` — architecture and behavior specifications

## Install and verify

```powershell
npm run install:all
npm run check
```

## Run

```powershell
# Terminal 1
npm run dev:backend

# Terminal 2
npm run dev:frontend
```

Load `frontend/dist` as an unpacked extension from `chrome://extensions` or `edge://extensions`. Ollama must be running at `http://127.0.0.1:11434`; the default model is `qwen2.5:7b`.
