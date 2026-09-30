# Backend — Agent Loop

## Loop pseudocode

```text
while task is active:
  enforce max-step limit
  observation = requireFreshObservation()
  context = buildContext(goal, plan, memory, observation, policy)
  decision = qwen.decide(context)

  if decision.type == COMPLETE:
      if verifyGoalFromObservation(decision, observation):
          task -> COMPLETED
      else:
          ask model for next verification/action

  if decision.type == TOOL:
      validate schema
      evaluate permission/risk
      if approval needed:
          task -> WAITING_FOR_APPROVAL
          wait
      execute one tool
      increment step
      mark observation stale
      automatically request observation
      do not allow next tool until fresh observation is received
```

## High-level planning

A complex task may have goals/steps, but selectors and exact actions are chosen only against current browser state.

## Max steps

Default 50. At limit pause; do not automatically fail or loop forever.
