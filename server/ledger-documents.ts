import { documentMoney, type DocumentField, type ShopDocument } from '../shared/document.js';
import type { CustomerLedger, LedgerPayment, LedgerSale } from '../shared/ledger.js';
import type { Customer } from '../shared/types.js';

const paymentMethodLabels: Record<string, string> = { cash: 'Cash', bkash: 'bKash', nagad: 'Nagad', bank: 'Bank', other: 'Other' };

function customerDetails(customer: Customer): DocumentField[] {
  return [
    { label: 'Customer', value: customer.name },
    { label: 'Customer phone', value: customer.phone },
    { label: 'Customer email', value: customer.email },
    { label: 'Customer address', value: customer.address },
  ].filter(detail => detail.value);
}

function productDetails(sales: LedgerSale[]): ShopDocument['sections'][number] {
  return {
    title: 'Products by bill',
    columns: ['Bill', 'Product', 'Quantity', 'Unit price', 'Line total'],
    rows: sales.flatMap(sale => sale.items.map(item => [
      '#' + sale.id, item.name, `${item.quantity} ${item.unit}`.trim(),
      documentMoney(item.unitPrice), documentMoney(item.total),
    ])),
  };
}

export function customerHistoryDocument(shop: ShopDocument['shop'], { customer, sales, payments }: CustomerLedger): ShopDocument {
  const openingDue = customer.openingDue ?? 0;
  return {
    title: 'Customer history & payments',
    filename: `smartshop-customer-${customer.id}-history.pdf`,
    shop,
    details: customerDetails(customer),
    sections: [
      {
        title: 'Bill history',
        columns: ['Bill', 'Date', 'Total', 'Paid at sale', 'Received total', 'Still due'],
        rows: sales.map(sale => [
          '#' + sale.id, sale.date, documentMoney(sale.total), documentMoney(sale.paid),
          documentMoney(sale.settled), documentMoney(sale.due),
        ]),
      },
      productDetails(sales),
      {
        title: 'Payments against earlier balances',
        columns: ['Receipt', 'Date', 'Method', 'Note / reference', 'Amount'],
        rows: payments.map(payment => [
          '#' + payment.id, payment.date, paymentMethodLabels[payment.method] ?? payment.method,
          payment.note || '-', documentMoney(payment.amount),
        ]),
      },
    ],
    totals: [
      { label: 'Sale bills total', value: documentMoney(customer.totalSpent) },
      { label: 'Collected at sale', value: documentMoney(sales.reduce((sum, sale) => sum + sale.paid, 0)) },
      ...(openingDue > 0 ? [{ label: 'Opening balance', value: documentMoney(openingDue) }] : []),
      { label: 'Later payments received', value: documentMoney(payments.reduce((sum, payment) => sum + payment.amount, 0)) },
      { label: 'Current balance due', value: documentMoney(customer.due) },
    ],
  };
}

export function customerPaymentDocument(
  shop: ShopDocument['shop'],
  customer: Customer,
  payment: LedgerPayment,
  sales: (LedgerSale & { paymentAmount: number })[],
  remainingAtPayment: number | null,
): ShopDocument {
  const remaining = remainingAtPayment ?? customer.due;
  return {
    title: 'Payment invoice',
    subtitle: `Receipt #${payment.id}`,
    filename: `smartshop-payment-${payment.id}.pdf`,
    shop,
    details: [
      ...customerDetails(customer),
      { label: 'Payment date', value: payment.date },
      { label: 'Payment method', value: paymentMethodLabels[payment.method] ?? payment.method },
      ...(payment.note ? [{ label: 'Note / reference', value: payment.note }] : []),
    ],
    status: remaining > 0 ? 'DUE' : 'PAID',
    sections: [
      {
        title: 'Where this payment was applied',
        columns: ['Bill / balance', 'Bill date', 'Bill total', 'Applied payment', 'Bill due after receipt'],
        rows: [
          ...(payment.openingAmount > 0 ? [['Opening balance', '-', documentMoney(customer.openingDue ?? 0), documentMoney(payment.openingAmount), '-']] : []),
          ...sales.map(sale => [
            '#' + sale.id, sale.date, documentMoney(sale.total),
            documentMoney(sale.paymentAmount), documentMoney(sale.due),
          ]),
        ],
      },
      ...(sales.length ? [productDetails(sales)] : []),
    ],
    totals: [
      ...(remainingAtPayment === null ? [] : [{ label: 'Balance before payment', value: documentMoney(remainingAtPayment + payment.amount) }]),
      { label: 'Amount received', value: documentMoney(payment.amount) },
      { label: remainingAtPayment === null ? 'Current balance due' : 'Balance after this payment', value: documentMoney(remaining) },
    ],
  };
}
