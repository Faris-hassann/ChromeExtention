# Security — Approval Engine

## Modes

Support user-configurable behavior such as:

```text
Manual
Auto normal actions
Always allow permitted actions on this website
```

The label can be refined in UX, but semantics must be deterministic.

## Approval rules

- LOW may proceed under allowed site permission.
- MEDIUM depends on mode/site capability.
- HIGH generally requires an explicit approval unless a narrowly defined prior rule permits it.
- CRITICAL always requires strong explicit approval and may remain unsupported in MVP.

Never let the model suppress an approval request.

## Approval details

Show action, site, risk and relevant changes/arguments without exposing secrets.
