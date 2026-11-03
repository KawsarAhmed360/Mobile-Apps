import { createApp } from './app.js';

const { app, close } = createApp();
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
const server = app.listen(port, host, () => {
  console.log(`SmartShop local API ready at http://${host}:${port}`);
  console.log('Local development mode. Email/SMS verification, AI, cloud storage and Crystal Reports are not configured.');
});
server.on('error', error => { console.error('Cannot start SmartShop API:', error.message); process.exitCode = 1; close(); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  server.close(() => { close(); process.exit(0); });
  server.closeAllConnections();
});
