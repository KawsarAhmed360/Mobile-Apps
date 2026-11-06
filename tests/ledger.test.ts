import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp, dhakaDate } from '../server/app.js';
import { documentMoney } from '../shared/document.js';

describe('Shop settings, customer ledgers and stock alerts', () => {
  let directory: string;
  let fixture: ReturnType<typeof createApp>;
  let server: Server;
  let base: string;
  let owner: string;
  let customerToken: string;
  const request = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST', token: string | false = owner) => {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() as any };
  };
  const start = async () => {
    fixture = createApp({ dbPath: join(directory, 'ledger.sqlite') });
    server = fixture.app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  const stop = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fixture.close();
  };
  const buyer = async (openingDue = 0) => {
    const response = await request('/customers', { name: 'Ledger Buyer', phone: '01712345678', openingDue });
    assert.equal(response.status, 201);
    return response.data;
  };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'smartshop-ledger-'));
    await start();
    owner = (await request('/auth/login', { email: 'owner@smartshop.local', password: 'SmartShop@123' }, 'POST', false)).data.token;
    customerToken = (await request('/auth/login', { email: 'customer@smartshop.local', password: 'Customer@123' }, 'POST', false)).data.token;
  });
  afterEach(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });

  it('persists actual owner/shop details and exposes the configured profile publicly', async () => {
    assert.equal((await request('/settings', undefined, 'GET', false)).status, 401);
    assert.equal((await request('/settings', undefined, 'GET', customerToken)).status, 403);
    const profile = await request('/owner/profile', { name: 'Actual Owner', phone: '01711112222' }, 'PATCH');
    assert.equal(profile.status, 200);
    assert.equal(profile.data.name, 'Actual Owner');
    assert.equal(profile.data.phone, '01711112222');
    assert.equal(profile.data.password_hash, undefined);
    const shop = { name: 'Actual Store', tagline: 'Our neighbourhood store', phone: '01711113333', email: 'shop@example.com', address: 'Dhanmondi, Dhaka', openingHours: '9 AM to 9 PM', latitude: null, longitude: null };
    assert.equal((await request('/shop', shop, 'PUT', customerToken)).status, 403);
    const saved = await request('/shop', shop, 'PUT');
    assert.equal(saved.status, 200);
    assert.equal(saved.data.demo, false);
    assert.equal(saved.data.latitude, null);
    assert.equal(saved.data.email, shop.email);
    await stop(); await start();
    const publicShop = (await request('/shop', undefined, 'GET', false)).data;
    assert.equal(publicShop.name, shop.name);
    assert.equal(publicShop.longitude, null);
    assert.equal(publicShop.demo, false);
    const settings = (await request('/settings')).data;
    assert.equal(settings.owner.name, 'Actual Owner');
    assert.equal((await request('/shop', { ...shop, latitude: 23.75, longitude: 90.37 }, 'PUT')).data.latitude, 23.75);
    assert.equal((await request('/shop', { ...shop, latitude: 23.75 }, 'PUT')).status, 400);
  });

  it('records opening debt separately and collects it before invoice dues without inflating sales or profit', async () => {
    const before = (await request('/dashboard')).data;
    const customer = await buyer(10_000);
    assert.equal(customer.openingDue, 10_000);
    assert.equal(customer.due, 10_000);
    const opened = (await request('/dashboard')).data;
    assert.equal(opened.sales, before.sales);
    assert.equal(opened.grossProfit, before.grossProfit);
    const bill = await request('/sales', { items: [{ productId: 1, quantity: 1 }], customerId: customer.id, paid: 0, requestId: 'opening-ledger-sale' });
    assert.equal(bill.status, 201);
    const billed = (await request('/dashboard')).data;
    const body = { amount: 11_000, method: 'bkash', note: 'Collected prior balance', date: dhakaDate(), requestId: 'opening-receipt-001' };
    const receipt = await request(`/customers/${customer.id}/payments`, body);
    assert.equal(receipt.status, 201);
    assert.equal(receipt.data.remainingDue, 6800);
    const retried = await request(`/customers/${customer.id}/payments`, body);
    assert.deepEqual(retried.data, receipt.data);
    const after = (await request('/dashboard')).data;
    assert.equal(after.sales, billed.sales);
    assert.equal(after.grossProfit, billed.grossProfit);
    assert.equal(after.netProfit, billed.netProfit);
    assert.equal(after.cashCollected, billed.cashCollected + 11_000);
    const ledger = (await request(`/customers/${customer.id}/ledger`)).data;
    assert.equal(ledger.customer.openingSettled, 10_000);
    assert.equal(ledger.customer.due, 6800);
    assert.equal(ledger.sales[0].paid, 0);
    assert.equal(ledger.sales[0].settled, 1000);
    assert.equal(ledger.payments.length, 1);
    assert.equal(fixture.db.prepare('SELECT paid FROM sales WHERE id=?').get(bill.data.id)!.paid, 0);
    assert.equal((await request(`/customers/${customer.id}/payments`, { ...body, amount: 6801, requestId: 'overpay-receipt-001' })).status, 400);
  });

  it('allocates later payments to the oldest unpaid invoices and keeps ledger data after restart', async () => {
    const customer = await buyer();
    const first = (await request('/sales', { items: [{ productId: 1, quantity: 1 }], customerId: customer.id, paid: 1000, requestId: 'fifo-first-sale-001' })).data;
    const second = (await request('/sales', { items: [{ productId: 3, quantity: 1 }], customerId: customer.id, paid: 0, requestId: 'fifo-second-sale-001' })).data;
    const receipt = await request(`/customers/${customer.id}/payments`, { amount: 8000, method: 'cash', requestId: 'fifo-receipt-001' });
    assert.equal(receipt.status, 201);
    await stop(); await start();
    const ledger = (await request(`/customers/${customer.id}/ledger`)).data;
    const firstRow = ledger.sales.find((sale: any) => sale.id === first.id);
    const secondRow = ledger.sales.find((sale: any) => sale.id === second.id);
    assert.equal(firstRow.settled, 7800);
    assert.equal(firstRow.due, 0);
    assert.equal(secondRow.settled, 1200);
    assert.equal(secondRow.due, 14300);
    assert.equal(ledger.customer.due, 14300);
  });

  it('includes sale lines in customer history and preserves the balance on old payment invoices', async () => {
    const customer = await buyer(2000);
    const path = `/customers/${customer.id}`;
    await request(path, { email: 'buyer@example.com', address: 'Mirpur, Dhaka' }, 'PATCH');
    const bill = (await request('/sales', { items: [{ productId: 1, quantity: 2 }], customerId: customer.id, paid: 1000, requestId: 'printable-ledger-sale' })).data;
    const partial = (await request(`${path}/payments`, { amount: 3000, method: 'bkash', note: 'First instalment', date: '2026-02-03', requestId: 'printable-first-payment' })).data;
    const final = (await request(`${path}/payments`, { amount: 13600, method: 'cash', requestId: 'printable-final-payment' })).data;
    await request('/products/1', { name: 'Renamed rice', unit: 'bag' }, 'PATCH');
    const history = (await request(`${path}/ledger`)).data;
    assert.equal(history.sales[0].date, dhakaDate());
    assert.equal(history.sales[0].settled, 15600);
    assert.equal(history.sales[0].due, 0);
    assert.deepEqual(history.sales[0].items, [{ productId: 1, name: 'Miniket Rice', unit: 'kg', quantity: 2, unitPrice: 7800, total: 15600 }]);

    const statement = await request(`${path}/ledger/document`);
    assert.equal(statement.status, 200);
    assert.deepEqual(statement.data.sections[0].columns, ['Bill', 'Date', 'Total', 'Paid at sale', 'Received total', 'Still due']);
    assert.deepEqual(statement.data.sections[1].rows[0].slice(0, 3), [`#${bill.id}`, 'Miniket Rice', '2 kg']);

    const partialPath = `${path}/payments/${partial.id}/invoice`;
    const originalReceipt = (await request(partialPath)).data;
    assert.equal(originalReceipt.status, 'DUE');
    assert.ok(originalReceipt.details.some((field: { label: string; value: string }) => field.label === 'Customer email' && field.value === 'buyer@example.com'));
    assert.deepEqual(originalReceipt.sections[0].rows[0], ['Opening balance', '-', documentMoney(2000), documentMoney(2000), '-']);
    assert.deepEqual(originalReceipt.sections[0].rows[1].slice(3), [documentMoney(1000), documentMoney(13600)]);
    assert.deepEqual(originalReceipt.totals.at(-1), { label: 'Balance after this payment', value: documentMoney(13600) });
    fixture.db.prepare('UPDATE customer_receipts SET remaining_due=NULL WHERE id=?').run(partial.id);
    assert.deepEqual((await request(partialPath)).data, originalReceipt);
    assert.equal((await request(`${path}/payments/${final.id}/invoice`)).data.status, 'PAID');
    assert.equal((await request(partialPath, undefined, 'GET', customerToken)).status, 403);
    assert.equal((await request(`/customers/${(await buyer()).id}/payments/${partial.id}/invoice`)).status, 404);
  });

  it('atomically collects prior dues at checkout while treating only the new bill as new sales', async () => {
    const customer = await buyer(5000);
    const before = (await request('/dashboard')).data;
    const inventory = (await request('/inventory')).data;
    const product = inventory.find((p: any) => p.id === 1);
    const body = { customerId: customer.id, items: [{ productId: 1, quantity: 1 }], paid: 3000, previousDuePayment: 5000, requestId: 'combined-checkout-001' };
    const sale = await request('/sales', body);
    assert.equal(sale.status, 201);
    assert.equal(sale.data.previousDue, 5000);
    assert.equal(sale.data.previousDuePayment, 5000);
    assert.equal(sale.data.due, 4800);
    assert.equal(sale.data.customerBalance, 4800);
    assert.deepEqual((await request('/sales', body)).data, sale.data);
    const after = (await request('/dashboard')).data;
    assert.equal(after.sales, before.sales + product.price);
    assert.equal(after.grossProfit, before.grossProfit + product.price - product.cost);
    assert.equal(after.cashCollected, before.cashCollected + 8000);
    assert.equal((await request(`/customers/${customer.id}/ledger`)).data.customer.openingSettled, 5000);
    const stockAfter = (await request('/inventory')).data.find((p: any) => p.id === 1).stock;
    const rejected = await request('/sales', { ...body, previousDuePayment: 5000, requestId: 'overdue-checkout-002' });
    assert.equal(rejected.status, 400);
    assert.equal((await request('/inventory')).data.find((p: any) => p.id === 1).stock, stockAfter);
    assert.equal((await request('/dashboard')).data.sales, after.sales);
  });

  it('rejects concurrent overcollection and unauthorized ledger access', async () => {
    const customer = await buyer(10_000);
    const results = await Promise.all([1, 2].map(index => request(`/customers/${customer.id}/payments`, { amount: 7000, method: 'cash', requestId: `concurrent-payment-${index}` })));
    assert.deepEqual(results.map(result => result.status).sort(), [201, 400]);
    assert.equal((await request(`/customers/${customer.id}/ledger`)).data.customer.due, 3000);
    assert.equal((await request(`/customers/${customer.id}/ledger`, undefined, 'GET', customerToken)).status, 403);
    assert.equal((await request(`/customers/${customer.id}/payments`, { amount: 1, method: 'cash', requestId: 'customer-cannot-pay' }, 'POST', customerToken)).status, 403);
    assert.equal((await request(`/customers/${customer.id}/payments`, { amount: 1, method: 'cash', date: '2026-02-30', requestId: 'invalid-date-payment' })).status, 400);
  });

  it('updates customer contact details while preserving the original opening balance', async () => {
    const customer = await buyer(1500);
    const update = await request(`/customers/${customer.id}`, { name: 'Updated Buyer', phone: '01811112222', email: 'buyer@example.com', address: 'Mirpur, Dhaka' }, 'PATCH');
    assert.equal(update.status, 200);
    assert.equal(update.data.address, 'Mirpur, Dhaka');
    assert.equal(update.data.due, 1500);
    assert.equal(update.data.openingDue, 1500);
    assert.equal((await request(`/customers/${customer.id}`, { openingDue: 0 }, 'PATCH')).status, 400);
  });

  it('tracks low-stock alert reads per user and resets alerts when stock or thresholds change', async () => {
    const initial = (await request('/stock-alerts')).data;
    assert.ok(initial.items.length > 0);
    assert.equal(initial.unreadCount, initial.items.length);
    await request('/stock-alerts/read', { productIds: initial.items.map((item: any) => item.id) });
    assert.equal((await request('/stock-alerts')).data.unreadCount, 0);
    assert.equal((await request('/stock-alerts', undefined, 'GET', customerToken)).status, 403);
    const milk = initial.items.find((item: any) => item.id === 2);
    assert.ok(milk);
    await request('/purchases', { productId: 2, quantity: 1, unitCost: 7800, requestId: 'alert-restock-001' });
    const milkAfter = (await request('/stock-alerts')).data.items.find((item: any) => item.id === 2);
    assert.equal(milkAfter.stock, milk.stock + 1);
    assert.equal(milkAfter.read, false);
    const rice = (await request('/inventory')).data.find((item: any) => item.id === 1);
    assert.equal((await request('/products/1', { reorderLevel: rice.stock }, 'PATCH')).status, 200);
    assert.equal((await request('/stock-alerts')).data.items.find((item: any) => item.id === 1).read, false);
    assert.equal((await request('/products/1', { stock: 999 }, 'PATCH')).status, 400);
    fixture.db.prepare("UPDATE users SET role='staff' WHERE email='customer@smartshop.local'").run();
    const staffAlerts = (await request('/stock-alerts', undefined, 'GET', customerToken)).data;
    assert.equal(staffAlerts.unreadCount, staffAlerts.items.length);
    assert.equal((await request('/owner/profile', { name: 'Staff edit', phone: '' }, 'PATCH', customerToken)).status, 403);
  });
});
