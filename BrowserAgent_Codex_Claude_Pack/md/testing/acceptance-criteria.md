# Acceptance Criteria

## Core installation/development

- Frontend runs with `npm run dev`.
- Backend runs with `npm run dev`.
- Extension loads unpacked in current Chrome and Edge development mode.
- Backend binds to local interface by default.
- Side panel clearly reports backend and Ollama status.

## Agent loop

- User can submit natural-language goal.
- Agent receives current browser observation.
- Agent emits one typed tool request.
- Tool request passes schema and policy checks.
- Browser executes action.
- Fresh observation is automatically produced.
- Second meaningful action cannot execute before fresh observation is consumed.

## Page understanding

- Agent can read current page semantic content.
- Agent can identify forms/tables/interactives.
- Agent can use screenshots/vision when semantic data is insufficient.

## Automation

- navigation works
- click/fill/select/keyboard/scroll works
- tabs and popup detection work
- frame and open Shadow DOM interactions work
- source-to-destination field transfer works on mock sites
- files can be downloaded and uploaded through controlled task file tracking

## Control/security

- user can pause/resume/take control/stop
- site permission rules work
- risk approvals work
- malicious page instructions cannot override user/system policy
- LLM cannot request arbitrary executable code
- secret extraction is unavailable

## Recovery/completion

- stale/disappeared elements trigger re-observation and replanning
- recovery is bounded
- max steps is bounded/configurable
- backend disconnect pauses task safely
- completion requires final state verification

## Privacy

- no database exists
- chat/task/page/screenshot history is not persisted
- task memory is destroyed after session/task
- only minimal settings/site permissions/workflows persist
