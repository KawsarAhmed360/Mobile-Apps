import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../server/app.js';

test('date range reports include the Dhaka endpoints, preserve purchase details and require staff access', async () => {
  const fixture = createApp({ dbPath: ':memory:' });
  const server = fixture.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  let owner: string | undefined;
  async function request(path: string, { method, body, token = owner }: { method?: string; body?: object; token?: string } = {}) {
    const response = await fetch(base + path, {
      method: method ?? (body ? 'POST' : 'GET'),
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json() as any };
  }

  try {
    const date = '2026-05-17';
    const range = `from=${date}&to=${date}`;
    assert.equal((await request(`/reports?type=expenses&${range}`)).status, 401);
    owner = (await request('/auth/login', { body: { email: 'owner@smartshop.local', password: 'SmartShop@123' } })).data.token;
    const customer = (await request('/auth/login', { body: { email: 'customer@smartshop.local', password: 'Customer@123' } })).data.token;
    assert.ok(owner && customer);
    assert.equal((await request(`/reports?type=expenses&${range}`, { token: customer })).status, 403);
    assert.equal((await request('/reports?type=expenses&from=2026-05-18&to=2026-05-17')).status, 400);
    assert.equal((await request('/reports?type=expenses&from=2026-02-30&to=2026-03-01')).status, 400);

    const product = await request('/products', { body: {
      name: 'Fixture coffee', category: 'Coffee', unit: 'bag', price: 79900, cost: 52000, stock: 5,
      reorderLevel: 2, supplier: 'Dhaka Coffee Traders', reference: 'Stock-001',
    } });
    assert.equal(product.status, 201);
    const productId = product.data.id;
    assert.equal(product.data.supplier, 'Dhaka Coffee Traders');
    assert.equal((await request(`/products/${productId}`, { token: '' })).data.supplier, undefined);

    const purchase = async (requestId: string, reference: string) => request('/purchases', {
      body: { productId, quantity: 2, unitCost: 50000, reference, requestId },
    });
    const first = await purchase('fixture-purchase-start', 'Supplier invoice 1');
    const second = await purchase('fixture-purchase-end', 'Supplier invoice 2');
    const next = await purchase('fixture-purchase-next', 'Supplier invoice 3');
    for (const response of [first, second, next]) assert.equal(response.status, 201);
    const at = fixture.db.prepare('UPDATE purchases SET created_at=? WHERE id=?');
    at.run('2026-05-16T18:00:00.000Z', first.data.id);
    at.run('2026-05-17T17:59:59.999Z', second.data.id);
    at.run('2026-05-17T18:00:00.000Z', next.data.id);
    fixture.db.prepare('UPDATE products SET created_at=? WHERE id=?').run('2026-05-16T18:00:00.000Z', productId);

    assert.equal((await request(`/products/${productId}`, { method: 'PATCH', body: { name: 'Renamed coffee', unit: 'box', supplier: 'Other supplier' } })).status, 200);
    const bill = await request(`/purchases/${first.data.id}/bill`);
    assert.equal(bill.status, 200);
    assert.deepEqual(bill.data.sections[0].rows[0], ['Fixture coffee', 'Coffee', '2 bag', 'BDT 500.00', 'BDT 1,000.00']);
    assert.ok(bill.data.details.some((detail: { label: string; value: string }) => detail.label === 'Supplier' && detail.value === 'Dhaka Coffee Traders'));
    assert.equal((await request(`/purchases/${first.data.id}/bill`, { token: customer })).status, 403);
    const purchases = await request(`/reports?type=purchases&${range}`);
    assert.equal(purchases.data.sections[0].rows.length, 2);
    assert.equal(purchases.data.totals[0].value, 'BDT 2,000.00');
    const transactions = await request(`/reports/transactions?type=purchases&${range}`);
    assert.deepEqual(transactions.data.items.map((item: { id: number }) => item.id), [second.data.id, first.data.id]);

    assert.equal((await request('/expenses', { body: { title: 'Fixture paper', amount: 12345, date, requestId: 'fixture-expense-paper' } })).status, 201);
    const expenses = await request(`/reports?type=expenses&${range}`);
    assert.equal(expenses.data.sections[0].rows[0][2], 'Fixture paper');
    assert.equal(expenses.data.totals[0].value, 'BDT 123.45');

    const buyer = await request('/customers', { body: { name: 'Fixture Buyer' } });
    assert.equal(buyer.status, 201);
    const sale = await request('/sales', { body: {
      items: [{ productId, quantity: 1 }], customerId: buyer.data.id, paid: 10000, requestId: 'fixture-sale-coffee',
    } });
    assert.equal(sale.status, 201);
    fixture.db.prepare('UPDATE sales SET business_date=? WHERE id=?').run(date, sale.data.id);
    for (const [amount, paymentDate] of [[20000, date], [49900, '2026-05-18']]) {
      const payment = await request(`/customers/${buyer.data.id}/payments`, {
        body: { amount, date: paymentDate, method: 'cash', requestId: `fixture-report-payment-${paymentDate}` },
      });
      assert.equal(payment.status, 201);
    }
    const sales = await request(`/reports?type=sales&${range}`);
    assert.equal(sales.data.sections[0].rows[0][0], `#${sale.data.id}`);
    assert.deepEqual(sales.data.sections[1].rows[0], [`#${sale.data.id}`, 'Renamed coffee', '1 box', 'BDT 799.00', 'BDT 799.00']);
    assert.equal(sales.data.totals.find((field: { label: string }) => field.label === 'Still due').value, 'BDT 499.00');

    assert.equal((await request(`/products/${productId}`, { method: 'DELETE' })).status, 200);
    const products = await request(`/reports?type=products&${range}`);
    assert.equal(products.data.sections[0].rows.length, 1);
    assert.match(products.data.sections[0].rows[0][1], /Renamed coffee \(archived\)/);
    assert.equal(products.data.sections[0].rows[0][3], '5');
    assert.equal(products.data.sections[0].rows[0][7], 'Other supplier\nStock-001');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fixture.close();
  }
});
