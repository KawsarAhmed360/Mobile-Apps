import { initTRPC } from '@trpc/server';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { z } from 'zod';
import type { ProductPage } from '../shared/types.js';

export const catalogInput = z.object({
  search: z.string().max(100).default(''),
  category: z.string().max(60).default(''),
  page: z.coerce.number<number | string>().int().min(1).max(100_000).default(1),
  limit: z.coerce.number<number | string>().int().min(1).max(100).default(8),
});

export type CatalogInput = z.output<typeof catalogInput>;

const t = initTRPC.create({ isDev: false });

function createCatalogRouter(listProducts: (input: CatalogInput) => ProductPage) {
  return t.router({
    catalog: t.router({
      products: t.procedure.input(catalogInput).query(({ input }) => listProducts(input)),
    }),
  });
}

export type AppRouter = ReturnType<typeof createCatalogRouter>;

export function catalogRpc(listProducts: (input: CatalogInput) => ProductPage) {
  return createExpressMiddleware({
    router: createCatalogRouter(listProducts),
    allowBatching: false,
  });
}
