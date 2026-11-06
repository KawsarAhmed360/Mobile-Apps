import type { SaleLine } from '../shared/ledger.js';
import type { SyncDatabase } from './database.js';

export function saleLineItems(db: SyncDatabase, saleIds: number[]): Map<number, SaleLine[]> {
  const grouped = new Map<number, SaleLine[]>();
  for (let index = 0; index < saleIds.length; index += 100) {
    const ids = saleIds.slice(index, index + 100);
    const rows = db.prepare(`SELECT i.sale_id, i.product_id, i.quantity, i.unit_price,
      COALESCE(i.product_name,p.name) name, COALESCE(i.product_unit,p.unit) unit
      FROM sale_items i JOIN products p ON p.id=i.product_id
      WHERE i.sale_id IN (${ids.map(() => '?').join(',')}) ORDER BY i.sale_id,i.id`).all(...ids);
    for (const row of rows) {
      const lines = grouped.get(row.sale_id) ?? [];
      lines.push({ productId: row.product_id, name: row.name, unit: row.unit, quantity: row.quantity, unitPrice: row.unit_price, total: row.quantity * row.unit_price });
      grouped.set(row.sale_id, lines);
    }
  }
  return grouped;
}
