# Backend — Agent Orchestrator

## Responsibilities

- accept a user goal
- create ephemeral task state
- request/receive BrowserObservation
- create/update a high-level plan
- construct model context
- validate structured LLM output
- route a tool request through policy
- dispatch the approved tool to browser transport/driver
- wait for automatic fresh observation
- validate result
- repeat or recover
- verify completion

## One action at a time

The orchestrator must serialize meaningful browser actions per task.

Do not allow model streaming/tool parsing bugs to dispatch multiple actions without intervening observations.

## User corrections

A user message during an active task is a high-priority task update. Pause at a safe boundary, re-observe, update plan/context and continue.
