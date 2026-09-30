# Frontend — Extension Architecture

## Technology

- Manifest V3
- React + TypeScript
- Vite
- Chrome Side Panel API
- Tailwind CSS
- lightweight reusable component primitives

## Responsibilities

The extension owns:

- side-panel UX
- browser/session awareness
- current tab and tab events
- page observation collection
- semantic element registry
- visual highlighting
- browser action execution for ExtensionBrowserDriver
- site permission prompts/UI
- screenshot acquisition
- transport to backend
- minimal local settings/workflow storage

The extension does **not** own:

- agent planning
- LLM prompts/provider calls
- risk decisions alone
- task planning logic
- long-term history

## Manifest permissions

Use least privilege. Exact required permissions should be justified in code/docs. Likely capabilities may include sidePanel, tabs, scripting, storage and debugger/host permissions depending on implementation.

Do not request unrestricted host access merely for convenience if optional host permission can satisfy the workflow.

## Browser compatibility

Keep Chrome/Edge compatibility at the API boundary. If an API differs, isolate it in adapters.
