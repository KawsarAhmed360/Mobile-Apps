import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createTRPCClient, httpLink, TRPCClientError } from '@trpc/client';
import { createApp, dhakaDate } from '../server/app.js';
import type { AppRouter } from '../server/catalog-rpc.js';

describe('SmartShop persistent API', () => {
  let directory: string;
  let fixture: ReturnType<typeof createApp>;
  let server: Server;
  let base: string;
  let token: string;

  async function start() {
    fixture = createApp({ dbPath: join(directory, 'test.sqlite') });
    server = fixture.app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  async function stop() {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fixture.close();
  }
  async function request(path: string, options: { body?: unknown; auth?: string | false; method?: string } = {}) {
    const auth = options.auth === undefined ? token : options.auth;
    const result = await fetch(`${base}${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: { ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    return { status: result.status, data: await result.json() as any };
  }
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'smartshop-test-'));
    await start();
    const login = await request('/api/auth/login', { auth: false, body: { email: 'owner@smartshop.local', password: 'SmartShop@123' } });
    assert.equal(login.status, 200);
    token = login.data.token;
  });
  afterEach(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });

  it('keeps financial information private and prevents customer role escalation', async () => {
    const products = await request('/api/products', { auth: false });
    assert.equal(products.status, 200);
    assert.ok(products.data.items.length > 0);
    assert.equal(products.data.items[0].cost, undefined);
    assert.equal(products.data.items[0].stock, undefined);
    assert.equal(products.data.items[0].reorderLevel, undefined);
    assert.equal(typeof products.data.items[0].averageRating, 'number');
    const customer = await request('/api/auth/register', { auth: false, body: { name: 'Test Buyer', username: 'test_buyer', email: 'buyer@example.com', password: 'LongPassword123', role: 'owner' } });
    assert.equal(customer.status, 201);
    assert.equal(customer.data.user.role, 'customer');
    assert.equal(customer.data.user.password_hash, undefined);
    assert.equal(customer.data.user.emailVerified, false);
    assert.equal((await request('/api/dashboard', { auth: customer.data.token })).status, 403);
    assert.equal((await request('/api/customers', { auth: customer.data.token })).status, 403);
    assert.equal((await request('/api/inventory', { auth: false })).status, 401);
    assert.equal((await request('/api/inventory', { auth: 'invalid.token' })).status, 401);
    const duplicate = await request('/api/auth/register', { auth: false, body: { name: 'Another Buyer', username: 'TEST_BUYER', email: 'different@example.com', password: 'LongPassword123' } });
    assert.equal(duplicate.status, 409);
  });

  it('places newly added products in category and name order across catalog pages and inventory', async () => {
    const fruit = 'Order Fixture Fruit';
    const bakery = 'order Fixture Bakery';
    const ids = new Map<string, number>();
    for (const [name, category] of [['Order Fixture Zebra', fruit], ['Order Fixture Mango', bakery], ['Order Fixture Banana', fruit], ['Order Fixture apple', fruit]]) {
      const created = await request('/api/products', { body: { name, category, unit: 'piece', price: 100, cost: 60, stock: 1, reorderLevel: 0 } });
      assert.equal(created.status, 201);
      ids.set(name, created.data.id);
    }
    const expected = ['Order Fixture Mango', 'Order Fixture apple', 'Order Fixture Banana', 'Order Fixture Zebra'].map(name => ids.get(name));
    const first = await request('/api/products?search=Order%20Fixture&limit=2', { auth: false });
    const second = await request('/api/products?search=Order%20Fixture&limit=2&page=2', { auth: false });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.data.pages, 2);
    assert.deepEqual(first.data.items.map((item: { id: number }) => item.id), expected.slice(0, 2));
    assert.deepEqual(second.data.items.map((item: { id: number }) => item.id), expected.slice(2));
    assert.deepEqual(first.data.categories.filter((category: string) => category === fruit || category === bakery), [bakery, fruit]);

    const filtered = await request(`/api/products?category=${encodeURIComponent(fruit)}`, { auth: false });
    assert.deepEqual(filtered.data.items.map((item: { id: number }) => item.id), expected.slice(1));
    const inventory = await request('/api/inventory');
    assert.deepEqual(inventory.data.filter((item: { category: string }) => item.category === fruit || item.category === bakery).map((item: { id: number }) => item.id), expected);
  });

  it('serves sorted, filtered public products through the tRPC client', async () => {
    const client = createTRPCClient<AppRouter>({ links: [httpLink({ url: `${base}/api/trpc` })] });
    for (const [name, category] of [['RPC Pear', 'RPC Fruit'], ['RPC Bread', 'RPC Bakery'], ['RPC Apple', 'RPC Fruit'], ['RPC Archived', 'RPC Hidden']]) {
      const created = await request('/api/products', {
        body: { name, category, unit: 'piece', price: 100, cost: 60, stock: 1, reorderLevel: 0, supplier: 'Private supplier', reference: 'Private reference' },
      });
      assert.equal(created.status, 201);
      if (name === 'RPC Archived') assert.equal((await request(`/api/products/${created.data.id}`, { method: 'DELETE' })).status, 200);
    }

    const first = await client.catalog.products.query({ search: 'RPC', limit: 2 });
    const second = await client.catalog.products.query({ search: 'RPC', limit: 2, page: 2 });
    const filtered = await client.catalog.products.query({ category: 'RPC Fruit', search: 'Apple' });
    assert.deepEqual(first.items.map(item => item.name), ['RPC Bread', 'RPC Apple']);
    assert.deepEqual(second.items.map(item => item.name), ['RPC Pear']);
    assert.deepEqual(filtered.items.map(item => item.name), ['RPC Apple']);
    assert.deepEqual([first.total, first.pages, first.page, second.page], [3, 2, 1, 2]);
    assert.deepEqual(first.categories.filter(category => category.startsWith('RPC ')), ['RPC Bakery', 'RPC Fruit']);
    for (const item of [...first.items, ...second.items]) {
      for (const field of ['cost', 'stock', 'reorderLevel', 'supplier', 'reference']) assert.equal(Object.hasOwn(item, field), false, `Public product exposes ${field}`);
    }
    const rest = await request('/api/products?search=RPC&limit=2', { auth: false });
    assert.equal(rest.status, 200);
    assert.deepEqual(first, rest.data);
    await assert.rejects(client.catalog.products.query({ page: 0 }), error => error instanceof TRPCClientError && error.data?.httpStatus === 400);
  });

  it('records sale stock, due and profit atomically, and retries only once', async () => {
    const before = (await request('/api/inventory')).data[0];
    const dashboard = (await request('/api/dashboard')).data;
    const body = { items: [{ productId: before.id, quantity: 2 }], customerName: 'Test Customer', paid: before.price, requestId: 'sale-retry-001' };
    const first = await request('/api/sales', { body });
    assert.equal(first.status, 201);
    assert.equal(first.data.total, before.price * 2);
    assert.equal(first.data.due, before.price);
    const retry = await request('/api/sales', { body });
    assert.deepEqual(retry.data, first.data);
    assert.equal((await request('/api/inventory')).data[0].stock, before.stock - 2);
    const after = (await request('/api/dashboard')).data;
    assert.equal(after.sales, dashboard.sales + before.price * 2);
    assert.equal(after.cashCollected, dashboard.cashCollected + before.price);
    assert.equal(after.dues, dashboard.dues + before.price);
    assert.equal(after.grossProfit, dashboard.grossProfit + (before.price - before.cost) * 2);
    const customers = (await request('/api/customers')).data;
    assert.equal(customers.find((c: any) => c.name === 'Test Customer').due, before.price);
    assert.equal((await request('/api/sales', { body: { ...body, paid: 0 } })).status, 409);
  });

  it('reprints the original sale details and updates the invoice status after payment', async () => {
    const { data: customer } = await request('/api/customers', { body: { name: 'Invoice Customer', phone: '01700000000', email: 'invoice@example.com', address: 'Dhaka' } });
    const product = (await request('/api/inventory')).data.find((item: { stock: number; price: number }) => item.stock >= 2 && item.price > 0);
    const bill = await request('/api/sales', { body: { customerId: customer.id, items: [{ productId: product.id, quantity: 2 }], paid: product.price, requestId: 'sale-invoice-example' } });
    assert.equal(bill.status, 201);
    const invoicePath = `/api/sales/${bill.data.id}/invoice`;
    assert.equal((await request(invoicePath, { auth: false })).status, 401);
    const invoice = await request(invoicePath);
    assert.equal(invoice.status, 200);
    assert.equal(invoice.data.status, 'DUE');
    assert.deepEqual(invoice.data.details.map((field: { value: string }) => field.value), ['Invoice Customer', '01700000000', 'invoice@example.com', 'Dhaka']);
    assert.deepEqual(invoice.data.sections[0].rows[0].slice(0, 2), [product.name, `2 ${product.unit}`]);

    assert.equal((await request(`/api/products/${product.id}`, { method: 'PATCH', body: { name: 'Renamed stock', unit: 'bag' } })).status, 200);
    assert.equal((await request(`/api/customers/${customer.id}`, { method: 'PATCH', body: { name: 'New customer name' } })).status, 200);
    assert.equal((await request(`/api/customers/${customer.id}/payments`, { body: { amount: product.price, method: 'cash', requestId: 'settle-sale-invoice' } })).status, 201);
    const settled = await request(invoicePath);
    assert.equal(settled.data.status, 'PAID');
    assert.deepEqual(settled.data.details, invoice.data.details);
    assert.deepEqual(settled.data.sections, invoice.data.sections);
    assert.deepEqual(settled.data.totals.at(-1), { label: 'Still due on this bill', value: 'BDT 0.00' });
  });

  it('rejects an oversold line without modifying other lines or financial totals', async () => {
    const inventory = (await request('/api/inventory')).data;
    const dashboard = (await request('/api/dashboard')).data;
    const sale = await request('/api/sales', { body: { items: [{ productId: inventory[0].id, quantity: 1 }, { productId: inventory[1].id, quantity: inventory[1].stock + 1 }], paid: 0, customerName: 'Rollback Test', requestId: 'rollback-sale-001' } });
    assert.equal(sale.status, 409);
    const after = (await request('/api/inventory')).data;
    assert.equal(after[0].stock, inventory[0].stock);
    assert.equal(after[1].stock, inventory[1].stock);
    assert.equal((await request('/api/dashboard')).data.sales, dashboard.sales);
    assert.equal((await request('/api/customers')).data.find((c: any) => c.name === 'Rollback Test'), undefined);
  });

  it('updates weighted average purchase cost without rewriting historic sale profit', async () => {
    const product = (await request('/api/inventory')).data[0];
    const before = (await request('/api/dashboard')).data;
    const quantity = 4;
    const unitCost = product.cost + 500;
    const body = { productId: product.id, quantity, unitCost, reference: 'Test supplier', requestId: 'purchase-retry-001' };
    const purchase = await request('/api/purchases', { body });
    assert.equal(purchase.status, 201);
    await request('/api/purchases', { body });
    const afterProduct = (await request('/api/inventory')).data[0];
    assert.equal(afterProduct.stock, product.stock + quantity);
    assert.equal(afterProduct.cost, Math.round((product.stock * product.cost + quantity * unitCost) / (product.stock + quantity)));
    const after = (await request('/api/dashboard')).data;
    assert.equal(after.sales, before.sales);
    assert.equal(after.grossProfit, before.grossProfit);
    assert.equal(after.expenses, before.expenses);
  });

  it('links real customer contact details to sales and persists after a restart', async () => {
    const customer = await request('/api/customers', { body: { name: 'Saved Buyer', phone: '01712345678', email: 'saved@example.com', address: 'Dhaka' } });
    assert.equal(customer.status, 201);
    const product = (await request('/api/inventory')).data[0];
    await request('/api/sales', { body: { customerId: customer.data.id, items: [{ productId: product.id, quantity: 1 }], paid: 0, requestId: 'customer-sale-001' } });
    const storedToken = token;
    await stop();
    await start();
    token = storedToken;
    const buyers = (await request('/api/customers')).data;
    const buyer = buyers.find((c: any) => c.id === customer.data.id);
    assert.equal(buyer.address, 'Dhaka');
    assert.equal(buyer.email, 'saved@example.com');
    assert.equal(buyer.phone, '01712345678');
    assert.equal(buyer.purchases, 1);
    assert.equal(buyer.due, product.price);
    assert.equal((await request('/api/inventory')).data[0].stock, product.stock - 1);
  });

  it('records date-filtered expenses once and rejects invalid calendar dates', async () => {
    const before = (await request('/api/dashboard')).data;
    const body = { title: 'Test transport', amount: 12345, date: dhakaDate(), requestId: 'expense-retry-001' };
    assert.equal((await request('/api/expenses', { body })).status, 201);
    await request('/api/expenses', { body });
    const after = (await request('/api/dashboard')).data;
    assert.equal(after.expenses, before.expenses + body.amount);
    assert.equal(after.netProfit, before.netProfit - body.amount);
    assert.equal(after.sales, before.sales);
    assert.equal((await request('/api/expenses', { body: { ...body, date: '2026-02-30', requestId: 'invalid-expense-001' } })).status, 400);
  });

  it('persists one rating per customer/product and recomputes public averages', async () => {
    const first = await request('/api/products/1/reviews', { body: { rating: 4, body: 'Good quality product.' } });
    assert.equal(first.status, 201);
    const edited = await request('/api/products/1/reviews', { body: { rating: 2, body: 'Updated review after trying it.' } });
    assert.equal(edited.data.id, first.data.id);
    const reviews = (await request('/api/products/1/reviews', { auth: false })).data;
    assert.equal(reviews.filter((r: any) => r.userId === first.data.userId).length, 1);
    assert.equal((await request('/api/products/1', { auth: false })).data.averageRating, 3.5);
  });

  it('accepts only one of two concurrent sales for the final item in stock', async () => {
    const product = await request('/api/products', { body: { name: 'Last item', category: 'Test', unit: 'piece', price: 100, cost: 60, stock: 1, reorderLevel: 1, description: '', emoji: '📦' } });
    assert.equal(product.status, 201);
    const before = (await request('/api/dashboard')).data;
    const results = await Promise.all([1, 2].map(n => request('/api/sales', { body: { items: [{ productId: product.data.id, quantity: 1 }], paid: 100, requestId: `concurrent-sale-00${n}` } })));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    assert.equal((await request('/api/inventory')).data.find((p: any) => p.id === product.data.id).stock, 0);
    assert.equal((await request('/api/dashboard')).data.sales, before.sales + 100);
  });

  it('pushes public invalidation events without publishing sale amounts or stock quantities', async () => {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/events`, { signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type')!, /text\/event-stream/);
    const reader = response.body!.getReader();
    try {
      await reader.read(); // Initial connection comment.
      const product = (await request('/api/inventory')).data[0];
      await request('/api/sales', { body: { items: [{ productId: product.id, quantity: 1 }], paid: product.price, requestId: 'event-sale-001' } });
      const result = await reader.read();
      const event = new TextDecoder().decode(result.value);
      assert.match(event, /event: change/);
      assert.match(event, /"type":"catalog"/);
      assert.doesNotMatch(event, /"(?:price|cost|stock|total|paid|customerName)"/);
    } finally { await reader.cancel(); controller.abort(); }
  });
});

it('uses the shop timezone when an instant falls on the following day in Dhaka', () => {
  assert.equal(dhakaDate(new Date('2026-11-03T20:00:00Z')), '2026-11-04');
});
