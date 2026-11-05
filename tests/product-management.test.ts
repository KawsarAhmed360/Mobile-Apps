import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../server/app.js';

test('editing and deleting products preserves sales snapshots and prevents checkout of removed stock', async () => {
  const fixture = createApp({ dbPath: ':memory:' });
  const server = fixture.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const request = async (method: string, route: string, body?: object, token?: string) => {
    const res = await fetch(base + route, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() as any };
  };
  try {
    const owner = (await request('POST', '/auth/login', { email: 'owner@smartshop.local', password: 'SmartShop@123' })).data.token;
    const customer = (await request('POST', '/auth/login', { email: 'customer@smartshop.local', password: 'Customer@123' })).data.token;
    assert.ok(owner && customer);
    const created = await request('POST', '/products', {
      name: 'Fixture tea', category: 'Tea', unit: 'box', price: 1000, cost: 600, stock: 4, reorderLevel: 3, emoji: '👨🏽‍🍳',
    }, owner);
    assert.equal(created.status, 201);
    const id = created.data.id;
    const sale = await request('POST', '/sales', { items: [{ productId: id, quantity: 1 }], paid: 1000, requestId: 'fixture-tea-sale' }, owner);
    assert.equal(sale.status, 201);
    assert.equal((await request('PATCH', `/products/${id}`, { stock: 8, expectedStock: 4 }, owner)).status, 409);
    const edited = await request('PATCH', `/products/${id}`, {
      name: 'Fixture green tea', category: 'Beverages', unit: 'pack', price: 1350, cost: 700, stock: 8, expectedStock: 3,
      reorderLevel: 5, description: 'Updated fixture', emoji: '🍵', uploadId: null,
    }, owner);
    assert.equal(edited.status, 200);
    assert.deepEqual([edited.data.name, edited.data.unit, edited.data.stock, edited.data.emoji], ['Fixture green tea', 'pack', 8, '🍵']);
    assert.equal(fixture.db.prepare("SELECT quantity FROM stock_movements WHERE product_id=? AND type='adjustment'").get(id)?.quantity, 5);
    assert.equal((await request('DELETE', `/products/${id}`, undefined, customer)).status, 403);
    assert.equal((await request('DELETE', `/products/${id}`, undefined, owner)).status, 200);
    assert.equal((await request('DELETE', `/products/${id}`, undefined, owner)).status, 200);
    assert.equal((await request('GET', `/products/${id}`)).status, 404);
    assert.equal((await request('GET', `/products/${id}/comments`)).status, 404);
    assert.equal((await request('GET', '/products?search=Fixture')).data.total, 0);
    assert.equal((await request('GET', '/inventory', undefined, owner)).data.some((product: { id: number }) => product.id === id), false);
    assert.equal((await request('POST', '/sales', { items: [{ productId: id, quantity: 1 }], paid: 1350, requestId: 'fixture-blocked-sale' }, owner)).status, 404);
    assert.equal((await request('POST', '/purchases', { productId: id, quantity: 1, unitCost: 600, requestId: 'fixture-blocked-purchase' }, owner)).status, 404);
    const snapshot = fixture.db.prepare('SELECT unit_price,unit_cost FROM sale_items WHERE sale_id=? AND product_id=?').get(sale.data.id, id);
    assert.deepEqual([snapshot?.unit_price, snapshot?.unit_cost], [1000, 600]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fixture.close();
  }
});
