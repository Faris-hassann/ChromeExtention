# Frontend — Side Panel UX

## Layout

The side panel should contain:

1. Header: connection/model/task status + Settings.
2. Scrollable conversation/activity region.
3. Current task timeline.
4. Collapsible latest screenshot/visual preview.
5. Approval cards.
6. Controls: Pause, Resume, Take Control, Stop.
7. Composer: user prompt + send.

## Message behavior

Show user instructions and concise assistant messages. Do not display raw hidden reasoning.

## Activity examples

```text
Reading employee table...
Found Ahmed Hassan.
Opening HR portal...
Mapping Employee Number -> Employee ID...
Filling Department...
Waiting for approval to submit...
```

## Approval card

Must show enough context for meaningful consent:

```text
Action: Submit HR employee update
Site: hr.example.com
Risk: HIGH
Changes:
- Department: Sales -> Finance
- Work Email: old@example.com -> new@example.com

Approve once | Deny
```

When relevant, allow site permission upgrade separately from action approval.

## Connection states

Clearly render:

- backend connected/disconnected/reconnecting
- Ollama reachable/unreachable
- selected models
- task paused/waiting/running/failed/completed

## Current screenshot

Screenshot preview is collapsible and ephemeral. Do not build a screenshot history gallery.
