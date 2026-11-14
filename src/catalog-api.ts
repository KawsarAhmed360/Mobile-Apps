import { createTRPCClient, httpLink, isTRPCClientError } from '@trpc/client';
import type { AppRouter, CatalogInput } from '../server/catalog-rpc.js';
import type { ProductPage } from '../shared/types';
import { api, getApiBaseUrl } from './api';

export async function fetchCatalogProducts(input: CatalogInput, signal: AbortSignal) {
  const base = getApiBaseUrl();
  const client = createTRPCClient<AppRouter>({
    links: [httpLink({
      url: `${base}/api/trpc`,
      fetch: (url, options) => fetch(url, { ...options, redirect: 'error' }),
    })],
  });

  try {
    return await client.catalog.products.query(input, { signal });
  } catch (error) {
    if (isTRPCClientError<AppRouter>(error)) {
      const response = error.meta?.response;
      const body = error.meta?.responseJSON;
      // A newer phone build can still read the catalog from an older Mac server.
      if (response instanceof Response && response.status === 404 &&
        body && typeof body === 'object' && 'error' in body && body.error === 'API endpoint not found.') {
        if (signal.aborted || getApiBaseUrl() !== base) throw error;
        const query = new URLSearchParams({ ...input, page: String(input.page), limit: String(input.limit) });
        return api<ProductPage>(`/products?${query}`, { signal });
      }
      if (!response && !signal.aborted) {
        throw new Error('Could not connect to SmartShop. Check your connection and keep the development server running on your Mac.');
      }
    }
    throw error;
  }
}
