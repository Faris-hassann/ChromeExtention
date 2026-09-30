# Frontend — Site Permissions

## Permission choices

For a site capability request, support:

```text
Allow once
Allow for this session
Always allow this website
Deny
Block website
```

## Scope

Rules may target:

- exact URL/path
- hostname
- domain pattern

Prefer least scope.

## Capabilities

Store capabilities separately where possible:

- read page
- extract data
- screenshot
- navigate
- click/type
- upload/download
- submit

## Storage

Permission configuration may persist in `chrome.storage.local` because it is product configuration, not browsing/task history.

## UI

Permission prompts must identify:

- requested site/scope
- requested capability
- requesting task/action
- risk when relevant
