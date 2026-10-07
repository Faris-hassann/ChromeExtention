# Local Browser Agent extension

```powershell
npm install
npm run build
```

Load `frontend/dist` as an unpacked extension from `chrome://extensions` or `edge://extensions`. During development, `npm run dev` rebuilds on file changes; reload the unpacked extension after a background-script change.

The manifest grants permanent access to all HTTP(S) websites. The default **Always allow actions** setting bypasses one-off task approvals, including form submission; Pause and Stop remain available. Approval settings are passed to the backend per task. Browser-internal pages and restrictions set by Chrome remain protected.

Agent actions use Chrome-level mouse and keyboard input. The visible cursor is enabled by default in Settings; short text is typed progressively and long captured text is inserted exactly without using the operating-system clipboard. Chrome may show its standard debugging banner while the agent controls a tab. Pause, Stop, Take control, completion, tab closure, and disconnection release the tab.

Configure the four Azure environment variables in `backend/.env`, then restart the backend first. The panel shows Azure OpenAI and its configured deployment; configuration is unverified until an Azure request succeeds. Missing configuration disables task submission. Azure errors stop the task without provider fallback. Refresh Azure status reads backend status without sending model requests. Open a normal HTTP(S) page, click the extension icon, and enter a goal. The extension intentionally stores only settings, site permissions, reusable workflows, and UI preferences—never chats, observations, screenshots, form data, or task memory.

The side panel keeps the latest 500 redacted diagnostic events in memory and sends them to the local backend in bounded batches for rotating local logs. Click **Diagnostics** beside Settings to open a dedicated timeline inside the panel. It shows readable task events, warnings and errors, with task/severity filters, Copy readable logs and Clear. Enable Advanced details to inspect protocol events and redacted technical JSON. Back to task returns to the conversation; navigating views does not pause execution.

Task metrics show session-only usage, returned function calls, model latency and estimated USD cost. Expand request details for each attempt. Pause/resume retains the same totals; completion and Stop retain final accounting, and a new task starts fresh. Connection-test metrics are separate. Configure pricing in backend/.env and restart the backend; rebuild and reload the extension for the updated panel. Metrics are never stored in Chrome storage or diagnostic files.

The updated panel displays estimated prompt tokens separately from actual Azure usage, plan size, model/local/recovery browser-action counts, and budget warnings. A plan still executes one browser action at a time with fresh targets and existing approvals. Task metrics include a Task ID for the read-only live benchmark. Reload the rebuilt extension after this protocol update.


Azure connection details, Test Azure connection, Refresh Azure status, the test reply and greeting metrics are inside Settings. The task view shows only Azure: Connected / Not connected; readiness alone is not verified access, and a backend disconnect makes the indicator Not connected. Testing is explicit and sends one greeting request.

While running, the task view shows only Azure requests sent: N and advisory warnings. When a task completes, pauses, stops, fails, or needs approval or website access, it automatically shows one round summary with the reason, next action, estimated cost and a two-column metrics table. Resume hides the summary and retains cumulative counts. Late accounting updates the same summary without restarting the task. Missing prices/usage remain Unavailable or Partial, and pending accounting is identified. Detailed request data and the task ID are expandable.

After updating, restart the backend, run npm run build from the repository root and reload the extension at chrome://extensions. The new panel and backend should be updated together. Metrics and summaries remain session-only; Settings, logs and task views introduce no extra Azure requests.
