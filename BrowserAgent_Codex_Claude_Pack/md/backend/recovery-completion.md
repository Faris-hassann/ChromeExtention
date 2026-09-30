# Backend — Recovery & Completion

## Recovery

On an unexpected action result:

1. force fresh observation
2. determine if goal/step already succeeded
3. detect stale/missing target
4. re-plan against current state
5. retry within recovery budget

Default recovery budget: 3 cycles per logical step.

## Completion

Never equate tool success with user-goal success.

A `COMPLETE` model decision must be validated against current browser state.

Examples:

### Navigate

Require URL/page observation consistent with requested destination.

### Form update

Require final value/success state after submit where observable.

### Extraction

Require that requested values were found and can be surfaced/used.

If completion cannot be verified, report uncertainty or request user review rather than asserting success.
