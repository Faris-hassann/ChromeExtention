# Local Browser Agent

The repository root is the application workspace:

- `frontend/` — React, TypeScript, Vite, Manifest V3 extension
- `backend/` — Express, WebSocket, TypeScript, OpenRouter with Ollama/Qwen fallback
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

Load `frontend/dist` as an unpacked extension from `chrome://extensions` or `edge://extensions`. Copy `backend/.env.example` to `backend/.env` and configure `OPENROUTER_API_KEY` there for free cloud decisions; without a key, decisions use Ollama immediately. Restart the backend after changing `.env`. Keep Ollama running at `http://127.0.0.1:11434` for local fallback; its default model is `qwen2.5:7b`.

OpenRouter receives the task and compact page context when enabled. The key stays exclusively in the backend. See [backend configuration](backend/README.md).

After a build, reload the unpacked extension, then reopen its side panel. The panel verifies its build version against the running background worker and blocks automation if they differ.

The extension now has permanent HTTP(S) host access and defaults to **Always allow actions**, including typing, clicks, navigation and form submission. Tasks do not require one-off approval clicks. Pause and Stop remain available. This means the extension can read and interact with every HTTP(S) website; only start tasks you trust. Settings can restore approval prompts. Chrome still protects internal browser pages, and any site restrictions you apply in Chrome remain effective. If host access is withheld, the recovery control preserves the task while access is resolved.

Agent interactions use Chrome-level mouse and keyboard input. A visible cursor and click indicator are enabled by default, short text is typed progressively, and long transferred text is inserted exactly without using the system clipboard. Chrome may show its standard debugging banner while a task controls a tab. Pause, Stop, Take control, completion, tab closure, and disconnection detach the input controller.

Copy/paste automation uses ephemeral task memory, not the operating-system clipboard. `capture_text` retains up to 32 KiB and `paste_text` transfers it verbatim. A ChatGPT-to-Google task is complete only when visible Google results and the exact search query are verified. Diagnostic URLs contain only origins, not search queries or captured answers.
