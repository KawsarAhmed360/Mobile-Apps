import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { documentMoney, type ShopDocument } from '../shared/document.js';
import type { SyncDatabase } from './database.js';
import { saleLineItems } from './sale-lines.js';

const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date in YYYY-MM-DD format.').refine(value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, 'Enter a valid calendar date.');

const range = z.object({ from: businessDate, to: businessDate });
const inOrder = ({ from, to }: z.infer<typeof range>) => from <= to;
const reportQuery = range.extend({ type: z.enum(['expenses', 'sales', 'purchases', 'products']) })
  .refine(inOrder, 'The end date must be on or after the start date.');
const transactionQuery = range.extend({ type: z.enum(['sales', 'purchases']) })
  .refine(inOrder, 'The end date must be on or after the start date.');
const dhakaFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' });
const purchaseSql = `SELECT p.id, p.created_at, p.supplier, p.reference, p.quantity, p.unit_cost,
    COALESCE(p.product_name, i.name) name, COALESCE(p.product_unit, i.unit) unit,
    COALESCE(p.product_category, i.category) category
  FROM purchases p JOIN products i ON i.id=p.product_id`;

type Section = ShopDocument['sections'][number];
type Totals = NonNullable<ShopDocument['totals']>;

function dateRangeUtc({ from, to }: z.infer<typeof range>) {
  const start = new Date(`${from}T00:00:00+06:00`);
  const end = new Date(`${to}T00:00:00+06:00`);
  return [start.toISOString(), new Date(end.getTime() + 86_400_000).toISOString()] as const;
}

function dateLabel(timestamp: string) {
  return dhakaFormatter.format(new Date(timestamp));
}

export function mountReports(app: Express, { db, auth, staff, getShop }: {
  db: SyncDatabase;
  auth: RequestHandler;
  staff: RequestHandler;
  getShop: () => ShopDocument['shop'];
}) {
  const readPurchases = (dates: z.infer<typeof range>) => db.prepare(`${purchaseSql}
    WHERE p.created_at>=? AND p.created_at<? ORDER BY p.created_at DESC,p.id DESC`).all(...dateRangeUtc(dates));

  app.get('/api/reports/transactions', auth, staff, (req, res) => {
    const query = transactionQuery.parse(req.query);
    if (query.type === 'purchases') {
      const items = readPurchases(query).map(row => ({ id: row.id, date: dateLabel(row.created_at), name: row.name }));
      res.json({ items });
      return;
    }
    const items = db.prepare(`SELECT s.id,s.business_date date,COALESCE(NULLIF(s.customer_name,''),c.name,'Walk-in customer') name
      FROM sales s LEFT JOIN customers c ON c.id=s.customer_id
      WHERE s.business_date BETWEEN ? AND ? ORDER BY s.business_date DESC,s.id DESC`).all(query.from, query.to);
    res.json({ items });
  });

  app.get('/api/reports', auth, staff, (req, res) => {
    const query = reportQuery.parse(req.query);
    const { type, from, to } = query;
    const sections: Section[] = [];
    const totals: Totals = [];
    const titles = { expenses: 'Expense Report', sales: 'Sales Report', purchases: 'Purchase Report', products: 'Products Added Report' };
    const document: ShopDocument = {
      title: titles[type], subtitle: `Date range: ${from} to ${to} (Dhaka)`,
      filename: `SmartShop-${type}-${from}-to-${to}.pdf`, shop: getShop(), sections, totals,
    };
    switch (type) {
      case 'expenses': {
        const expenses = db.prepare('SELECT id,title,amount,business_date FROM expenses WHERE business_date BETWEEN ? AND ? ORDER BY business_date DESC,id DESC').all(from, to);
        sections.push({
          columns: ['Expense', 'Date', 'Details', 'Amount'],
          rows: expenses.map(row => [`#${row.id}`, row.business_date, row.title, documentMoney(row.amount)]),
        });
        totals.push({ label: 'Total expenses', value: documentMoney(expenses.reduce((sum, row) => sum + row.amount, 0)) });
        break;
      }
      case 'sales': {
        const sales = db.prepare(`SELECT s.id,s.business_date,s.total,s.paid,COALESCE(NULLIF(s.customer_name,''),c.name,'Walk-in customer') customer,
            COALESCE((SELECT SUM(a.amount) FROM receipt_allocations a JOIN customer_receipts r ON r.id=a.receipt_id
              WHERE a.sale_id=s.id AND r.business_date<=?),0) allocated
          FROM sales s LEFT JOIN customers c ON c.id=s.customer_id
          WHERE s.business_date BETWEEN ? AND ? ORDER BY s.business_date DESC,s.id DESC`).all(to, from, to);
        sections.push({
          title: 'Bills and payments',
          columns: ['Bill', 'Date', 'Customer', 'Total', 'Paid at Sale', 'Received Total', 'Still Due'],
          rows: sales.map(row => [`#${row.id}`, row.business_date, row.customer, documentMoney(row.total), documentMoney(row.paid),
            documentMoney(row.paid + row.allocated), documentMoney(row.total - row.paid - row.allocated)]),
        });
        const lines = saleLineItems(db, sales.map(row => row.id));
        sections.push({
          title: 'Products sold',
          columns: ['Bill', 'Product', 'Quantity', 'Unit Price', 'Line Total'],
          rows: sales.flatMap(row => (lines.get(row.id) ?? []).map(line => [
            `#${row.id}`, line.name, `${line.quantity} ${line.unit}`, documentMoney(line.unitPrice), documentMoney(line.total),
          ])),
        });
        const summary = sales.reduce((sum, row) => ({ sales: sum.sales + row.total, received: sum.received + row.paid + row.allocated }), { sales: 0, received: 0 });
        totals.push({ label: 'Total sales', value: documentMoney(summary.sales) }, { label: 'Received total', value: documentMoney(summary.received) },
          { label: 'Still due', value: documentMoney(summary.sales - summary.received) });
        document.note = 'Received and due amounts include later payments dated on or before the end of the report range.';
        break;
      }
      case 'purchases': {
        const purchases = readPurchases(query);
        sections.push({
          columns: ['Bill', 'Date', 'Product', 'Quantity', 'Unit Cost', 'Supplier / Reference', 'Total'],
          rows: purchases.map(row => [`#${row.id}`, dateLabel(row.created_at), row.name, `${row.quantity} ${row.unit}`,
            documentMoney(row.unit_cost), [row.supplier, row.reference].filter(Boolean).join('\n') || '-', documentMoney(row.quantity * row.unit_cost)]),
        });
        totals.push({ label: 'Total purchases', value: documentMoney(purchases.reduce((sum, row) => sum + row.quantity * row.unit_cost, 0)) });
        break;
      }
      case 'products': {
        const products = db.prepare(`SELECT p.id,p.name,p.category,p.unit,p.cost,p.price,p.stock,p.created_at,p.archived_at,p.supplier,p.reference,
            (SELECT m.quantity FROM stock_movements m WHERE m.product_id=p.id AND m.type='opening' ORDER BY m.id LIMIT 1) opening_stock
          FROM products p WHERE p.created_at>=? AND p.created_at<? ORDER BY p.created_at DESC,p.id DESC`).all(...dateRangeUtc(query));
        sections.push({
          columns: ['Added', 'Product', 'Category', 'Opening Qty', 'Current Qty', 'Unit Cost', 'Selling Price', 'Supplier / Reference'],
          rows: products.map(row => [dateLabel(row.created_at), `#${row.id} ${row.name}${row.archived_at ? ' (archived)' : ''}`, row.category,
            row.opening_stock === null ? '-' : String(row.opening_stock), `${row.stock} ${row.unit}`, documentMoney(row.cost), documentMoney(row.price),
            [row.supplier, row.reference].filter(Boolean).join('\n') || '-']),
        });
        totals.push({ label: 'Products added', value: String(products.length) });
        document.note = 'Opening quantity is the quantity first recorded. Other product details reflect the saved product record.';
        break;
      }
    }
    res.json(document);
  });

  app.get('/api/purchases/:id/bill', auth, staff, (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const row = db.prepare(`${purchaseSql} WHERE p.id=?`).get(id);
    if (!row) {
      res.status(404).json({ error: 'This purchase could not be found.' });
      return;
    }
    const total = documentMoney(row.quantity * row.unit_cost);
    const bill: ShopDocument = {
      title: 'Purchase Bill', filename: `SmartShop-Purchase-${id}.pdf`, shop: getShop(),
      details: [
        { label: 'Purchase bill', value: `#${id}` }, { label: 'Date (Dhaka)', value: dateLabel(row.created_at) },
        { label: 'Supplier', value: row.supplier || '-' }, { label: 'Reference', value: row.reference || '-' },
      ],
      sections: [{
        columns: ['Product', 'Category', 'Quantity', 'Unit Cost', 'Line Total'],
        rows: [[row.name, row.category, `${row.quantity} ${row.unit}`, documentMoney(row.unit_cost), total]],
      }],
      totals: [{ label: 'Total purchase cost', value: total }],
    };
    res.json(bill);
  });
}
