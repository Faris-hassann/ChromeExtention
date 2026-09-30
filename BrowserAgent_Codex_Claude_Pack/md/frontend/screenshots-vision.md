# Frontend — Screenshots & Visual State

## Supported captures

- current viewport
- full scrollable page
- specific element

## Runtime behavior

Capture a lightweight viewport screenshot after meaningful visual changes when useful. Skip redundant capture when no useful visual change occurred.

## Vision routing

Screenshot bytes are sent only to the local backend/Ollama vision path when semantic information is insufficient or visual interpretation is requested/required.

Examples:

- canvas/chart understanding
- visually disabled/overlapped control
- non-semantic custom UI
- screenshot summarization
- visual verification

## Persistence

Do not persist screenshots as chat/task history.
