# Local Browser Agent extension

```powershell
npm install
npm run build
```

Load `frontend/dist` as an unpacked extension from `chrome://extensions` or `edge://extensions`. During development, `npm run dev` rebuilds on file changes; reload the unpacked extension after a background-script change.

The manifest grants permanent access to all HTTP(S) websites. The default **Always allow actions** setting bypasses one-off task approvals, including form submission; Pause and Stop remain available. Approval settings are passed to the backend per task. Browser-internal pages and restrictions set by Chrome remain protected.

Agent actions use Chrome-level mouse and keyboard input. The visible cursor is enabled by default in Settings; short text is typed progressively and long captured text is inserted exactly without using the operating-system clipboard. Chrome may show its standard debugging banner while the agent controls a tab. Pause, Stop, Take control, completion, tab closure, and disconnection release the tab.

Start the backend first. Open a normal HTTP(S) page, click the extension icon, and enter a goal. The extension intentionally stores only settings, site permissions, reusable workflows, and UI preferences—never chats, observations, screenshots, form data, or task memory.

The side panel keeps the latest 500 redacted diagnostic events in memory and sends them to the local backend in bounded batches for rotating local logs. Expand **Diagnostics** in the conversation to inspect or copy the current session timeline.
