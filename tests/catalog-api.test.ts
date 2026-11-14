import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setApiBaseUrl } from '../src/api';
import { fetchCatalogProducts } from '../src/catalog-api';
import type { ProductPage } from '../shared/types';

test('the catalog falls back to REST only when the selected shop runs the older API', async t => {
  const baseUrl = 'http://192.168.1.5:3001';
  setApiBaseUrl(baseUrl);
  const input = { search: 'Tea & coffee', category: 'Pantry', page: 2, limit: 8 };
  const page: ProductPage = { items: [], total: 0, page: 2, pages: 1, categories: ['Pantry'] };
  const signal = new AbortController().signal;
  const requests: string[] = [];
  let rpcError = { status: 404, message: 'API endpoint not found.' };

  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    const requestedUrl = new URL(String(url));
    assert.equal(requestedUrl.origin, baseUrl);
    requests.push(requestedUrl.pathname);
    if (requestedUrl.pathname === '/api/trpc/catalog.products') {
      assert.deepEqual(JSON.parse(requestedUrl.searchParams.get('input')!), input);
      return Response.json({ error: rpcError.message }, { status: rpcError.status });
    }
    assert.equal(requestedUrl.pathname, '/api/products');
    assert.deepEqual(Object.fromEntries(requestedUrl.searchParams), { ...input, page: '2', limit: '8' });
    return Response.json(page);
  });

  assert.deepEqual(await fetchCatalogProducts(input, signal), page);
  assert.deepEqual(requests, ['/api/trpc/catalog.products', '/api/products']);

  requests.length = 0;
  rpcError = { status: 404, message: 'Shop is unavailable.' };
  await assert.rejects(fetchCatalogProducts(input, signal));
  assert.deepEqual(requests, ['/api/trpc/catalog.products']);
});
