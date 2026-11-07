import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../server/app.js';
import { getServiceConfig, verifyFirebaseIdToken } from '../server/services.js';

const serviceKeys = ['STORAGE_PROVIDER', 'LOCAL_UPLOAD_DIR', 'FIREBASE_PROJECT_ID', 'FIREBASE_API_KEY', 'FIREBASE_AUTH_DOMAIN', 'FIREBASE_APP_ID', 'FIREBASE_STORAGE_BUCKET', 'FIREBASE_PHONE_ENABLED', 'FIREBASE_USE_APPLICATION_DEFAULT', 'GOOGLE_APPLICATION_CREDENTIALS', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf0QAAAAASUVORK5CYII=', 'base64');

describe('Photo upload storage and permissions', () => {
  let directory: string;
  let fixture: ReturnType<typeof createApp>;
  let server: Server;
  let base: string;
  let owner: string;
  let customer: string;
  let savedEnvironment: Record<string, string | undefined>;

  async function upload(token: string | undefined, bytes: Uint8Array, mimeType = 'image/png', purpose = 'product') {
    const body = new FormData();
    body.append('purpose', purpose);
    body.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), 'product.png');
    const result = await fetch(`${base}/api/uploads`, { method: 'POST', body, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: result.status, body: await result.json() as any };
  }
  beforeEach(async () => {
    savedEnvironment = Object.fromEntries(serviceKeys.map(key => [key, process.env[key]]));
    for (const key of serviceKeys) delete process.env[key];
    directory = await mkdtemp(join(tmpdir(), 'smartshop-upload-'));
    process.env.LOCAL_UPLOAD_DIR = join(directory, 'images');
    fixture = createApp({ dbPath: join(directory, 'uploads.sqlite') });
    server = fixture.app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const login = async (email: string, password: string) => {
      const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      assert.equal(response.status, 200);
      return (await response.json() as { token: string }).token;
    };
    owner = await login('owner@smartshop.local', 'SmartShop@123');
    customer = await login('customer@smartshop.local', 'Customer@123');
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fixture.close();
    await rm(directory, { recursive: true, force: true });
    for (const key of serviceKeys) {
      if (savedEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnvironment[key];
    }
  });

  it('requires staff authentication before accepting upload bodies', async () => {
    assert.equal((await upload(undefined, png)).status, 401);
    assert.equal((await upload(customer, png)).status, 403);
    assert.equal(Number(fixture.db.prepare('SELECT COUNT(*) total FROM uploads').get()!.total), 0);
  });

  it('returns an honest configuration error instead of saving a fake local/cloud URL', async () => {
    const result = await upload(owner, png);
    assert.equal(result.status, 503);
    assert.match(result.body.error, /not configured/i);
    assert.equal(result.body.url, undefined);
    assert.equal(Number(fixture.db.prepare('SELECT COUNT(*) total FROM uploads').get()!.total), 0);
  });

  it('checks actual image bytes, declared types, size and public product purpose', async () => {
    assert.equal((await upload(owner, Buffer.from('<svg onload="alert(1)"></svg>'), 'image/png')).status, 400);
    assert.equal((await upload(owner, png, 'image/jpeg')).status, 400);
    assert.equal((await upload(owner, png, 'image/png', 'receipt')).status, 400);
    const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
    oversized.set(png);
    assert.equal((await upload(owner, oversized)).status, 400);
    assert.equal(Number(fixture.db.prepare('SELECT COUNT(*) total FROM uploads').get()!.total), 0);
  });

  it('allows only the owner to upload an owner profile photo', async () => {
    assert.equal((await upload(undefined, png, 'image/png', 'owner-avatar')).status, 401);
    assert.equal((await upload(customer, png, 'image/png', 'owner-avatar')).status, 403);
    fixture.db.prepare("UPDATE users SET role='staff' WHERE email='customer@smartshop.local'").run();
    assert.equal((await upload(customer, png, 'image/png', 'owner-avatar')).status, 403);
    assert.equal((await upload(customer, png, 'image/png', 'product')).status, 503);
    assert.equal((await upload(owner, png, 'image/png', 'owner-avatar')).status, 503);
    assert.equal(Number(fixture.db.prepare('SELECT COUNT(*) total FROM uploads').get()!.total), 0);
  });

  it('uses the owner-selected shop logo on document downloads', async () => {
    process.env.STORAGE_PROVIDER = 'local';
    assert.equal((await upload(customer, png, 'image/png', 'shop-logo')).status, 403);
    const logo = await upload(owner, png, 'image/png', 'shop-logo');
    const product = await upload(owner, png);
    assert.equal(logo.status, 201);
    const setLogo = (token: string, uploadId: number | null) => fetch(`${base}/api/shop/logo`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId }),
    });
    assert.equal((await setLogo(customer, logo.body.id)).status, 403);
    assert.equal((await setLogo(owner, product.body.id)).status, 400);
    assert.equal((await setLogo(owner, logo.body.id)).status, 200);
    const doc = await fetch(`${base}/api/sales/1/invoice`, { headers: { Authorization: `Bearer ${owner}` } });
    assert.equal(doc.status, 200);
    assert.equal((await doc.json()).shop.logoUrl, logo.body.url);
    assert.equal((await setLogo(owner, null)).status, 200);
    const shop = await fetch(`${base}/api/shop`);
    assert.equal((await shop.json()).logoUrl, null);
  });

  it('stores an owner photo separately from product images only after the provider confirms it', async () => {
    process.env.STORAGE_PROVIDER = 'cloudinary';
    process.env.CLOUDINARY_CLOUD_NAME = 'smartshop-test';
    process.env.CLOUDINARY_API_KEY = 'test-key';
    process.env.CLOUDINARY_API_SECRET = 'test-secret';
    const originalFetch = globalThis.fetch;
    let publicId = '';
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('https://api.cloudinary.com/')) {
        const body = init!.body as FormData;
        publicId = String(body.get('public_id'));
        assert.match(publicId, /^smartshop\/owner-avatars\/\d+\/[a-f0-9-]+$/);
        assert.equal(body.get('overwrite'), 'false');
        assert.equal(body.get('allowed_formats'), 'jpg,png,webp');
        assert.equal(typeof body.get('signature'), 'string');
        return Response.json({ public_id: publicId, secure_url: `https://res.cloudinary.com/smartshop-test/image/upload/${publicId}.png` });
      }
      return originalFetch(input, init);
    };
    try {
      const result = await upload(owner, png, 'image/png', 'owner-avatar');
      assert.equal(result.status, 201);
      assert.equal(result.body.purpose, 'owner-avatar');
      assert.equal(result.body.storage, 'cloudinary');
      const row = fixture.db.prepare('SELECT * FROM uploads WHERE id=?').get(result.body.id)!;
      assert.equal(row.purpose, 'owner-avatar');
      assert.equal(row.storage_path, publicId);
      assert.equal(row.url, result.body.url);
      assert.equal(row.size, png.length);
      assert.equal(Number(row.user_id), 1);
    } finally { globalThis.fetch = originalFetch; }
  });

  it('explicitly stores local photo bytes and serves only their opaque media URL', async () => {
    process.env.STORAGE_PROVIDER = 'local';
    assert.deepEqual(getServiceConfig().storage, { provider: 'local', configured: true });
    const result = await upload(owner, png, 'image/png', 'owner-avatar');
    assert.equal(result.status, 201);
    assert.equal(result.body.storage, 'local');
    assert.match(result.body.url, /^\/api\/media\/[a-f0-9-]{36}$/);
    const row = fixture.db.prepare('SELECT * FROM uploads WHERE id=?').get(result.body.id)!;
    assert.equal(row.provider, 'local');
    assert.equal(row.purpose, 'owner-avatar');
    assert.match(String(row.storage_path), /^[a-f0-9-]{36}\.png$/);
    const imagePath = join(process.env.LOCAL_UPLOAD_DIR!, String(row.storage_path));
    assert.deepEqual(await readFile(imagePath), png);
    assert.equal((await stat(imagePath)).mode & 0o777, 0o600);
    assert.equal((await stat(process.env.LOCAL_UPLOAD_DIR!)).mode & 0o777, 0o700);
    const image = await fetch(`${base}${result.body.url}`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    assert.match(image.headers.get('vary') ?? '', /Origin/i);
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    const nativeImage = await fetch(`${base}${result.body.url}`, { headers: { Origin: 'https://localhost' } });
    assert.equal(nativeImage.status, 200);
    assert.equal(nativeImage.headers.get('access-control-allow-origin'), 'https://localhost');
    assert.match(nativeImage.headers.get('vary') ?? '', /Origin/i);
    assert.deepEqual(Buffer.from(await nativeImage.arrayBuffer()), png);
    assert.equal((await fetch(`${base}/api/media/not-a-photo`)).status, 404);
    assert.equal((await fetch(`${base}/api/media/00000000-0000-4000-8000-000000000000`)).status, 404);
  });

  it('lets a customer upload their own profile photo without giving product or owner-photo access', async () => {
    process.env.STORAGE_PROVIDER = 'local';
    const body = new FormData();
    body.append('purpose', 'profile-avatar');
    body.append('userId', '1'); // Ignored: the authenticated identity owns the image.
    body.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'profile.png');
    const response = await fetch(`${base}/api/uploads`, { method: 'POST', body, headers: { Authorization: `Bearer ${customer}` } });
    assert.equal(response.status, 201);
    const image = await response.json() as any;
    const row = fixture.db.prepare('SELECT * FROM uploads WHERE id=?').get(image.id)!;
    assert.equal(row.purpose, 'profile-avatar');
    assert.equal(Number(row.user_id), 2);
    assert.equal((await upload(customer, png, 'image/png', 'product')).status, 403);
    assert.equal((await upload(customer, png, 'image/png', 'owner-avatar')).status, 403);
  });

  it('never serves traversal paths, symlinks or a file whose bytes no longer match its image metadata', async () => {
    process.env.STORAGE_PROVIDER = 'local';
    const result = await upload(owner, png);
    const row = fixture.db.prepare('SELECT * FROM uploads WHERE id=?').get(result.body.id)!;
    const originalPath = String(row.storage_path);
    fixture.db.prepare('UPDATE uploads SET storage_path=? WHERE id=?').run('../outside-secret', result.body.id);
    assert.equal((await fetch(`${base}${result.body.url}`)).status, 404);
    fixture.db.prepare('UPDATE uploads SET storage_path=? WHERE id=?').run(originalPath, result.body.id);
    const imagePath = join(process.env.LOCAL_UPLOAD_DIR!, originalPath);
    await writeFile(imagePath, '<html>not an image</html>');
    assert.equal((await fetch(`${base}${result.body.url}`)).status, 404);
    await rm(imagePath);
    const secretPath = join(directory, 'outside-secret');
    await writeFile(secretPath, 'Private test value');
    await symlink(secretPath, imagePath);
    const response = await fetch(`${base}${result.body.url}`);
    assert.equal(response.status, 404);
    assert.equal((await response.text()).includes('Private test value'), false);
    assert.equal((await fetch(`${base}/api/media/..%2foutside-secret`)).status, 404);
  });

  it('migrates legacy upload constraints while preserving IDs and product/profile foreign keys', async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fixture.close();
    const databasePath = join(directory, 'uploads.sqlite');
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`PRAGMA foreign_keys=OFF;
      DROP TABLE uploads;
      CREATE TABLE uploads (
        id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),url TEXT NOT NULL,
        storage_path TEXT NOT NULL,original_name TEXT NOT NULL,mime_type TEXT NOT NULL,size INTEGER NOT NULL,
        provider TEXT NOT NULL CHECK(provider IN ('firebase','cloudinary')),
        purpose TEXT NOT NULL DEFAULT 'product' CHECK(purpose IN ('product','owner-avatar')),created_at TEXT NOT NULL
      );
      INSERT INTO uploads VALUES(41,1,'https://example.invalid/product.png','product-path','product.png','image/png',10,'firebase','product','2026-11-05');
      INSERT INTO uploads VALUES(42,1,'https://example.invalid/owner.png','owner-path','owner.png','image/png',10,'cloudinary','owner-avatar','2026-11-05');
      UPDATE products SET upload_id=41 WHERE id=1;
      UPDATE users SET avatar_upload_id=42 WHERE id=1;
      CREATE INDEX uploads_test_user ON uploads(user_id);
    `);
    legacy.close();
    fixture = createApp({ dbPath: databasePath });
    assert.equal(Number(fixture.db.prepare('SELECT COUNT(*) total FROM uploads').get()!.total), 2);
    assert.equal(Number(fixture.db.prepare('SELECT upload_id FROM products WHERE id=1').get()!.upload_id), 41);
    assert.equal(Number(fixture.db.prepare('SELECT avatar_upload_id FROM users WHERE id=1').get()!.avatar_upload_id), 42);
    assert.deepEqual(fixture.db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(Number(fixture.db.prepare('PRAGMA foreign_keys').get()!.foreign_keys), 1);
    assert.equal(fixture.db.prepare("SELECT name FROM sqlite_master WHERE name='uploads_test_user'").get()!.name, 'uploads_test_user');
    const fields = ['users', 'products'].flatMap(table => fixture.db.prepare(`PRAGMA foreign_key_list(${table})`).all());
    assert.equal(fields.some(field => field.table === 'uploads_next'), false);
    server = fixture.app.listen(0, '127.0.0.1'); await once(server, 'listening');
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.STORAGE_PROVIDER = 'local';
    const uploaded = await upload(owner, png, 'image/png', 'profile-avatar');
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.id, 43);
  });

  it('exposes only public config and never infers that phone verification is enabled', async () => {
    assert.deepEqual(getServiceConfig().verification, { provider: null, email: false, phone: false });
    process.env.FIREBASE_PROJECT_ID = 'configured-project';
    process.env.FIREBASE_API_KEY = 'public-browser-key';
    process.env.FIREBASE_AUTH_DOMAIN = 'configured-project.firebaseapp.com';
    process.env.FIREBASE_APP_ID = 'public-app-id';
    process.env.CLOUDINARY_CLOUD_NAME = 'configured-cloud';
    process.env.CLOUDINARY_API_KEY = 'cloud-key';
    process.env.CLOUDINARY_API_SECRET = 'must-never-be-public';
    process.env.STORAGE_PROVIDER = 'cloudinary';
    const result = getServiceConfig();
    assert.equal(result.verification.email, true);
    assert.equal(result.verification.phone, false);
    assert.equal(result.storage.configured, true);
    assert.equal(JSON.stringify(result).includes('must-never-be-public'), false);
    assert.equal(JSON.stringify(result).includes('cloud-key'), false);
    process.env.FIREBASE_PHONE_ENABLED = 'true';
    assert.equal(getServiceConfig().verification.phone, true);
  });

  it('does not treat a client string as verified Firebase identity when no project is configured', async () => {
    await assert.rejects(verifyFirebaseIdToken('not-a-firebase-id-token'), (error: any) => error.status === 503);
  });
});
