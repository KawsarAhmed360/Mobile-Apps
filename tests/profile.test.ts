import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app';

test('keeps profile photos private to each editor while showing linked customer and staff profiles to the owner', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'smartshop-profile-'));
  const oldProvider = process.env.STORAGE_PROVIDER, oldDirectory = process.env.LOCAL_UPLOAD_DIR;
  process.env.STORAGE_PROVIDER = 'local'; process.env.LOCAL_UPLOAD_DIR = dir;
  const fixture = createApp({ dbPath: ':memory:', ownerSetupCode: 'PRIVATE-PROFILE-CODE' });
  const server = fixture.app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (path: string, token?: string, body?: unknown, method = body ? 'POST' : 'GET') => {
    const response = await fetch(base + '/api' + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() as any };
  };
  const photo = async (token: string) => {
    const form = new FormData();
    form.append('purpose', 'profile-avatar');
    form.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBYkAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'profile.png');
    const response = await fetch(base + '/api/uploads', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    assert.equal(response.status, 201); return response.json() as Promise<any>;
  };
  try {
    const owner = (await request('/setup/owner', undefined, { name: 'Test owner', username: 'profileowner', email: 'profile-owner@example.com', password: 'PrivateTestPassword123', setupCode: 'PRIVATE-PROFILE-CODE' })).body;
    const customer = (await request('/auth/register', undefined, { name: 'Test customer', username: 'profilecustomer', email: 'profile-customer@example.com', password: 'PrivateTestPassword123' })).body;
    const other = (await request('/auth/register', undefined, { name: 'Other customer', username: 'profileother', email: 'profile-other@example.com', password: 'PrivateTestPassword123' })).body;
    const asset = await photo(customer.token), otherAsset = await photo(other.token);
    const contact = fixture.db.prepare('SELECT id FROM customers WHERE user_id=?').get(customer.user.id)!;
    fixture.db.prepare('UPDATE customers SET opening_due=12345 WHERE id=?').run(contact.id);
    const update = await request('/auth/profile', customer.token, { name: 'Customer portrait', phone: '01712345678', address: 'Test customer address', avatarUploadId: asset.id }, 'PATCH');
    assert.equal(update.status, 200); assert.equal(update.body.avatarUrl, asset.url); assert.equal(update.body.role, 'customer');
    const ledger = (await request(`/customers/${contact.id}/ledger`, owner.token)).body;
    assert.equal(ledger.customer.avatarUrl, asset.url); assert.equal(ledger.customer.phone, '01712345678');
    assert.equal(ledger.customer.address, 'Test customer address'); assert.equal(ledger.customer.due, 12345);
    assert.equal((await request('/auth/profile', customer.token, { avatarUploadId: otherAsset.id }, 'PATCH')).status, 400);
    assert.equal((await request('/auth/profile', customer.token, { role: 'owner' }, 'PATCH')).status, 400);
    assert.equal((await request('/owner/profile', customer.token, { name: 'Wrong owner' }, 'PATCH')).status, 403);
    const imageResponse = await fetch(base + asset.url); assert.equal(imageResponse.status, 200); assert.equal(imageResponse.headers.get('content-type'), 'image/png');
    assert.equal((await request(`/staff/users/${customer.user.id}`, owner.token, { role: 'staff' }, 'PATCH')).status, 200);
    const staff = (await request('/staff/users?search=profilecustomer', owner.token)).body.items[0];
    assert.equal(staff.avatarUrl, asset.url); assert.equal(staff.role, 'staff');
    assert.equal((await request('/auth/me', customer.token)).body.avatarUrl, asset.url);
    assert.equal((await request('/auth/me', other.token)).body.avatarUrl, null);
    assert.equal((await request('/auth/profile', customer.token, { avatarUploadId: null }, 'PATCH')).body.avatarUrl, null);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); fixture.close();
    if (oldProvider === undefined) delete process.env.STORAGE_PROVIDER; else process.env.STORAGE_PROVIDER = oldProvider;
    if (oldDirectory === undefined) delete process.env.LOCAL_UPLOAD_DIR; else process.env.LOCAL_UPLOAD_DIR = oldDirectory;
    await rm(dir, { recursive: true, force: true });
  }
});
