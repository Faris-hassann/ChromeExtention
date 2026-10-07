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
