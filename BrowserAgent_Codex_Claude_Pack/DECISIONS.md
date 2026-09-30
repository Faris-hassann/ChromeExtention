# Locked Design Decisions — Q1 to Q85

This file records the final decisions from the design-tree/grilling process. Later implementation details may refine code organization, but these business/product decisions must not be silently changed.

## Round 1 — Product foundation (Q1–Q15)

1. Local-first now, architected for future commercial distribution.
2. Chrome + Microsoft Edge.
3. Native side-panel UI.
4. Extension plus lightweight local Node/TypeScript companion.
5. LLM provider abstraction; Ollama enabled first.
6. DOM/accessibility-first understanding + screenshots when required.
7. Viewport + full-page + element screenshots.
8. Predefined typed tools only; no arbitrary LLM-authored executable browser code.
9. Manual / Auto / Always Allow This Website style modes with policy-protected sensitive actions.
10. Broad V1 tool scope for navigation/read/interaction/tabs/forms; protect financial/security/destructive actions.
11. Multi-tab workflows are core.
12. Reuse existing browser-authenticated sessions; user handles login/MFA manually when needed.
13. Local by default; future cloud providers only if explicitly enabled.
14. Originally considered local task history, later overridden by Q67/Q79: **no chat/task history persistence**.
15. Final pack includes specifications + executable TypeScript test contracts.

## Round 2 — Runtime & agent (Q16–Q30)

16. Native Messaging production direction + WebSocket/HTTP development transport.
17. BrowserDriver abstraction with Extension and Playwright drivers.
18. Continuous observe/plan/act/validate loop.
19. High-level plan + dynamic one-step actions; Qwen sees a fresh browser state after each meaningful step.
20. Compact semantic page representation, with raw DOM/HTML available on demand.
21. Semantic locators with structured fallbacks.
22. Temporary semantic element IDs supplied to LLM.
23. Structured ephemeral task memory.
24. Semantic field mapping proposed by Qwen, target validated by executor.
25. Submission behavior depends on permission/risk mode.
26. LOW/MEDIUM/HIGH/CRITICAL risk classification.
27. Page content is untrusted; policy enforced outside model.
28. On failure: re-observe and re-plan, not blind selector retries.
29. Full task state machine.
30. Pause/Resume/Stop/Take Control + user correction during run.

## Round 3 — Perception & tools (Q31–Q45)

31. Rich BrowserObservation including URL/title/semantic DOM/forms/dialogs/diffs/etc.
32. Screenshot after meaningful visual change; skip redundant screenshots.
33. Combine semantic and visual understanding when useful.
34. Maintain full state internally, send important diff + context.
35. Console/network debugging exposed as dedicated tools when needed.
36. Broad tool catalog + controlled tool registry extensibility.
37. Runtime automatically observes after meaningful action.
38. Frame tree support.
39. Open Shadow DOM support in V1.
40. Download + upload with explicit ephemeral file tracking.
41. Prefer task memory over OS clipboard; clipboard tool only when needed/permissioned.
42. New tab/popups are reported and agent decides switching.
43. Manual user browser changes cause re-observation and adaptation.
44. Highlight current element/action and show task activity.
45. Dynamic provider abstraction; V1 uses main Qwen model plus separate local vision-capable model when needed.

## Round 4 — Permissions & UX (Q46–Q60)

46. Site permission choices: once/session/always/block.
47. Exact URL, hostname and domain scopes.
48. Granular read/screenshot/control/file/submit capabilities.
49. Allow Once / Allow Always persisted as configuration.
50. Sensitive website categories receive stronger protection.
51. Chat + task activity + screenshot preview + approval cards.
52. No raw chain-of-thought; concise user-facing activity only.
53. Expandable technical tool activity details.
54. Collapsible latest screenshot preview.
55. Conversation/task model exists ephemerally in-session; later persistence decision is none.
56. Earlier configurable retention decision is superseded by Q67/Q79: no chat/task history retention.
57. Earlier optional saved screenshot setting is superseded by Q79: screenshots are not persisted as history.
58. Structured reusable workflows.
59. Architecture supports future teach-by-demonstration; not MVP blocker.
60. Settings groups: General, AI, Automation, Permissions, Privacy, Developer.

## Round 5 — Codebase & testing (Q61–Q75)

61. One project root with separate `frontend/`, `backend/`, and `md/` specification folders. Frontend is browser extension; backend is local Express service.
62. Coding may use pnpm-compatible tooling, but both apps MUST run via `npm run dev` and must not depend on a root workspace to run.
63. React + TypeScript frontend.
64. Tailwind + lightweight shadcn-style internal component organization.
65. Dev via Node app/CLI; distributable later as background companion.
66. **Express + TypeScript backend** (user override of frameworkless recommendation).
67. **No database. Do not save chat/history/task data.**
68. No ORM.
69. Future provider secrets use OS-secure storage; ordinary nonsecret config may use browser local storage.
70. Development registration scripts + future installer for Native Messaging.
71. Guided Ollama-unavailable state.
72. Discover installed Ollama models dynamically.
73. Structured configurable logs with redaction.
74. Unit + integration + browser E2E + security/adversarial tests.
75. Deterministic mock test websites plus optional real-site smoke tests.

## Round 6 — Final contract (Q76–Q85)

76. Development: `frontend/npm run dev`, `backend/npm run dev`, load unpacked extension.
77. Default `127.0.0.1:3333`, configurable by environment.
78. HTTP/WebSocket MVP first; Native Messaging Phase 2.
79. Do not persist chat/task/page/screenshot/extracted data; only minimal settings/permissions.
80. Reusable workflows may use `chrome.storage.local` + JSON import/export.
81. Max agent steps configurable, default 50.
82. No short overall hard timeout; bounded per-operation timeouts.
83. Backend disconnect pauses task, retries connection, requires safe resumption.
84. Task completes only after final observation verifies user outcome.
85. Generate a comprehensive Codex/Claude pack with MD specs, typed contracts and executable test contracts.
