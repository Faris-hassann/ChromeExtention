# Frontend — Browser Observation

## Goal

Give Qwen enough current browser state to make the next decision without dumping the full page blindly.

## Observation fields

At minimum support:

```text
observationId
timestamp
tabId
url
title
loadingState
focusedElement
frames[]
interactiveElements[]
semanticContent
forms[]
tables[]
dialogs[]
toasts[]
tabEvents[]
diff
screenshotRef (ephemeral)
lastActionResult
```

Optional debugging fields are attached only when needed:

```text
consoleErrors
networkErrors
```

## Semantic element registry

Assign stable-for-the-observation IDs:

```text
el_001
el_002
...
```

Element IDs do not need to survive a major DOM refresh. If stale, re-observe and resolve again.

## Diffing

Track important changes:

- added/removed visible elements
- updated relevant text
- dialog/toast appearance
- navigation/title changes
- tab creation/closure
- form value changes

Do not rely on diff alone; preserve enough context around changes.

## Automatic observation invariant

The transport/orchestrator must reject or queue a second meaningful action if the latest meaningful action does not yet have a completed fresh observation.
