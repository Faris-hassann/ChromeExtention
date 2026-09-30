# Security — Site Permission Policy

## Rule model

Each rule has:

```text
scope
capabilities[]
duration: once | session | persistent
status: allow | block
```

## Precedence

Suggested:

1. explicit block
2. exact URL rule
3. host rule
4. broader domain rule
5. default prompt

A broader allow may not override an exact block.

## No content persistence

Rules persist configuration only. Never store observed page content with permission records.
