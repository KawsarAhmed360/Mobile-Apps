import 'dotenv/config';
import { createApp } from './app.js';
import { prepareStartupApk } from './startup-apk.js';

let latestApk: string | undefined;
const startup = new AbortController();
const { app, close } = createApp({ latestApk: () => latestApk });
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';
const server = app.listen(port, host, () => {
  const address = server.address();
  if (!address || typeof address === 'string') return;
  const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  console.log(`SmartShop local API ready at http://${displayHost}:${address.port}`);
  console.log('Provider availability is shown in the app account page. Owner activation code is stored privately under .data/owner-setup-code.');
  if (process.env.SMARTSHOP_STARTUP_APK === '0') return;
  void prepareStartupApk(address.address, address.port, path => { latestApk = path; }, startup.signal).catch(error => {
    if (!startup.signal.aborted) console.error('Latest APK QR unavailable:', error instanceof Error ? error.message : error);
  });
});
server.on('error', error => { console.error('Cannot start SmartShop API:', error.message); process.exitCode = 1; close(); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  startup.abort();
  server.close(() => { close(); process.exit(0); });
  server.closeAllConnections();
});
