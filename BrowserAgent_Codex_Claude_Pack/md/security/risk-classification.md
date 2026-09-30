# Security — Risk Classification

## Levels

### LOW

Read-only or reversible navigation/state inspection.

Examples: read, screenshot, scroll, switch tab.

### MEDIUM

Actions that modify UI state or transfer files/data but are not normally consequential by themselves.

Examples: navigate, click, type, select, upload.

### HIGH

Actions that commit an external side effect or meaningful record change.

Examples: submit form, send message, delete, change account settings.

### CRITICAL

Financial/security/identity-impact actions.

Examples: purchase, financial transfer, password/security changes.

## Rules

Risk is registry/policy metadata, not an LLM opinion.

Sensitive-site category may increase required confirmation.
