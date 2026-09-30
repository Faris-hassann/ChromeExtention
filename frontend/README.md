# Local Browser Agent extension

```powershell
npm install
npm run build
```

Load `frontend/dist` as an unpacked extension from `chrome://extensions` or `edge://extensions`. During development, `npm run dev` rebuilds on file changes; reload the unpacked extension after a background-script change.

Start the backend first. Open a normal HTTP(S) page, click the extension icon, enter a goal, and approve the browser's per-site access prompt. The extension intentionally stores only settings, site permissions, reusable workflows, and UI preferences—never chats, observations, screenshots, form data, or task memory.
