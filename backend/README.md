# Local Browser Agent backend

Express/WebSocket companion for the MV3 extension. Task state, observations, files, model responses, and extracted data exist only in memory and are cleared when tasks end; there is no database.

```powershell
npm install
npm run dev
```

The server binds to `127.0.0.1:3333` and uses `qwen2.5:7b` at local Ollama by default. Copy `.env.example` values into your environment to override them. Check `GET /health` before loading the extension.
