# Security — Secrets & Privacy

## No secret scraping

Do not expose tools to extract:

- browser cookies
- auth tokens
- stored passwords
- session secrets
- browser credential store

## Existing signed-in sessions

The agent operates inside the user's current authenticated tabs. The user performs login/MFA when required.

## Future cloud providers

If cloud providers are added later, API keys must use an OS-secure credential abstraction where possible.

## Logs

Redact secrets and sensitive values. Logging should default to metadata and action summaries, not full form/page contents.

## No history

Browser observations, task memory and screenshots are ephemeral and destroyed at session/task completion.
