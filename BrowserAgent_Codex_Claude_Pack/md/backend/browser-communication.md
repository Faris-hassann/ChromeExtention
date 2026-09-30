# Backend — Browser Communication

## MVP transport

Use localhost HTTP/WebSocket.

Default:

```text
http://127.0.0.1:3333
ws://127.0.0.1:3333/ws
```

## Message families

Suggested typed events:

```text
client.hello
client.observation
client.action_result
client.user_control
server.task_state
server.action_request
server.approval_request
server.activity
server.error
```

Every message should carry relevant IDs:

```text
taskId
stepId
toolCallId
observationId
tabId
```

## Ordering

For a meaningful action:

```text
server.action_request
-> client.action_result
-> client.observation (fresh)
-> only then next server.action_request
```

Protect this ordering in runtime and tests.

## Native Messaging phase 2

Implement a transport interface so Native Messaging can replace local WebSocket transport without changing agent/tool contracts.
