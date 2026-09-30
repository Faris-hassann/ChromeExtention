# LLM — Ollama Provider

## V1 provider

Only Ollama is enabled in V1, behind a generic `LLMProvider` interface.

Default endpoint:

```text
http://127.0.0.1:11434
```

## Required provider capabilities

- health check
- installed-model discovery
- text/agent completion
- structured JSON/schema output when supported
- image/vision request when selected model supports it
- cancellation/timeout
- clear error classification

## Model selection

Settings must show installed Ollama models. Do not force a hard-coded exact model tag.

Roles:

```text
main model: Qwen 7B-class local model
vision model: local Qwen vision-capable model
```

## Failure

If Ollama is unavailable, pause/fail cleanly before browser automation starts and show a guided status in the side panel.
