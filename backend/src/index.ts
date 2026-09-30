import { createServer } from 'node:http';
import { config } from './config.js';
import { createApp } from './server/app.js';

const { app, attachWebSocket } = createApp();
const server = createServer(app); attachWebSocket(server);
server.listen(config.port, config.host, () => console.log(JSON.stringify({ level: 'INFO', message: 'Local Browser Agent backend ready', url: `http://${config.host}:${config.port}`, ollama: config.ollamaUrl, model: config.mainModel })));
