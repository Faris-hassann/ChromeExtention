# Architecture

## MVP

```text
Chrome / Edge
┌────────────────────────────────────────────────────────────┐
│ Web pages                                                  │
│   ▲                                                        │
│   │ ExtensionBrowserDriver                                 │
│   ▼                                                        │
│ MV3 Extension                                              │
│ ├─ Side Panel React UI                                     │
│ ├─ Content scripts / browser APIs                          │
│ ├─ Observation collector                                   │
│ ├─ Element highlighter                                     │
│ └─ HTTP/WebSocket transport                                │
└──────────────────────────────┬─────────────────────────────┘
                               │ localhost
                               ▼
Express + TypeScript Backend
├─ WebSocket/HTTP transport
├─ Agent orchestrator
├─ Task state machine
├─ Ephemeral working memory
├─ Tool registry
├─ Permission/risk engine
├─ LLM provider abstraction
├─ Ollama provider
├─ PlaywrightBrowserDriver (optional/test/dev path)
└─ Structured/redacted logging
                               │
                               ▼
                         Ollama localhost
                         ├─ Main Qwen model
                         └─ Vision Qwen model
```

## Dependency direction

The LLM does not import or call browser APIs.

```text
LLM -> ToolRequest -> ToolRegistry -> Policy -> BrowserDriver -> Browser
                                                   |
                                                   v
                                            BrowserObservation
                                                   |
                                                   v
                                                  LLM
```

## Driver rule

Both drivers implement one shared behavioral interface. Agent code must not branch on DOM selectors or Playwright implementation details.

## Future transport

Native Messaging is Phase 2. Replace only the transport boundary, not the agent/tool/browser architecture.
