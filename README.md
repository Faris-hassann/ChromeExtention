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

## Power BI reports

After building, reload the extension from `chrome://extensions` or `edge://extensions`, reopen its side panel, and restart the backend. This build adds the `webNavigation` API permission to discover report frames; the existing HTTP(S) host permissions remain in use.

Open the report at `app.powerbi.com` while signed in with an account that can already edit and save it. Start with a specific request, for example:

> On the Overview page, change the Revenue chart to a bar chart, set its title to Revenue 2026, change its colour to #0000FF, and save the report.

The agent reads visible report content and accessible frame content, uses the report editor, checks the requested title, colour and selected chart-type settings, then watches for save confirmation. The initial editing support covers these three formatting properties. It uses your current browser session; no Microsoft API credentials are required. Power BI Desktop, dashboard tile editing, DAX and model changes are outside this workflow.

If the report editor does not expose a setting or save evidence, the task pauses with an explanation. Pause, Stop and Take control remain available, and the existing approval setting applies to editing actions. Reload the report after a first test edit to check that the changes persist. Never interpret a successful click alone as a verified save.

Automated checks cover editor fixtures, nested cross-origin frames, stale targets, input readback and unsuccessful saves. These checks do not substitute for testing against an authenticated report in your Power BI tenant.

### Finding and clicking table rows

To select the process shown in the Reusable Components Hub, enter:

> Find 848427_business_vois_VCSPricing in the bottom table's Process Name column and click the first matching row.

The agent searches rendered table cells by exact text and column heading, then clicks the matching cell. It does not use the global Power BI/Fabric search field for table rows. Matching cells are prioritized even if the page contains many navigation controls. If the value is not rendered yet, the agent can scroll the table pane and search again. When a name appears twice, the default is the first matching row; specify the month or row occurrence to distinguish duplicates. Row selection uses the reading view and does not require entering the report editor or saving the report.
