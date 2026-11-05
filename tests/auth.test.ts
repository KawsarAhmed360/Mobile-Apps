import { afterEach, beforeEach, describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.js';
import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Server } from 'node:http';

test('real owner activation is single-use, disables demo logins and logout revokes the JWT', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'smartshop-owner-'));
  const fixture = createApp({ dbPath:join(dir,'app.sqlite'),ownerSetupCode:'PRIVATE-TEST-CODE' });
  const server = fixture.app.listen(0,'127.0.0.1'); await once(server,'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (path:string, body?:unknown, token?:string) => {
    const r = await fetch(base+path,{method:body ? 'POST':'GET',headers:{...(body ? {'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:r.status,body:await r.json() as any};
  };
  try {
    assert.equal((await request('/api/config')).body.ownerSetupRequired,true);
    const data={name:'Real Owner',username:'real_owner',email:'real-owner@example.com',password:'OwnerPassword123',setupCode:'WRONG'};
    assert.equal((await request('/api/setup/owner',data)).status,403);
    const owner=await request('/api/setup/owner',{...data,setupCode:'PRIVATE-TEST-CODE'});
    assert.equal(owner.status,201); assert.equal(owner.body.user.role,'owner'); assert.equal(owner.body.user.isDemo,false);
    assert.equal(owner.body.user.emailVerified,false); assert.equal(owner.body.user.phoneVerified,false);
    assert.equal((await request('/api/config')).body.ownerSetupRequired,false);
    assert.equal((await request('/api/setup/owner',{...data,setupCode:'PRIVATE-TEST-CODE'})).status,409);
    assert.equal((await request('/api/auth/login',{email:'owner@smartshop.local',password:'SmartShop@123'})).status,401);
    assert.equal((await request('/api/auth/me',undefined,owner.body.token)).status,200);
    assert.equal((await request('/api/auth/logout',{},owner.body.token)).status,200);
    assert.equal((await request('/api/auth/me',undefined,owner.body.token)).status,401);
    const customer=await request('/api/auth/register',{name:'Real Customer',username:'real_customer',email:'customer@example.com',password:'CustomerPassword123',role:'owner'});
    assert.equal(customer.status,201); assert.equal(customer.body.user.role,'customer');
    assert.equal((await request('/api/inventory',undefined,customer.body.token)).status,403);
    assert.equal((await request('/api/config')).body.ownerSetupCode,undefined);
    assert.equal((await request('/api/auth/verify-contact',{idToken:'x'.repeat(100)},customer.body.token)).status,503);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); fixture.close(); await rm(dir,{recursive:true,force:true});
  }
});

describe('Activating an existing registered account as the first real owner', () => {
  let fixture: ReturnType<typeof createApp>;
  let server: Server;
  let base: string;
  const code = 'EXISTING-ACCOUNT-OWNER-CODE';
  const request = async (path: string, body?: unknown, token?: string) => {
    const response = await fetch(`${base}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() as any };
  };
  const signup = async (suffix: string) => (await request('/auth/register', {
    name: `Existing Customer ${suffix}`, username: `existing_${suffix}`, email: `existing-${suffix}@example.com`, password: 'MyExistingPassword123',
  })).data;
  beforeEach(async () => {
    fixture = createApp({ dbPath: ':memory:', ownerSetupCode: code });
    server = fixture.app.listen(0, '127.0.0.1'); await once(server, 'listening');
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); fixture.close();
  });

  it('keeps the account ID, password and history while replacing old sessions and disabling demo access', async () => {
    const customer = await signup('owner');
    const competitor = await signup('other');
    const secondLogin = (await request('/auth/login', { email: customer.user.email, password: 'MyExistingPassword123' })).data;
    const demoOwner = (await request('/auth/login', { email: 'owner@smartshop.local', password: 'SmartShop@123' })).data;
    const demoCustomer = (await request('/auth/login', { email: 'customer@smartshop.local', password: 'Customer@123' })).data;
    const review = await request('/products/1/reviews', { rating: 5, body: 'My original customer review remains here.' }, customer.token);
    assert.equal(review.status, 201);
    const before = fixture.db.prepare('SELECT * FROM users WHERE id=?').get(customer.user.id)!;
    const countBefore = fixture.db.prepare('SELECT COUNT(*) n FROM users').get()!.n;
    assert.equal((await request('/setup/owner/claim', { setupCode: code })).status, 401);
    assert.equal((await request('/setup/owner/claim', {}, customer.token)).status, 400);
    assert.equal((await request('/setup/owner/claim', { setupCode: 'WRONG' }, customer.token)).status, 403);
    assert.equal((await request('/setup/owner/claim', { setupCode: code }, demoOwner.token)).status, 403);
    assert.equal((await request('/setup/owner/claim', { setupCode: code }, demoCustomer.token)).status, 403);

    const claimed = await request('/setup/owner/claim', { setupCode: code }, customer.token);
    assert.equal(claimed.status, 200);
    assert.equal(claimed.data.user.id, customer.user.id); assert.equal(claimed.data.user.role, 'owner'); assert.equal(claimed.data.user.isDemo, false);
    assert.notEqual(claimed.data.refreshToken, customer.refreshToken);
    const after = fixture.db.prepare('SELECT * FROM users WHERE id=?').get(customer.user.id)!;
    assert.equal(after.password_hash, before.password_hash); assert.equal(after.created_at, before.created_at);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) n FROM users').get()!.n, countBefore);
    assert.equal((await request('/products/1/reviews')).data.find((item: any) => item.id === review.data.id).userId, customer.user.id);
    for (const old of [customer, secondLogin, demoOwner, demoCustomer]) {
      assert.equal((await request('/auth/me', undefined, old.token)).status, 401);
      assert.equal((await request('/auth/refresh', { refreshToken: old.refreshToken })).status, 401);
    }
    assert.equal((await request('/inventory', undefined, claimed.data.token)).status, 200);
    assert.equal((await request('/auth/login', { email: 'owner@smartshop.local', password: 'SmartShop@123' })).status, 401);
    assert.equal((await request('/auth/login', { email: 'customer@smartshop.local', password: 'Customer@123' })).status, 401);
    const login = await request('/auth/login', { email: customer.user.email, password: 'MyExistingPassword123' });
    assert.equal(login.status, 200); assert.equal(login.data.user.role, 'owner'); assert.equal(login.data.user.id, customer.user.id);
    assert.equal((await request('/config')).data.ownerSetupRequired, false);
    assert.equal((await request('/setup/owner/claim', { setupCode: code }, claimed.data.token)).status, 409);
    assert.equal((await request('/setup/owner/claim', { setupCode: code }, competitor.token)).status, 409);
  });

  it('rejects staff/disabled accounts and allows only one of two simultaneous valid claims', async () => {
    const first = await signup('first'), second = await signup('second');
    fixture.db.prepare("UPDATE users SET role='staff' WHERE id=?").run(first.user.id);
    assert.equal((await request('/setup/owner/claim', { setupCode: code }, first.token)).status, 403);
    fixture.db.prepare("UPDATE users SET role='customer',disabled=1 WHERE id=?").run(first.user.id);
    assert.equal((await request('/setup/owner/claim', { setupCode: code }, first.token)).status, 401);
    fixture.db.prepare('UPDATE users SET disabled=0 WHERE id=?').run(first.user.id);
    const replies = await Promise.all([first, second].map(user => request('/setup/owner/claim', { setupCode: code }, user.token)));
    assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 409]);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) n FROM users WHERE role='owner' AND is_demo=0 AND disabled=0").get()!.n, 1);
    const winner = replies.find(reply => reply.status === 200)!;
    assert.equal((await request('/auth/me', undefined, winner.data.token)).status, 200);
  });
});

describe('Owner-managed staff and persistent sign-in', () => {
  let directory: string;
  let fixture: ReturnType<typeof createApp>;
  let server: Server;
  let base: string;
  let owner: any;
  let customer: any;
  const secret = 'test-only-persistent-session-secret';
  const request = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', token?: string) => {
    const response = await fetch(`${base}/api${path}`, {
      method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() as any };
  };
  const start = async () => {
    fixture = createApp({ dbPath: join(directory, 'auth.sqlite'), ownerSetupCode: 'PERSISTENCE-TEST-CODE', secret });
    server = fixture.app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  const stop = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fixture.close();
  };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'smartshop-persistent-auth-'));
    await start();
    const activation = await request('/setup/owner', { name: 'Actual Owner', username: 'actual_owner', email: 'actual-owner@example.com', password: 'OwnerPassword123', setupCode: 'PERSISTENCE-TEST-CODE' });
    assert.equal(activation.status, 201);
    owner = activation.data;
    const signup = await request('/auth/register', { name: 'Alpha Customer', username: 'alpha_customer', email: 'alpha@example.com', password: 'CustomerPassword123' });
    assert.equal(signup.status, 201);
    customer = signup.data;
  });
  afterEach(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });

  it('lets only the owner grant and revoke staff access with immediate effects on existing JWTs', async () => {
    assert.equal((await request('/staff/users')).status, 401);
    assert.equal((await request('/staff/users', undefined, 'GET', customer.token)).status, 403);
    assert.equal((await request(`/staff/users/${customer.user.id}`, { role: 'staff' }, 'PATCH', customer.token)).status, 403);
    assert.equal((await request(`/staff/users/${customer.user.id}`, { role: 'owner' }, 'PATCH', owner.token)).status, 400);
    assert.equal((await request(`/staff/users/${owner.user.id}`, { role: 'customer' }, 'PATCH', owner.token)).status, 403);
    const granted = await request(`/staff/users/${customer.user.id}`, { role: 'staff' }, 'PATCH', owner.token);
    assert.equal(granted.status, 200);
    assert.equal(granted.data.role, 'staff');
    assert.equal((await request('/inventory', undefined, 'GET', customer.token)).status, 200);
    assert.equal((await request('/auth/me', undefined, 'GET', customer.token)).data.role, 'staff');
    assert.equal((await request(`/staff/users/${customer.user.id}`, { role: 'customer' }, 'PATCH', customer.token)).status, 403);
    const revoked = await request(`/staff/users/${customer.user.id}`, { role: 'customer' }, 'PATCH', owner.token);
    assert.equal(revoked.status, 200);
    assert.equal((await request('/inventory', undefined, 'GET', customer.token)).status, 403);
    assert.equal((await request('/auth/me', undefined, 'GET', customer.token)).data.role, 'customer');
    assert.equal((await request('/auth/refresh', { refreshToken: customer.refreshToken })).data.user.role, 'customer');
  });

  it('searches and paginates active real accounts without exposing credential data', async () => {
    await request('/auth/register', { name: 'Beta Customer', username: 'beta_customer', email: 'beta@example.com', password: 'CustomerPassword123' });
    const first = await request('/staff/users?page=1&limit=2', undefined, 'GET', owner.token);
    const second = await request('/staff/users?page=2&limit=2', undefined, 'GET', owner.token);
    assert.equal(first.status, 200);
    assert.equal(first.data.total, 3);
    assert.equal(first.data.pages, 2);
    assert.equal(first.data.items.length, 2);
    assert.equal(second.data.items.length, 1);
    assert.ok(first.data.items.every((user: any) => !user.isDemo));
    assert.equal(first.data.items[0].password_hash, undefined);
    assert.equal(first.data.items[0].refresh_token_hash, undefined);
    const search = await request('/staff/users?search=beta%40example.com', undefined, 'GET', owner.token);
    assert.equal(search.data.total, 1);
    assert.equal(search.data.items[0].username, 'beta_customer');
    assert.equal((await request('/staff/users?page=0', undefined, 'GET', owner.token)).status, 400);
    assert.equal((await request('/staff/users/2', { role: 'staff' }, 'PATCH', owner.token)).status, 400);
    assert.equal((await request('/staff/users/99999', { role: 'staff' }, 'PATCH', owner.token)).status, 404);
  });

  it('stores only refresh hashes and rotates parallel refresh requests to the same successor', async () => {
    assert.equal(typeof owner.refreshToken, 'string');
    const original = owner.refreshToken;
    const replies = await Promise.all([1, 2, 3].map(() => request('/auth/refresh', { refreshToken: original })));
    assert.ok(replies.every(reply => reply.status === 200));
    const successor = replies[0].data.refreshToken;
    assert.notEqual(successor, original);
    assert.ok(replies.every(reply => reply.data.refreshToken === successor));
    const again = await request('/auth/refresh', { refreshToken: successor });
    assert.equal(again.data.refreshToken, successor);
    const stored = fixture.db.prepare('SELECT * FROM user_sessions WHERE id=?').get(original.split('.')[0])!;
    assert.equal(stored.refresh_token_hash, createHash('sha256').update(successor).digest('hex'));
    assert.equal(stored.previous_refresh_token_hash, createHash('sha256').update(original).digest('hex'));
    assert.equal(JSON.stringify(stored).includes(original), false);
    assert.equal(JSON.stringify(stored).includes(successor), false);
    const payload = jwt.decode(again.data.token) as jwt.JwtPayload;
    assert.equal(payload.exp! - payload.iat!, 86_400);
    assert.ok(String(stored.expires_at) > '2099-01-01');
  });

  it('restores sign-in after an access token expires and revokes both credentials on refresh-only logout', async () => {
    const expired = jwt.sign({ sid: owner.refreshToken.split('.')[0] }, secret, { subject: String(owner.user.id), expiresIn: -1, algorithm: 'HS256' });
    assert.equal((await request('/auth/me', undefined, 'GET', expired)).status, 401);
    const restored = await request('/auth/refresh', { refreshToken: owner.refreshToken });
    assert.equal(restored.status, 200);
    assert.equal((await request('/auth/me', undefined, 'GET', restored.data.token)).status, 200);
    const logout = await request('/auth/logout', { refreshToken: restored.data.refreshToken });
    assert.equal(logout.status, 200);
    assert.equal((await request('/auth/refresh', { refreshToken: restored.data.refreshToken })).status, 401);
    assert.equal((await request('/auth/me', undefined, 'GET', restored.data.token)).status, 401);
  });

  it('preserves refresh sessions across a server restart and permits logout with an expired signed JWT', async () => {
    const saved = owner.refreshToken;
    await stop(); await start();
    const restored = await request('/auth/refresh', { refreshToken: saved });
    assert.equal(restored.status, 200);
    assert.equal(restored.data.user.id, owner.user.id);
    const expired = jwt.sign({ sid: saved.split('.')[0] }, secret, { subject: String(owner.user.id), expiresIn: -1, algorithm: 'HS256' });
    assert.equal((await request('/auth/logout', {}, 'POST', expired)).status, 200);
    assert.equal((await request('/auth/refresh', { refreshToken: restored.data.refreshToken })).status, 401);
  });

  it('rejects forged, stale and disabled-account refresh attempts without revoking a valid current session', async () => {
    const id = customer.refreshToken.split('.')[0];
    assert.equal((await request('/auth/refresh', { refreshToken: `${id}.${'A'.repeat(43)}` })).status, 401);
    assert.equal((await request('/auth/refresh', { refreshToken: 'malformed' })).status, 401);
    const first = await request('/auth/refresh', { refreshToken: customer.refreshToken });
    assert.equal(first.status, 200);
    fixture.db.prepare('UPDATE user_sessions SET previous_refresh_valid_until=?,refresh_rotated_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z', id);
    assert.equal((await request('/auth/refresh', { refreshToken: customer.refreshToken })).status, 401);
    const current = await request('/auth/refresh', { refreshToken: first.data.refreshToken });
    assert.equal(current.status, 200);
    fixture.db.prepare('UPDATE users SET disabled=1 WHERE id=?').run(customer.user.id);
    assert.equal((await request('/auth/refresh', { refreshToken: current.data.refreshToken })).status, 401);
    assert.equal((await request('/auth/me', undefined, 'GET', current.data.token)).status, 401);
  });
});
