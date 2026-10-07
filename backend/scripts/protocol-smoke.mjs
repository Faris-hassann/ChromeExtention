import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:3333/ws');
const timer = setTimeout(() => { console.error('Timed out waiting for Azure OpenAI'); process.exit(1); }, 180_000);
let taskId;

ws.on('open', async () => {
  const response = await fetch('http://127.0.0.1:3333/api/agent/tasks', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ goal: 'Open example.com' }),
  });
  const task = await response.json();
  if (!response.ok) { console.error(task.error ?? 'Task creation failed'); clearTimeout(timer); ws.close(); process.exit(1); }
  taskId = task.id;
  console.log('task', task.id, task.state);
  ws.send(JSON.stringify({ event: 'client.observation', taskId: task.id, requestId: task.observationRequestId, payload: { observationId: 'obs_smoke', taskId: task.id, timestamp: new Date().toISOString(), tabId: '1', url: 'https://start.local/', title: 'Start', loadingState: 'complete', interactiveElements: [], semanticContent: 'Blank start page' } }));
});

ws.on('message', data => {
  const message = JSON.parse(data.toString());
  if (message.taskId) console.log(message.event, JSON.stringify(message.payload));
  if (message.event === 'server.approval_request') ws.send(JSON.stringify({ event: 'client.user_control', taskId, payload: { action: 'approve' } }));
  if (message.event === 'server.action_request' && message.payload.tool === 'navigate') {
    ws.send(JSON.stringify({ event: 'client.action_result', taskId, toolCallId: message.toolCallId, payload: { ok: true } }));
  }
  if (message.event === 'server.action_request' && message.payload.tool === 'observe_page') {
    ws.send(JSON.stringify({ event: 'client.observation', taskId, requestId: message.requestId, payload: { observationId: 'obs_verified', taskId, timestamp: new Date().toISOString(), tabId: '1', url: 'https://example.com/', title: 'Example Domain', loadingState: 'complete', interactiveElements: [], semanticContent: 'Example Domain This domain is for use in illustrative examples.' } }));
  }
  if (message.event === 'server.task_state' && message.payload.state === 'COMPLETED') { clearTimeout(timer); ws.close(); process.exit(0); }
  if (message.event === 'server.error') { clearTimeout(timer); ws.close(); process.exit(1); }
});
