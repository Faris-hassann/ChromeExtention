# Testing Strategy

## Layers

### Unit

- schemas
- state machine
- risk engine
- site-permission matching
- element ID mapping
- workflow schema
- context compaction

### Integration

- Express health/WebSocket
- Ollama health/model discovery
- structured output validation
- tool dispatch
- automatic observation barrier
- browser transport

### Browser E2E

Use deterministic mock sites to test:

- navigation
- page extraction
- table reading
- form filling
- multi-tab transfer
- iframe
- Shadow DOM
- popups
- downloads/uploads
- screenshot/vision path

### Adversarial/security

- prompt injection
- unauthorized domain
- blocked capability
- high-risk approval
- stale element recovery
- action loop prevention
- data persistence checks

## Real-site smoke

Optional/manual tests may cover SharePoint and Microsoft web apps using a developer's own authenticated test environment. Automated CI must not depend on private production credentials.
