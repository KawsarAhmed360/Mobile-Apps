import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../server/app.js';

describe('Shared product comments and live reactions', () => {
  let directory: string;
  let fixture: ReturnType<typeof createApp>;
  let server: Server;
  let base: string;
  let owner: string;
  let customer: string;
  let secondCustomer: string;

  const request = async (path: string, token?: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const start = async () => {
    fixture = createApp({ dbPath: join(directory, 'community.sqlite') });
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
    directory = await mkdtemp(join(tmpdir(), 'smartshop-community-'));
    await start();
    owner = (await request('/api/auth/login', undefined, { email: 'owner@smartshop.local', password: 'SmartShop@123' })).body.token;
    customer = (await request('/api/auth/login', undefined, { email: 'customer@smartshop.local', password: 'Customer@123' })).body.token;
    const signup = await request('/api/auth/register', undefined, { name: 'Another Customer', username: 'other_customer', email: 'another@example.com', password: 'LongPassword123' });
    assert.equal(signup.status, 201);
    secondCustomer = signup.body.token;
  });
  afterEach(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });

  it('shows a customer comment to the owner, another customer and public visitors without private data', async () => {
    const created = await request('/api/products/1/comments', customer, { body: 'Is this rice available in a larger bag?' });
    assert.equal(created.status, 201);
    assert.equal(created.body.author, 'Demo Customer');
    assert.equal(created.body.authorRole, 'customer');
    for (const viewer of [undefined, owner, secondCustomer]) {
      const list = await request('/api/products/1/comments', viewer);
      assert.equal(list.status, 200);
      assert.equal(list.body.items[0].body, created.body.body);
      assert.equal(list.body.total, 1);
      assert.equal(list.body.items[0].email, undefined);
      assert.equal(list.body.items[0].phone, undefined);
      assert.equal(list.body.items[0].password_hash, undefined);
    }
    assert.equal((await request('/api/products/1/comments', undefined, { body: 'Anonymous comment' })).status, 401);
    assert.equal((await request('/api/products/99999/comments', customer, { body: 'Unknown product' })).status, 404);
    assert.equal((await request('/api/products/1/comments', customer, { body: '   ' })).status, 400);
  });

  it('keeps one reaction per user, supports safe retries, switches counts and clears reactions', async () => {
    const comment = (await request('/api/products/1/comments', customer, { body: 'Very useful product information.' })).body;
    const path = `/api/comments/${comment.id}/reaction`;
    const first = await request(path, secondCustomer, { value: 'like' }, 'PUT');
    assert.equal(first.status, 200);
    assert.equal(first.body.likes, 1);
    assert.equal(first.body.myReaction, 'like');
    const retried = await request(path, secondCustomer, { value: 'like' }, 'PUT');
    assert.equal(retried.body.likes, 1);
    await request(path, owner, { value: 'like' }, 'PUT');
    const switched = await request(path, secondCustomer, { value: 'dislike' }, 'PUT');
    assert.equal(switched.body.likes, 1);
    assert.equal(switched.body.dislikes, 1);
    assert.equal(switched.body.myReaction, 'dislike');
    const otherView = (await request('/api/products/1/comments', owner)).body.items[0];
    assert.equal(otherView.myReaction, 'like');
    assert.equal((await request('/api/products/1/comments')).body.items[0].myReaction, null);
    const cleared = await request(path, secondCustomer, { value: null }, 'PUT');
    assert.equal(cleared.body.dislikes, 0);
    assert.equal(cleared.body.myReaction, null);
    assert.equal((await request(path, undefined, { value: 'like' }, 'PUT')).status, 401);
    assert.equal((await request(path, owner, { value: 'invalid' }, 'PUT')).status, 400);
  });

  it('permits author edits and owner moderation while blocking other customers', async () => {
    const comment = (await request('/api/products/1/comments', customer, { body: 'Original comment' })).body;
    const path = `/api/comments/${comment.id}`;
    assert.equal((await request(path, secondCustomer, { body: 'Unwanted edit' }, 'PATCH')).status, 403);
    const edited = await request(path, customer, { body: 'Updated by the author' }, 'PATCH');
    assert.equal(edited.status, 200);
    assert.equal(edited.body.body, 'Updated by the author');
    assert.equal((await request(path, secondCustomer, undefined, 'DELETE')).status, 403);
    await request(`${path}/reaction`, secondCustomer, { value: 'like' }, 'PUT');
    assert.equal((await request(path, owner, undefined, 'DELETE')).status, 200);
    assert.equal((await request('/api/products/1/comments')).body.total, 0);
    assert.equal(Number(fixture.db.prepare('SELECT COUNT(*) n FROM comment_reactions').get()!.n), 0);
    assert.equal((await request(`${path}/reaction`, customer, { value: 'like' }, 'PUT')).status, 404);
  });

  it('paginates deterministically and preserves discussions after restarting the server', async () => {
    for (let i = 0; i < 5; i++) await request('/api/products/1/comments', customer, { body: `Public comment ${i}` });
    const first = (await request('/api/products/1/comments?page=1&limit=2')).body;
    const second = (await request('/api/products/1/comments?page=2&limit=2')).body;
    assert.equal(first.total, 5);
    assert.equal(first.pages, 3);
    assert.equal(first.items.length, 2);
    assert.equal(second.items.length, 2);
    assert.ok(first.items.every((a: any) => !second.items.some((b: any) => a.id === b.id)));
    assert.equal((await request('/api/products/2/comments')).body.total, 0);
    assert.equal((await request('/api/products/1/comments?limit=1000')).status, 400);
    await stop(); await start();
    const persisted = (await request('/api/products/1/comments')).body;
    assert.equal(persisted.total, 5);
    assert.equal(persisted.items[0].body, 'Public comment 4');
  });

  it('broadcasts comment and reaction invalidations to other connected clients', async () => {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, { signal: controller.signal });
    const reader = response.body!.getReader();
    try {
      await reader.read();
      const created = await request('/api/products/1/comments', customer, { body: 'Live to everyone' });
      const commentEvent = new TextDecoder().decode((await reader.read()).value);
      assert.match(commentEvent, /event: change/);
      assert.match(commentEvent, /"type":"comments"/);
      assert.match(commentEvent, /"productId":1/);
      assert.doesNotMatch(commentEvent, /email|password|token|phone/);
      await request(`/api/comments/${created.body.id}/reaction`, secondCustomer, { value: 'like' }, 'PUT');
      const reactionEvent = new TextDecoder().decode((await reader.read()).value);
      assert.match(reactionEvent, /"type":"reactions"/);
    } finally { await reader.cancel(); controller.abort(); }
  });
});
