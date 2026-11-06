import { useEffect, useState } from 'react';
import { api } from './api';
import { ErrorNotice, Field, Modal } from './components';
import { PdfDownloadButton } from './PdfDownloadButton';

const reportLabels = {
  expenses: 'Expenses',
  sales: 'Sales',
  purchases: 'Purchases',
  products: 'Products added',
};
type ReportType = keyof typeof reportLabels;
type Transaction = { id: number; name: string; date: string };

export function ReportsDialog({ onClose }: { onClose: () => void }) {
  const [today] = useState(() => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()));
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [type, setType] = useState<ReportType>('sales');
  const query = new URLSearchParams({ type, from, to }).toString();
  const validRange = !!from && !!to && from <= to;

  return <Modal title="Download reports" eyebrow="SHOP RECORDS" onClose={onClose}>
    <div className="form-stack">
      <Field label="Report type">
        <select value={type} onChange={event => setType(event.target.value as ReportType)}>
          {Object.entries(reportLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </Field>
      <div className="form-grid">
        <Field label="From date"><input type="date" value={from} max={to || undefined} onChange={event => setFrom(event.target.value)} /></Field>
        <Field label="To date"><input type="date" value={to} min={from || undefined} onChange={event => setTo(event.target.value)} /></Field>
      </div>
      <p className="form-note">Both dates are included. Reports use Dhaka time.</p>
      <ErrorNotice>{!validRange && 'Choose a start date and an end date in order.'}</ErrorNotice>
      {validRange && <>
        <PdfDownloadButton key={query} path={`/reports?${query}`} label="Download report PDF" />
        {(type === 'sales' || type === 'purchases') && <TransactionDownload key={query} type={type} query={query} />}
      </>}
    </div>
  </Modal>;
}

function TransactionDownload({ type, query }: { type: 'sales' | 'purchases'; query: string }) {
  const [items, setItems] = useState<Transaction[] | null>(null);
  const [id, setId] = useState('');
  const [error, setError] = useState('');
  const title = type === 'sales' ? 'Sale invoice' : 'Purchase bill';
  useEffect(() => {
    const controller = new AbortController();
    api<{ items: Transaction[] }>(`/reports/transactions?${query}`, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setItems(data.items); })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Could not load transactions.'); });
    return () => controller.abort();
  }, [query]);

  return <>
    <Field label={`Reprint a ${title.toLowerCase()}`}>
      <select value={id} disabled={!items?.length} onChange={event => setId(event.target.value)}>
        <option value="">{error ? 'Transactions unavailable' : !items ? 'Loading transactions…' : !items.length ? 'No transactions in this range' : 'Select a transaction'}</option>
        {items?.map(item => <option key={item.id} value={item.id}>#{item.id} · {item.date} · {item.name}</option>)}
      </select>
    </Field>
    <ErrorNotice>{error}</ErrorNotice>
    {id && <PdfDownloadButton key={id} path={type === 'sales' ? `/sales/${id}/invoice` : `/purchases/${id}/bill`} label={`Download ${title.toLowerCase()} PDF`} />}
  </>;
}
