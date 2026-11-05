import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../server/app.js';
import type { VerifiedFirebaseIdentity } from '../server/services.js';

test('verified signup binds Firebase identity and contact fields before creating an app account', async () => {
  const config = {
    FIREBASE_API_KEY: 'test-public-config',
    FIREBASE_AUTH_DOMAIN: 'fixture.firebaseapp.com',
    FIREBASE_PROJECT_ID: 'fixture',
    FIREBASE_APP_ID: 'fixture-app',
    FIREBASE_PHONE_ENABLED: 'false',
  };
  const before = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  Object.assign(process.env, config);
  const email = 'new-customer@example.test';
  const token = (value: string) => value.padEnd(60, '_');
  const claims = new Map<string, VerifiedFirebaseIdentity>([
    [token('unverified'), { uid: 'uid-1', email, emailVerified: false, phone: null }],
    [token('wrong-email'), { uid: 'uid-2', email: 'different@example.test', emailVerified: true, phone: null }],
    [token('verified-email'), { uid: 'uid-1', email, emailVerified: true, phone: null }],
    [token('duplicate-uid'), { uid: 'uid-1', email: 'changed@example.test', emailVerified: true, phone: null }],
    [token('wrong-phone'), { uid: 'uid-owner', email: 'new-owner@example.test', emailVerified: true, phone: '+8801812345678' }],
    [token('verified-owner'), { uid: 'uid-owner', email: 'new-owner@example.test', emailVerified: true, phone: '+8801712345678' }],
  ]);
  const fixture = createApp({ dbPath: ':memory:', ownerSetupCode: 'TEST-OWNER-CODE', verifyIdentity: async idToken => {
    const identity = claims.get(idToken);
    assert.ok(identity, 'the configured verifier must receive the actual token');
    return identity;
  } });
  const server = fixture.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: Record<string, unknown>) => {
    const response = await fetch(`${origin}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() as any };
  };
  try {
    const signup = { name: 'New customer', username: 'new_customer', email, phone: '01712-345678', password: 'FixturePassword123' };
    assert.equal((await post('/auth/register', { ...signup, emailVerified: true })).status, 403);
    assert.equal((await post('/auth/register', { ...signup, idToken: token('unverified') })).status, 403);
    assert.equal((await post('/auth/register', { ...signup, idToken: token('wrong-email') })).status, 403);
    assert.equal(fixture.db.prepare('SELECT id FROM users WHERE email=?').get(email), undefined);
    const customer = await post('/auth/register', { ...signup, idToken: token('verified-email'), role: 'owner' });
    assert.equal(customer.status, 201);
    assert.deepEqual([customer.data.user.role, customer.data.user.emailVerified, customer.data.user.phoneVerified, customer.data.user.firebaseLinked], ['customer', true, false, true]);
    assert.equal(customer.data.user.phone, '+8801712345678');
    const linked = fixture.db.prepare('SELECT firebase_uid,password_hash FROM users WHERE id=?').get(customer.data.user.id)!;
    assert.equal(linked.firebase_uid, 'uid-1'); assert.notEqual(linked.password_hash, signup.password);
    assert.equal((await post('/auth/login', { email, password: signup.password })).data.user.emailVerified, true);
    assert.equal((await post('/auth/register', { ...signup, username: 'another_customer', email: 'changed@example.test', idToken: token('duplicate-uid') })).status, 409);

    process.env.FIREBASE_PHONE_ENABLED = 'true';
    const owner = { ...signup, name: 'New owner', username: 'new_owner', email: 'new-owner@example.test', setupCode: 'TEST-OWNER-CODE' };
    assert.equal((await post('/setup/owner', { ...owner, phone: '', idToken: token('verified-owner') })).status, 400);
    assert.equal((await post('/setup/owner', { ...owner, idToken: token('wrong-phone') })).status, 403);
    assert.equal((await post('/setup/owner', { ...owner, setupCode: 'WRONG', idToken: token('verified-owner') })).status, 403);
    const results = await Promise.all([post('/setup/owner', { ...owner, idToken: token('verified-owner') }), post('/setup/owner', { ...owner, idToken: token('verified-owner') })]);
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    assert.equal(results.find(r => r.status === 201)?.data.user.phoneVerified, true);
    assert.equal(results.find(r => r.status === 201)?.data.user.role, 'owner');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fixture.close();
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
