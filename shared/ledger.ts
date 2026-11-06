import type { Customer } from './types.js';

export type SaleLine = { productId: number; name: string; unit: string; quantity: number; unitPrice: number; total: number };

export interface LedgerSale {
  id: number;
  total: number;
  paid: number;
  settled: number;
  due: number;
  date: string;
  createdAt: string;
  items: SaleLine[];
}

export interface LedgerPayment {
  id: number;
  amount: number;
  openingAmount: number;
  method: string;
  note: string;
  date: string;
  createdAt: string;
}

export interface CustomerLedger {
  customer: Customer;
  sales: LedgerSale[];
  payments: LedgerPayment[];
}
