import { createServer } from 'node:http';
import { config } from './config.js';
import { createApp } from './server/app.js';
import { describeError, log } from './logger.js';

const { app, attachWebSocket } = createApp();
const server = createServer(app); attachWebSocket(server);
server.on('error', error => log('error', 'server.failed', { error: describeError(error), host: config.host, port: config.port }));
server.listen(config.port, config.host, () => log('info', 'server.ready', { url: `http://${config.host}:${config.port}`, ollamaUrl: config.ollamaUrl, model: config.mainModel, logLevel: config.logLevel }));
