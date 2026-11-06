import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createApp as createCoreApp, dhakaDate, type CoreOptions } from './core.js';
export { dhakaDate };
type Options = Omit<CoreOptions, 'db' | 'transaction' | 'secret' | 'ownerSetupCode' | 'cloud'> & {
  dbPath?: string;
  secret?: string;
  ownerSetupCode?: string;
  latestApk?: () => string | undefined;
};

/** Local development entry; the hosted entry supplies durable SQL instead. */
export function createApp(input: Options | string = {}) {
  const options = typeof input === 'string' ? { dbPath: input } : input;
  if (process.env.NODE_ENV === 'production') throw new Error('Use the configured cloud entry point for production deployment.');
  const dbPath = options.dbPath ?? resolve('.data/smartshop.sqlite');
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const secretFile = (name: string, bytes: number) => {
    const path = dbPath === ':memory:' ? null : resolve(dirname(dbPath), name);
    if (path && existsSync(path)) return readFileSync(path, 'utf8').trim();
    const value = randomBytes(bytes).toString('hex');
    if (path) writeFileSync(path, value, { mode: 0o600 });
    return value;
  };
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const result = createCoreApp({ ...options, db, secret: options.secret ?? secretFile('session-secret', 48), ownerSetupCode: options.ownerSetupCode ?? process.env.OWNER_SETUP_CODE ?? secretFile('owner-setup-code', 8).toUpperCase() });
  const oldPhoneLinks = ['/downloads/apk', '/downloads/smartshop.apk'];
  const latestLinks = ['/downloads/latest.apk', ...(options.latestApk ? oldPhoneLinks : [])];
  const manualLinks = ['/downloads/phone', ...(options.latestApk ? [] : oldPhoneLinks)];
  result.app.get(latestLinks, (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const apk = options.latestApk?.();
    if (!apk || !existsSync(apk)) {
      res.status(503).json({ error: 'The latest APK is not ready. Wait for the download QR in the Mac terminal.' });
      return;
    }
    res.type('application/vnd.android.package-archive');
    res.download(apk, 'SmartShop-Latest.apk', { cacheControl: false });
  });
  result.app.get(manualLinks, (_req, res) => {
    const apk = resolve('output/SmartShop-Phone.apk');
    if (!existsSync(apk)) { res.status(404).json({ error: 'The phone APK has not been built yet.' }); return; }
    res.download(apk, 'SmartShop-Phone.apk');
  });
  result.app.get('/downloads/usb', (_req, res) => {
    const apk = resolve('output/SmartShop-USB.apk');
    if (!existsSync(apk)) { res.status(404).json({ error: 'The USB phone APK has not been built yet.' }); return; }
    res.download(apk, 'SmartShop-USB.apk');
  });
  return result;
}
