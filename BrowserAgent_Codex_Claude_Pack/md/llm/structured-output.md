# LLM — Structured Output

## Goal

Never parse important browser actions from arbitrary natural-language prose.

Use schema-constrained output where supported.

Example decision:

```json
{
  "type": "tool_request",
  "tool": "click",
  "arguments": {
    "elementId": "el_003"
  },
  "userFacingActivity": "Opening Ahmed Hassan's employee record."
}
```

## Validation

Before policy/execution:

- validate JSON
- validate decision schema
- ensure tool exists
- validate tool arguments
- reject unknown fields if useful for safety
- attach runtime risk metadata from registry; never trust model-provided risk
