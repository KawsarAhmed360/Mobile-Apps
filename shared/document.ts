export type DocumentField = { label: string; value: string };

export type ShopDocument = {
  title: string;
  subtitle?: string;
  filename: string;
  shop: { name: string; address?: string; phone?: string; email?: string; logoUrl?: string | null };
  details?: DocumentField[];
  status?: 'PAID' | 'DUE';
  sections: { title?: string; columns: string[]; rows: string[][] }[];
  totals?: DocumentField[];
  note?: string;
};

const amountFormat = new Intl.NumberFormat('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function documentMoney(amount: number): string {
  return `BDT ${amountFormat.format(amount / 100)}`;
}
