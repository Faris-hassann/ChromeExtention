# Local Browser Agent backend

Express/WebSocket companion for the MV3 extension. Tasks, observations, model context and captured text stay in memory and are cleared when tasks end. No database is required.

## Configure Azure OpenAI

The server binds to `127.0.0.1:3333` and loads `backend/.env` automatically. Externally supplied environment variables take precedence. Add these exact names, preserving their spelling:

```dotenv
Azure_openAi_Endpoint=https://YOUR-RESOURCE.openai.azure.com/
Azure_openAI_API_KEY=YOUR-KEY
Azure_openai_deployment_Name=YOUR-DEPLOYMENT-NAME
azure_openai_API_version=YOUR-SUPPORTED-API-VERSION
```

The endpoint must be the HTTPS resource base URL, with no credentials, query string or fragment. Trailing slashes are normalized. Use an existing GPT-5.4 mini deployment and an API version supported by that deployment. The application neither provisions Azure resources nor discovers or substitutes models. Azure credentials are backend-only; the extension does not store them. Existing OpenRouter/Ollama settings are unused.

Requests use `POST {endpoint}/openai/deployments/{encoded-deployment}/chat/completions?api-version={encoded-version}` with the `api-key` header, one required function call, parallel tool calls disabled, `max_completion_tokens`, and no temperature parameter. See [Microsoft API authentication](https://learn.microsoft.com/en-US/azure/cognitive-services/openai/reference) and [GPT request guidance](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/chatgpt?view=foundry-classic).

Optional settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `AZURE_OPENAI_TIMEOUT_MS` | `90000` | Total request deadline |
| `AZURE_OPENAI_MAX_COMPLETION_TOKENS` | `4096` | Completion and reasoning token budget |
| `AGENT_MAX_STEPS` | `50` | Automatic actions per execution window, including read-only tools |

Restart the backend after changing the environment. Run `npm run dev` from this directory, or `npm run dev:backend` from the repository root. Rebuild and reload the unpacked extension after upgrading the application.

## Status and errors

To send a standalone greeting and wait for Azure's reply, run this from the repository root:

```powershell
npm run test:azure --prefix backend
```

The script reads `backend/.env`, sends `hi` once and prints the model's text response. It does not require the backend server or extension to be running. It uses the configured request timeout (90 seconds by default), supports Ctrl+C, and reports safe error categories with a nonzero exit code on failure. It never prints the API key or raw upstream error bodies.

This separate process does not update the running panel's status. Use **Test Azure connection** in the panel to send the same greeting through the running backend. A successful panel test or agent request marks that backend session as available. Verification resets after restarting the backend.

`GET /health` reports backend health independently of Azure configuration. `GET /api/settings/runtime` and `GET /api/models` report safe configuration and the configured deployment. These endpoints never disclose the API key.

`GET /api/providers/azure/status` reports missing/invalid configuration and the last Azure request outcome. It makes no network calls or paid inference requests. Complete configuration is `unverified` until an inference request succeeds; the last failure is `unavailable`, and cancellation returns to `unverified`. Status is not a continuous Azure availability probe. **Test Azure connection** calls `POST /api/providers/azure/test`, sends one `hi` request, shows its reply and records the outcome in this status. Concurrent checks share one request. **Refresh Azure status** reads the recorded result without sending another greeting.

Task creation returns HTTP 503 with missing setting names if configuration is incomplete. Authentication, permissions, deployment, API version, rate limits, timeouts, filtered output and invalid tool decisions produce safe errors and fail the task. No automatic retries or local fallback occur. Fix the issue and submit a new task.

## Execution and diagnostics

Each task has one active decision and one pending browser action. Matching action/observation IDs reject duplicates and stale results. Pause, Stop and disconnect invalidate pending work. Verified completion is terminal; a new submission is required to run again. Three unchanged repetitions pause execution, while automatic-step limits also bound read-only tools and generation waits.

Captured answers are held temporarily and pasted verbatim through `capture_text` / `paste_text`; captures over 32 KiB fail explicitly. Azure receives compact task/page context, with no model access to unrestricted browser code or the filesystem.

Redacted JSONL diagnostics are written to `backend/logs/backend.jsonl`, rotated at 5 MiB and limited to five files. `LOG_LEVEL` controls console verbosity. Keys, upstream error bodies, cookies, page text, screenshots and form values are excluded from provider diagnostics.

## Azure usage and estimated cost

Each submitted task is one round, including pause/resume. The panel shows request count, input/output/total tokens, optional reasoning and cached-input tokens, returned function calls, total/average model latency, models/deployments, and estimated USD cost. Expand Request details to inspect each attempt, including failures and cancellations. Browser-only follow-ups are not model requests. Reasoning and cached tokens are subsets, not extra tokens to add to the total. Model latency excludes browser actions and approvals.

Configure your own Azure prices per million tokens in backend/.env:

```dotenv
AZURE_OPENAI_INPUT_USD_PER_MILLION=
AZURE_OPENAI_CACHED_INPUT_USD_PER_MILLION=
AZURE_OPENAI_OUTPUT_USD_PER_MILLION=
```

Blank, invalid, or negative rates leave the estimate unavailable; explicit zero rates are supported. Cost is ((input - cached) * inputRate + cached * cachedRate + output * outputRate) / 1,000,000. Unknown cache usage permits estimation only when input and cached rates are equal. Reasoning tokens are included in output pricing. This is a configurable estimate, not Azure invoice reconciliation. Missing measurements display Unavailable; totals containing unknown measurements display Partial.

Restart the backend after changing rates, run npm run build from the repository root, and reload the extension at chrome://extensions. Task and request metrics remain in memory for this backend session and are not stored in extension storage or diagnostic files. Completion preserves the displayed totals; submitting another task replaces them. Greeting tests have separate metrics and do not affect task totals. The standalone npm run test:azure --prefix backend script prints its request metrics on success or failure.

GET /api/agent/tasks/:id/metrics returns request records, aggregates, pricing readiness and revision (404 for an unknown task). The server.task_metrics WebSocket event sends revised snapshots after registration and settlement. The panel ignores stale revisions and retrieves the snapshot on reconnect. POST /api/providers/azure/test includes a separate metrics snapshot for greeting requests in the current session.

## Compact planning and local workflows

Azure receives a compact execute_plan interface, short target refs, at most 25 ranked controls, 120-character labels, 500 characters of nearby text and three successful-action summaries. The o200k_base token estimator includes messages and schemas with a framing allowance; estimates differ from authoritative Azure usage. Required instructions and verification remain intact. Context expands with an explanation when essentials exceed the compact target; oversized essential context asks you to split the task instead of silently truncating it.

Plans contain up to six actions. Each executes separately through existing approvals and fresh observations; refs are matched to current elements within their document, frame and widget. Unknown or ambiguous targets require replanning. Confirmed STALE_ELEMENT failures get one local retry; successful actions and uncertain failures are not replayed locally. Pause discards pending plans, and Resume requires fresh validation. Completion and Stop remain terminal. Plan state and page evidence are ephemeral.

Explicit URL navigation, uniquely labelled field updates, Google search, and single-process Power BI workflows can run with zero model calls. Complex or ambiguous tasks use GPT. Power BI selects between process cells and scoped filter/slicer controls; it never uses global search to filter a process. A selected cell alone verifies selection, not filtering. Applied filter state or changed related visual data is required for filtering. Pending Apply controls are not treated as applied filters. When a route fails to verify, the workflow tries the other route once, undoing only a confirmed selection it introduced. Preexisting or uncertain selections are preserved. Ambiguity or unsupported controls go back to the model or prompt the user.

Optional backend environment settings:

| Setting | Default | Behavior |
| --- | --- | --- |
| AGENT_CONTEXT_TARGET_TOKENS | 1500 | Compact per-request estimated input target |
| AGENT_CONTEXT_MAX_TOKENS | 3000 | Expanded essential-context limit |
| AGENT_WARN_LLM_REQUESTS | 2 | Advisory request threshold per task |
| AGENT_WARN_INPUT_TOKENS | 1500 | Advisory actual input-token threshold per task |
| AGENT_WARN_COST_USD | 0.0011 | Advisory cost threshold, when usage/prices are known |

Budget warnings appear once per threshold and continue execution. They do not override automatic-step or no-progress pauses. Existing AZURE_OPENAI_MAX_COMPLETION_TOKENS is unchanged. Restart the backend after editing settings; run npm run build at the repository root and reload the extension.

The panel and metrics API distinguish model/local/recovery browser actions and show estimated prompt tokens, returned plan size and warnings. An execute_plan reply is one returned function call even when it contains several browser actions. Greetings remain separate. No metrics or plans are persisted.

### Opt-in live benchmark

Run the dashboard task yourself, copy its Task ID from Task metrics, then run:

```powershell
npm run benchmark:task --prefix backend -- --task-id YOUR_TASK_ID
```

This script only reads current-session metrics; it never starts a browser task or paid model request. It compares actual request/token counts with the earlier baseline of 4 requests and 12,831 input tokens, and reports latency, estimated cost and input-token reduction. For partial usage or pending requests it leaves the reduction unavailable. The initial goal is 0-2 calls and roughly 500-1,500 total input tokens for simple tasks; 90% savings remains a benchmark target, not a promise for all pages. Live cost comparison requires your actual Azure prices.


Task-state WebSocket events and GET /api/agent/tasks/:id/metrics now include an optional reason object (code, message, nextAction) alongside state. Reasons explain completion, pauses, manual stops, approval/input requirements, connection loss, failed verification, execution limits and errors. They are cleared when execution continues and retained after termination. Accounting may still settle later; that does not alter terminal task state. The extension presents these as automatic round summaries rather than inferring stop reasons from log text. Restart the backend and rebuild/reload the extension together for this update.
