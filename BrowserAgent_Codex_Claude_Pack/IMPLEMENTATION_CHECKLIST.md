# Implementation Checklist

Use this after implementation work begins.

## Bootstrap

- [ ] `frontend/` is real React + TS + Vite MV3 app.
- [ ] `backend/` is real Express + TS app.
- [ ] Both install and run independently.
- [ ] Both support `npm run dev`.
- [ ] No DB dependency exists.

## Connectivity

- [ ] Backend binds locally by default.
- [ ] Health endpoint works.
- [ ] WebSocket connects/reconnects.
- [ ] Ollama status works.
- [ ] Model discovery works.

## Browser observation

- [ ] Semantic snapshot.
- [ ] Element IDs.
- [ ] Tables/forms/dialogs/toasts.
- [ ] Tab/frame state.
- [ ] Screenshot capture.
- [ ] Diffing.

## Agent

- [ ] Structured Qwen decision.
- [ ] One typed tool at a time.
- [ ] Permission/risk check.
- [ ] Automatic fresh observation after meaningful action.
- [ ] Dynamic replanning.
- [ ] Max steps.
- [ ] Bounded recovery.
- [ ] Final verification.

## User control

- [ ] Pause.
- [ ] Resume.
- [ ] Take Control.
- [ ] Stop.
- [ ] User correction during task.

## Advanced browser

- [ ] Multi-tab.
- [ ] Popup/new tab detection.
- [ ] iframe.
- [ ] open Shadow DOM.
- [ ] download/upload.
- [ ] visual fallback.

## Privacy/security

- [ ] No chat/task history persistence.
- [ ] No screenshot/page-data persistence.
- [ ] Prompt-injection tests.
- [ ] No arbitrary code tool.
- [ ] No secret extraction.
- [ ] Logs redacted.

## Testing

- [ ] Contract tests wired.
- [ ] Unit tests green.
- [ ] Integration tests green.
- [ ] E2E mock-site tests green.
- [ ] Security/adversarial tests green.
- [ ] Chrome smoke test.
- [ ] Edge smoke test.
