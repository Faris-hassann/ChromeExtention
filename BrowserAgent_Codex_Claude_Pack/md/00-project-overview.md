# Project Overview

## Product

A local browser AI agent extension for Chrome and Microsoft Edge.

The user opens a persistent side panel, types a natural-language instruction, and the local agent uses Ollama/Qwen to understand the goal and operate the browser through safe typed tools.

## Primary examples

### Simple navigation

```text
User: Open Facebook.
```

Expected behavior:

1. Observe current tab.
2. Qwen requests `navigate` to Facebook.
3. Runtime checks policy.
4. Browser navigates.
5. Runtime automatically observes again.
6. Agent verifies loaded URL/page.
7. Agent reports completion.

### Cross-system transfer

```text
User: Open SharePoint, find Ahmed Hassan, copy his employee ID, email and department, open the HR system and populate the matching fields. Ask me before submitting.
```

Expected behavior:

1. Reuse the user's existing signed-in browser session.
2. Inspect SharePoint semantically.
3. Extract requested values into ephemeral structured task memory.
4. Open/switch to the target system.
5. Semantically map source fields to destination fields.
6. Populate fields.
7. Show changes and request approval when policy requires it.
8. Submit only after approval.
9. Re-observe and verify the final state.

## Product principles

- Local-first.
- User remains in control.
- Browser state is observed continuously.
- LLM never gets arbitrary code execution.
- Page content is untrusted.
- Security policy is deterministic and outside the model.
- Browser automation is resilient, semantic and observable.
- No database or persistent task/chat history.
