import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../server/app.js';
import { firebasePasswordRecovery } from '../server/password-recovery.js';
import { ServiceError } from '../server/services.js';

test('password reset works for all roles, binds the email and revokes old sessions', async () => {
  const roles = ['owner', 'staff', 'customer'];
  const emails = roles.map(role => `${role}@example.test`);
  const sent: [string, boolean][] = [];
  const codes = new Map(emails.map((email, i) => [`reset-code-${i}`, { email, uid: `firebase-${i}` }]));
  const fixture = createApp({ dbPath: ':memory:', passwordRecovery: {
    async send(email, provision) { sent.push([email, provision]); },
    async verifyCode(code) {
      const identity = codes.get(code);
      if (!identity) throw new ServiceError(400, 'Code expired or used.');
      return identity.email;
    },
    async reset(code, email) {
      const identity = codes.get(code);
      assert.equal(identity?.email, email);
      codes.delete(code);
      return identity!;
    },
  } });
  const demoHash = fixture.db.prepare("SELECT password_hash FROM users WHERE email='owner@smartshop.local'").get()!.password_hash;
  for (const [index, role] of roles.entries()) {
    fixture.db.prepare('INSERT INTO users(name,username,email,password_hash,role,created_at,firebase_uid) VALUES(?,?,?,?,?,?,?)')
      .run(role, `real_${role}`, emails[index], demoHash, role, new Date().toISOString(), role === 'staff' ? null : `firebase-${index}`);
  }
  const server = fixture.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const post = async (path: string, body: object) => {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any };
  };
  const oldPassword = 'SmartShop@123';
  const password = 'New-Reset-Password123';
  const resetPath = '/auth/password-reset/confirm';
  try {
    const unknown = await post('/auth/password-reset/request', { email: 'unknown@example.test' });
    const demo = await post('/auth/password-reset/request', { email: 'owner@smartshop.local' });
    assert.deepEqual(unknown, { status: 200, body: { ok: true } });
    assert.deepEqual(demo, unknown);
    assert.equal(sent.length, 0);
    assert.equal((await post(resetPath, { email: emails[0], code: 'reset-code-1', password })).status, 400);
    assert.equal(codes.has('reset-code-1'), true);
    codes.set('wrong-uid-code', { email: emails[0], uid: 'some-other-account' });
    assert.equal((await post(resetPath, { email: emails[0], code: 'wrong-uid-code', password })).status, 400);

    for (const [index, role] of roles.entries()) {
      const email = emails[index];
      const old = await post('/auth/login', { email, password: oldPassword });
      assert.equal(old.status, 200);
      assert.deepEqual(await post('/auth/password-reset/request', { email: email.toUpperCase() }), unknown);
      assert.equal((await post('/auth/password-reset/request', { email })).status, 429);
      const code = `reset-code-${index}`;
      assert.equal((await post(resetPath, { email, code, password: 'short' })).status, 400);
      assert.equal((await post(resetPath, { email, code, password })).status, 200);
      assert.equal((await post(resetPath, { email, code, password })).status, 400);
      assert.equal((await post('/auth/login', { email, password: oldPassword })).status, 401);
      assert.equal((await post('/auth/refresh', { refreshToken: old.body.refreshToken })).status, 401);
      assert.equal((await fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${old.body.token}` } })).status, 401);
      const current = await post('/auth/login', { email, password });
      assert.equal(current.status, 200);
      assert.equal(current.body.user.role, role);
      assert.equal(current.body.user.firebaseLinked, true);
    }
    assert.deepEqual(sent, [[emails[0], false], [emails[1], true], [emails[2], false]]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fixture.close();
  }
});

test('Firebase recovery uses a one-time password reset action before reading the account UID', async () => {
  const config = { FIREBASE_PROJECT_ID: 'fixture', FIREBASE_AUTH_DOMAIN: 'fixture.firebaseapp.com', FIREBASE_APP_ID: 'fixture-app', FIREBASE_API_KEY: 'fixture-api-key' };
  const previous = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  Object.assign(process.env, config);
  const originalFetch = globalThis.fetch;
  const email = 'buyer@example.test';
  const methods: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://identitytoolkit.googleapis.com');
    assert.equal(url.searchParams.get('key'), 'fixture-api-key');
    const method = url.pathname.split(':')[1];
    methods.push(method);
    const body = JSON.parse(String(init?.body));
    if (method === 'signUp') return Response.json({ error: { message: 'EMAIL_EXISTS' } }, { status: 400 });
    if (method === 'sendOobCode') assert.deepEqual(body, { email, requestType: 'PASSWORD_RESET' });
    if (method === 'resetPassword' && body.oobCode === 'expired-code') return Response.json({ error: { message: 'EXPIRED_OOB_CODE' } }, { status: 400 });
    if (method === 'signInWithPassword') assert.equal(body.password, 'Updated-Password123');
    return Response.json({ email, requestType: 'PASSWORD_RESET', localId: 'firebase-uid' });
  };
  try {
    await firebasePasswordRecovery.send(email, true);
    await assert.rejects(firebasePasswordRecovery.verifyCode('expired-code'), /invalid, expired or already used/);
    assert.equal(await firebasePasswordRecovery.verifyCode('good-code'), email);
    assert.deepEqual(await firebasePasswordRecovery.reset('good-code', email, 'Updated-Password123'), { uid: 'firebase-uid', email });
    assert.deepEqual(methods, ['signUp', 'sendOobCode', 'resetPassword', 'resetPassword', 'resetPassword', 'signInWithPassword']);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
