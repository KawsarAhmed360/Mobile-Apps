import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../server/app.js';

test('legacy download links wait for and serve the same latest APK as the QR link', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'smartshop-apk-download-'));
  const apkPath = join(directory, 'SmartShop-Latest.apk');
  let latest: string | undefined;
  const fixture = createApp({ dbPath: ':memory:', latestApk: () => latest });
  const server = fixture.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const paths = ['/downloads/latest.apk', '/downloads/apk', '/downloads/smartshop.apk'];
  try {
    for (const path of paths) {
      const pending = await fetch(origin + path);
      assert.equal(pending.status, 503);
      assert.equal(pending.headers.get('cache-control'), 'no-store');
      await pending.json();
    }
    const bytes = Buffer.from('fresh APK fixture');
    await writeFile(apkPath, bytes);
    latest = apkPath;
    for (const path of paths) {
      const response = await fetch(origin + path);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'application/vnd.android.package-archive');
      assert.match(response.headers.get('content-disposition') ?? '', /SmartShop-Latest\.apk/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});
