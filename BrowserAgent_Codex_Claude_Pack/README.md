# Local Browser Agent — Codex / Claude Build Pack

This ZIP is an implementation contract for building a local browser AI agent for **Google Chrome and Microsoft Edge**.

## Run the implementation

The specification pack lives in this subfolder. The frontend and backend are independent applications one level above it, at the repository root.

```powershell
# Terminal 1
cd ..\backend
npm install
npm run dev

# Terminal 2
cd ..\frontend
npm install
npm run dev
```

Then open `chrome://extensions` or `edge://extensions`, enable Developer mode, and load the repository's `frontend/dist` folder unpacked. Open an ordinary HTTP(S) page and click the extension icon. The first task on a site asks for Chrome/Edge site access, and medium/high-risk actions are held for approval.

The default local model is the installed `qwen2.5:7b`. Runtime endpoints and model defaults can be changed with the variables documented in `../backend/.env.example`.

The intended product is a browser extension with a ChatGPT/Claude-style side panel. A user can ask things such as:

```text
Open Facebook.
Summarize this entire page.
Find Ahmed Hassan in SharePoint.
Copy his employee data to the Microsoft HR portal.
Fill these fields and ask me before submitting.
Download the spreadsheet from this page and upload it to the other portal.
```

The browser agent uses a **local Express + TypeScript backend**, connects to **Ollama**, and uses a **Qwen 7B-class local model** for agent reasoning plus a local vision-capable model when screenshot understanding is needed.

## Start here

Any coding agent MUST read, in order:

```text
Agent.md
DECISIONS.md
md/00-project-overview.md
md/01-architecture.md
md/02-development-environment.md
md/03-folder-structure.md
```

Then read every specification relevant to the implementation area before editing code.

## Required target folders

The coding agent creates and maintains:

```text
frontend/   # Chrome/Edge MV3 extension
backend/    # Express + TypeScript local agent service
```

Both MUST run using:

```bash
npm run dev
```

There is **no database**.

## Critical agent rule

The browser automation loop is not a blind script.

After every meaningful browser action, the runtime MUST generate a fresh browser observation and return it to the agent before the agent can choose another meaningful action:

```text
Observe -> Reason -> Tool Request -> Policy Check -> Act
   ^                                              |
   |----------------------------------------------|
                 automatic re-observation
```

A click returning `success` is not proof that the user's goal was achieved.

## Executable contracts

Files under `tests/` are intentionally unwired executable contract tests. They are not placeholders to remove.

The coding agent must:

1. Build the real implementation.
2. Adapt imports/setup to the actual repository.
3. Replace each `contract()` failure with a real executable assertion.
4. Never skip/delete required scenarios just to make tests green.
5. Run targeted tests.
6. Run the full regression suite.
7. Only report FINISHED when the acceptance criteria and tests are satisfied.

## Persistence policy

Do **not** persist:

- chat history
- task history
- screenshots
- page HTML/DOM snapshots
- extracted SharePoint/page data
- form values
- LLM responses
- task working memory after session end

Minimal settings and site-permission choices may use `chrome.storage.local`. Reusable workflows may also be stored there or exported/imported as JSON.
