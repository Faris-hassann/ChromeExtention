# Backend — Task State Machine

## States

```text
CREATED
PLANNING
RUNNING
WAITING_FOR_PAGE
WAITING_FOR_APPROVAL
PAUSED
COMPLETED
FAILED
CANCELLED
```

## Key transitions

```text
CREATED -> PLANNING -> RUNNING
RUNNING -> WAITING_FOR_PAGE -> RUNNING
RUNNING -> WAITING_FOR_APPROVAL -> RUNNING
RUNNING <-> PAUSED
RUNNING -> COMPLETED
any active -> CANCELLED
recoverable failure -> RUNNING
terminal failure -> FAILED
```

## Take Control

Take Control pauses agent actions but keeps the session alive. After the user is done, Resume triggers a fresh observation before the agent acts again.

## Disconnect

Backend/transport disconnect pauses the task. Never continue actions from stale queued commands after reconnection without fresh state.
