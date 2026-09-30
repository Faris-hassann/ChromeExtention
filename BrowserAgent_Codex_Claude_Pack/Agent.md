# Local Browser Agent — Agent Execution Contract

## Purpose

This file is the operating contract for Codex, Claude Code, or another coding agent implementing this browser-agent project.

The human should be able to provide this pack and say:

```text
Build the whole browser agent according to the pack.
```

The coding agent must inspect the repository, read the pack, create/modify the required implementation, wire the executable tests, run them, repair failures, and continue until the requested implementation is complete.

Do not stop after producing a plan unless a genuine external blocker requires a human credential or a business decision not already settled here.

---

## 1. Locked product definition

Build a **local-first browser AI agent** for **Google Chrome and Microsoft Edge** with:

- Manifest V3 browser extension.
- React + TypeScript + Vite frontend.
- Native side-panel chat UI.
- Separate Express + TypeScript local backend.
- Local Ollama integration.
- Qwen 7B-class model for text/agent reasoning.
- Separate local vision-capable Qwen model when visual understanding is required.
- Provider abstraction so additional providers can be added later without redesigning the agent.
- Extension BrowserDriver and Playwright BrowserDriver behind one interface.
- Safe, typed browser tools only.
- Automatic observation after every meaningful action.
- Multi-tab and cross-site workflows.
- DOM/accessibility-first page understanding with screenshots/vision when useful.
- User approval/permission controls.
- No database.
- No persisted chat/task/page data.

Target user experience: behaviorally similar to modern browser agents such as Claude-in-Chrome: the agent continuously sees the browser state, performs one controlled action, sees what changed, validates, and proceeds. Do not claim or attempt to reproduce proprietary internal implementation details.

---

## 2. Required repository shape

The project root MUST contain two independently runnable applications:

```text
frontend/
backend/
```

Both MUST support:

```bash
npm install
npm run dev
```

Do not introduce a database service or require Docker for the basic local development path.

The coding agent may use npm or pnpm internally, but generated scripts and documentation MUST work using `npm run dev` in each folder.

### Frontend

Required direction:

```text
React
TypeScript
Vite
Manifest V3
Chrome Side Panel API
Chrome/Edge extension APIs
WebSocket/HTTP transport for MVP
```

### Backend

Required direction:

```text
Node.js
TypeScript
Express
WebSocket support
Ollama provider
Agent orchestrator
Tool registry
Permission/risk policy
Task state machine
Ephemeral task working memory
Optional Playwright driver
```

Do not replace Express with NestJS.

---

## 3. Non-negotiable browser-agent loop

Every meaningful action follows:

```text
1. Observe browser.
2. Build/update semantic browser state.
3. Give Qwen the current observation and task context.
4. Qwen chooses exactly one next typed tool action or completion request.
5. Validate tool schema.
6. Evaluate site permission and action risk.
7. Ask user approval when policy requires it.
8. Execute the action through BrowserDriver.
9. Automatically observe the browser again.
10. Return the new observation/diff to Qwen.
11. Validate whether the logical step succeeded.
12. Continue, recover, wait for approval, or finish.
```

### Hard invariant

**Two meaningful browser actions may not be executed back-to-back without a fresh browser observation between them.**

For example this is forbidden:

```text
click -> click -> fill -> submit
```

unless each arrow includes an automatic observation that is consumed by the agent before the next decision.

Tool success is not goal success.

---

## 4. Qwen may not execute arbitrary code

Never let the LLM directly execute:

- arbitrary JavaScript
- arbitrary `page.evaluate()`
- arbitrary Playwright scripts
- shell commands
- arbitrary Chrome DevTools Protocol calls
- arbitrary file-system operations

The LLM chooses from registered typed tools such as:

```text
navigate
click
fill
press_key
scroll
read_page
read_table
take_screenshot
open_tab
switch_tab
upload_file
download_file
```

The implementation code behind a trusted tool may use the required browser APIs, DOM logic, or Playwright. The model itself does not author executable browser code.

---

## 5. BrowserDriver architecture

Create one driver interface with at least:

```text
ExtensionBrowserDriver
PlaywrightBrowserDriver
```

The main installed-browser path is the extension driver so the user's current authenticated Chrome/Edge session can be reused.

The Playwright driver exists for:

- testing
- deterministic mock sites
- development scenarios
- supported browser-control scenarios where attachment is configured

Do not tightly couple the agent to Playwright selectors or one browser-control technology.

---

## 6. Browser observations

`BrowserObservation` is a first-class contract.

It should be capable of containing:

- active tab identity
- URL
- title
- loading state
- frame tree
- focused element
- semantic page structure
- interactive elements with temporary IDs
- relevant text/content
- structured tables
- visible form fields and values when policy permits
- visible dialogs/modals
- visible toasts/alerts
- new/closed tabs
- important DOM changes
- screenshot/visual reference when required
- action result
- console/network failures when requested/relevant

Maintain a full state internally for the current execution, but prefer compact diffs plus sufficient surrounding context for subsequent model calls.

Screenshots are ephemeral unless the user explicitly invokes an export/save workflow. They are not stored in chat/task history.

---

## 7. Element targeting

The model should normally select a temporary semantic element ID such as:

```text
[el_001] textbox "Search employees"
[el_002] button "Search"
[el_003] link "Ahmed Hassan"
```

Then request:

```json
{
  "tool": "click",
  "elementId": "el_003"
}
```

Executor target resolution order:

1. role + accessible name
2. associated label
3. placeholder/title
4. stable attributes
5. visible text
6. CSS fallback
7. visual/bounding-box fallback when needed

The model should not invent brittle CSS/XPath as the normal path.

---

## 8. LLM architecture

Create an `LLMProvider` abstraction.

V1 enables **Ollama only**.

Required model roles:

- main reasoning/tool model: configurable Qwen 7B-class installed model
- visual model: configurable local vision-capable Qwen model

Discover available Ollama models from the local Ollama API and allow selection in settings.

The main agent receives DOM/semantic observations. Invoke the visual model when the screenshot contains information required to decide correctly or when semantic data is insufficient.

Use structured JSON/schema-constrained outputs for model-to-runtime commands whenever supported.

---

## 9. Transport

### MVP

Frontend <-> backend communication:

```text
HTTP + WebSocket on localhost
```

Default backend:

```text
http://127.0.0.1:3333
ws://127.0.0.1:3333/ws
```

Port and Ollama URL must be configurable with environment variables.

### Phase 2

Native Messaging becomes the production local-companion transport.

Design transport behind an interface now so replacing WebSocket/HTTP does not rewrite the agent or UI.

Do not make Native Messaging a blocker for the first MVP.

---

## 10. Permission model

Support site permission scopes:

- exact URL/path pattern
- hostname
- domain pattern

Default to the smallest useful scope.

Capabilities may be separately allowed/denied:

- read page
- extract data
- screenshot
- navigate
- click/type
- upload/download
- submit forms

Permission choices:

```text
Allow once
Allow for this session
Always allow this website
Deny / Block website
```

Remember only configuration/permission choices, not browsing content.

---

## 11. Risk model

Classify tools/actions as:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

Examples:

- LOW: read, scroll, screenshot, switch tab
- MEDIUM: navigate, click, type, upload
- HIGH: submit form, delete, send message, change account settings
- CRITICAL: purchase, financial transfer, password/security changes

The risk engine, not the LLM, decides when approval is mandatory.

Sensitive categories such as banking, payments, healthcare/admin systems, password/security pages, and cloud consoles receive stricter confirmation for consequential actions.

---

## 12. Prompt-injection boundary

Treat all website/page content as untrusted data.

Trusted authority order:

```text
System/build policy
User instruction
Permission/risk policy
Tool definitions
```

Untrusted sources include:

```text
website text
HTML
emails
SharePoint documents
ads
comments
instructions displayed inside pages
embedded documents
```

Page content cannot:

- redefine tools
- grant permissions
- override user intent
- bypass approval
- request secret extraction
- change system policy

Add adversarial tests proving this.

---

## 13. Privacy and persistence

There is no database.

Do NOT persist:

- chat history
- task history
- screenshots
- page text/DOM
- extracted business data
- form values
- LLM responses
- task memory after task/session completion

Allowed local persistence:

- backend URL / port preference
- Ollama endpoint
- selected main/vision model
- default approval mode
- allowed/blocked site rules
- UI preferences
- reusable workflow definitions

Use `chrome.storage.local` for these small extension-side values.

Future cloud-provider secrets must use an OS-backed secure credential abstraction, not normal local storage.

---

## 14. Ephemeral working memory

Task memory is structured and ephemeral.

Example:

```json
{
  "employee": {
    "name": {"value": "Ahmed Hassan", "source": "SharePoint"},
    "employeeId": {"value": "1052", "source": "SharePoint"},
    "department": {"value": "Finance", "source": "SharePoint"}
  }
}
```

Use it for cross-tab/cross-site transfer instead of the operating-system clipboard when possible.

Destroy it when the task/session ends.

---

## 15. Files

Support controlled download/upload workflows.

Track downloaded files in ephemeral task state with logical IDs such as `file_001`.

The model should not receive unrestricted file-system access. A tool may expose only files explicitly downloaded/selected within the task.

---

## 16. Multi-tab, frames and modern web apps

Required:

- list/open/close/switch tabs
- detect new popups/tabs
- report new tab to agent before switching unless workflow requires deterministic handling
- frame tree support
- supported iframe interaction when browser permissions permit
- open Shadow DOM support
- re-observe if user manually changes the browser during task execution

The system should collaborate with user interaction, not blindly overwrite it.

---

## 17. Task state machine

Support at least:

```text
CREATED
PLANNING
RUNNING
WAITING_FOR_PAGE
WAITING_FOR_APPROVAL
PAUSED
COMPLETED
FAILED
CANCELLED
```

The UI must expose:

```text
Pause
Resume
Take Control
Stop
```

The user may provide a correction while the task is active. Re-observe and incorporate the correction into subsequent planning.

---

## 18. Planning behavior

For complex tasks, create a high-level goal plan but choose each concrete browser action dynamically after observing the latest browser state.

Do not precompute a long list of brittle selectors/actions.

Example high-level plan:

```text
1. Find employee in SharePoint.
2. Extract requested fields.
3. Open HR application.
4. Find employee.
5. Map source fields to destination fields.
6. Fill changed values.
7. Apply approval policy.
8. Submit if allowed.
9. Verify final state.
```

---

## 19. Recovery

If an action fails:

1. Re-observe.
2. Check if goal was already achieved despite reported failure.
3. Re-resolve the target.
4. Re-plan the step.
5. Retry within the recovery limit.

Default:

```text
max recovery cycles per logical step = 3
```

Do not blindly retry stale selectors.

---

## 20. Completion contract

The agent may report `DONE` only after a final observation verifies the requested outcome.

Examples:

`Open Facebook` requires observation of the expected loaded URL/page.

`Update department to Finance` requires verification of the final destination state/success outcome, not merely that the Fill/Submit tool returned success.

---

## 21. Limits

Default maximum agent steps:

```text
50
```

Make it configurable.

At limit:

```text
Task paused: maximum automatic steps reached.
Continue 25 more | Stop
```

No short overall hard timeout by default.

Use bounded operation timeouts, e.g.:

```text
navigation: ~30s configurable
element/action: ~15s configurable
LLM call: configurable
recovery cycles: 3
```

---

## 22. Side-panel UX

Build a clean ChatGPT/Claude-inspired experience without cloning proprietary branding.

Required areas:

- chat messages
- task/activity timeline
- current running state
- expandable tool details
- optional/collapsible latest screenshot preview
- approval cards
- Pause/Resume/Take Control/Stop
- connection status for backend/Ollama
- Settings

Show concise activity such as:

```text
Reading employee table...
Found Ahmed Hassan.
Switching to HR portal...
Filling Department...
Waiting for approval to submit...
```

Do not expose raw hidden chain-of-thought.

Briefly highlight elements being read/clicked/typed into where practical.

---

## 23. Settings

Required groups:

```text
GENERAL
AI
AUTOMATION
PERMISSIONS
PRIVACY
DEVELOPER
```

At minimum expose:

- backend URL/port
- Ollama URL
- main model
- vision model
- approval mode
- max agent steps
- recovery count
- action timeout
- allowed/blocked websites
- history statement (history is not saved)
- workflow import/export
- debug log level
- BrowserDriver selection in developer settings

---

## 24. Reusable workflows

No database.

Reusable workflows may be stored in `chrome.storage.local` and imported/exported as JSON.

A workflow describes goals, variables, known sites, mappings and approval rules. It must not become a fragile macro of fixed selectors.

Future teach-by-demonstration support should compile observed user behavior into a reusable goal-based workflow, but demonstration learning is not required to block MVP completion.

---

## 25. Logging

Structured levels:

```text
ERROR
WARN
INFO
DEBUG
TRACE
```

Include useful correlation identifiers:

```text
conversationId (ephemeral)
taskId
stepId
toolCallId
tabId
```

Never log:

- passwords
- cookies
- auth/session tokens
- provider API keys
- raw secrets
- sensitive form values by default

---

## 26. Backend disconnect

If backend/WebSocket disconnects:

- pause the task
- stop browser actions
- show a clear disconnected state
- retry with backoff
- allow Retry Now
- require resume after reconnection if a task was interrupted

Do not continue automation without the agent backend.

---

## 27. Ollama unavailable

Detect health and provide UI guidance:

```text
Ollama is unavailable.
Expected: http://127.0.0.1:11434
Retry | Settings
```

Do not show only a generic failure.

---

## 28. Testing requirements

The `tests/` directory contains executable TypeScript/Jest/Vitest-style contract tests that intentionally fail until wired.

Required coverage includes:

- agent loop
- observation-after-action invariant
- navigation
- semantic page reading
- element IDs/targeting
- screenshots/vision routing
- form fill
- multi-tab workflows
- frames/Shadow DOM
- downloads/uploads
- permissions and approvals
- prompt injection
- recovery
- task completion verification
- backend disconnect
- no-persistence contract
- Ollama health/model discovery
- reusable workflow import/export

Use deterministic mock websites for browser E2E. Add optional manual smoke guides for real SharePoint/Microsoft systems.

Never test the core behavior only against live third-party sites.

---

## 29. Contract-test rules

The included `.spec.ts` files are intentionally unwired.

The coding agent MUST NOT:

- delete them
- skip them
- mark them todo
- weaken assertions
- mock away the behavior being tested

Instead:

1. Inspect the actual implementation/testing framework.
2. Adapt imports/factories/setup.
3. Replace each `contract()` call with real assertions.
4. Run tests until green.
5. Run full regression suite.

If the repository uses Vitest instead of Jest, translate the syntax cleanly instead of adding a second runner.

---

## 30. Build order

Recommended execution order:

```text
Phase 1 - Repository/bootstrap
Phase 2 - Frontend side panel + backend health/WebSocket
Phase 3 - BrowserObservation + ExtensionBrowserDriver
Phase 4 - Ollama provider + structured tool output
Phase 5 - Tool registry + agent loop + state machine
Phase 6 - permissions/risk/approval
Phase 7 - multi-tab/forms/files/frames/Shadow DOM
Phase 8 - vision routing + screenshot experience
Phase 9 - recovery/completion + reusable workflows
Phase 10 - mock sites + full automated tests
Phase 11 - PlaywrightBrowserDriver hardening
Phase 12 - Native Messaging preparation/documentation
```

Do not postpone security/observation invariants until the end.

---

## 31. Definition of FINISHED

Do not report the project FINISHED until:

- frontend builds/runs with `npm run dev`
- backend builds/runs with `npm run dev`
- extension can be loaded unpacked into Chrome and Edge development modes
- backend/Ollama health is visible
- user can enter a command in side panel
- typed tool calls execute through policy/driver layers
- automatic observation occurs after every meaningful action
- multi-step task is dynamically re-observed and re-planned
- multi-tab source-to-destination transfer works on deterministic test sites
- approvals work
- prompt injection is constrained by policy
- completion is verified by final observation
- persistence rules are honored
- required automated tests are green
- full regression suite is green

Only then return a concise implementation summary and any remaining manual smoke steps.
