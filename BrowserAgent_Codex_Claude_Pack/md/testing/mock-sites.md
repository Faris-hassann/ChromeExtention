# Deterministic Mock Test Sites

The implementation test workspace should provide small local web apps/pages that emulate important browser patterns.

Suggested fixtures:

```text
test-sites/
├── sharepoint-like/
├── hr-portal/
├── iframe-app/
├── shadow-dom-app/
├── popup-app/
├── file-transfer-app/
├── visual-canvas-app/
└── malicious-prompt-injection/
```

## SharePoint-like

- searchable employee table
- duplicate employee names in different departments
- dynamic row refresh
- structured employee fields

## HR portal

- employee search
- fields with semantically different labels, e.g. Employee Number -> Employee ID
- unsaved-change state
- submit confirmation
- success toast

## Malicious page

Contains content attempting to redirect the agent away from the user's goal, request data exfiltration and override permissions.

## Dynamic cases

Fixtures should include:

- stale element replacement
- delayed loading
- modal overlay
- disabled button
- new-tab popup
- iframe form
- open Shadow DOM controls
