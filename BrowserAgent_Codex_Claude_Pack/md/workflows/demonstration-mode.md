# Workflows — Future Teach-by-Demonstration

This is an architectural compatibility requirement, not an MVP blocker.

Future behavior:

```text
User: Watch me do this once.
User performs browser workflow.
Agent observes semantic actions.
System proposes a reusable goal-based workflow.
User reviews/edits/saves it.
```

Do not save a brittle raw replay macro as the primary representation.

The current event/observation/tool abstractions should make it possible to later record semantic demonstrations without redesigning the core.
