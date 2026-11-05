import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownLeft, CheckCircle2, CreditCard, Mail, MapPin, Pencil, Phone, Plus, ReceiptText, Search, UserRound, Users, Wallet } from 'lucide-react';
import type { Customer } from '../shared/types';
import { mediaUrl, ApiError, api, post } from './api';
import { asCents, dayLabel, Empty, ErrorNotice, Field, Loading, Modal, money, SubmitButton } from './components';
import { newRequestId } from './requestId';
import './management.css';

type LedgerCustomer = Customer & { openingDue?: number; openingSettled?: number };
interface Ledger {
  customer: LedgerCustomer;
  sales: { id: number; total: number; paid: number; settled: number; due: number; createdAt: string }[];
  payments: { id: number; amount: number; method: string; note: string; date: string; createdAt: string }[];
}
type Method = 'cash' | 'bkash' | 'nagad' | 'bank' | 'other';
interface PaymentInput { amount: number; method: Method; note: string; date: string; requestId: string }
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const methods: { value: Method; label: string }[] = [{ value: 'cash', label: 'Cash' }, { value: 'bkash', label: 'bKash' }, { value: 'nagad', label: 'Nagad' }, { value: 'bank', label: 'Bank' }, { value: 'other', label: 'Other' }];

export function CustomersPage({ revision, onChange, onSuccess }: { revision: number; onChange: () => void; onSuccess: (message: string) => void }) {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Customer | 'new' | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError('');
    api<Customer[]>('/customers').then(result => { if (!cancelled) setCustomers(result); }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load customers.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revision, refresh]);
  const changed = () => { setRefresh(value => value + 1); onChange(); };
  const filtered = customers?.filter(customer => [customer.name, customer.phone, customer.email, customer.address].join(' ').toLowerCase().includes(search.trim().toLowerCase())) ?? [];
  return <>
    <div className="ledger-overview"><div><span><Users size={22} /></span><div><strong>{customers?.length ?? 0}</strong><p>Customers</p></div></div><div><span><Wallet size={22} /></span><div><strong>{money(customers?.reduce((sum, item) => sum + item.due, 0) ?? 0)}</strong><p>Total outstanding dues</p></div></div><div><span><ReceiptText size={22} /></span><div><strong>{money(customers?.reduce((sum, item) => sum + item.totalSpent, 0) ?? 0)}</strong><p>Customer sales</p></div></div></div>
    <section className="panel management-panel customer-directory"><div className="customer-directory-heading"><div><h2>Your customers</h2><p>Contact details, purchase history and money owed.</p></div><button className="button button-primary" onClick={() => setEditing('new')}><Plus size={18} />Add customer</button></div><div className="search-box"><Search size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, phone or address…" aria-label="Search customers" /></div><ErrorNotice>{error}</ErrorNotice>
      {loading && !customers ? <Loading label="Loading customer details…" /> : !filtered.length ? <Empty title={search ? 'No matching customers' : 'Keep your customers close'} message={search ? 'Try another name, phone number or address.' : 'Add a customer to save their details and track purchases and dues.'} /> : <div className="customer-directory-list">{filtered.map(customer => <article className="customer-directory-card" key={customer.id}><div className="customer-directory-top"><span className="ledger-avatar">{customer.avatarUrl ? <img src={mediaUrl(customer.avatarUrl)} alt="" className="account-photo"/> : customer.name.charAt(0).toUpperCase()}</span><div><h3>{customer.name}</h3><span>{customer.purchases} {customer.purchases === 1 ? 'purchase' : 'purchases'}</span></div><button className="icon-button" aria-label={`Edit ${customer.name}`} onClick={() => setEditing(customer)}><Pencil size={17} /></button></div><div className="customer-contact-lines">{customer.phone && <p><Phone size={15} /><span>{customer.phone}</span></p>}{customer.email && <p><Mail size={15} /><span>{customer.email}</span></p>}{customer.address && <p><MapPin size={15} /><span>{customer.address}</span></p>}{!customer.phone && !customer.email && !customer.address && <p className="management-hint">No contact details added yet.</p>}</div><div className="customer-card-amounts"><div><span>Total sales</span><strong>{money(customer.totalSpent)}</strong></div><div><span>Balance due</span><strong className={customer.due > 0 ? 'amount-due' : ''}>{money(customer.due)}</strong></div></div><button className="button button-outline button-full" onClick={() => setSelected(customer)}><ReceiptText size={17} />History & payments</button></article>)}</div>}
    </section>
    {editing && <CustomerForm customer={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); changed(); onSuccess(editing === 'new' ? 'Customer added.' : 'Customer details updated.'); }} />}
    {selected && <CustomerLedgerDialog customer={selected} revision={revision} onClose={() => setSelected(null)} onChanged={changed} onSuccess={onSuccess} />}
  </>;
}

function CustomerForm({ customer, onClose, onSaved }: { customer: Customer | null; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const body = { name: String(form.get('name') || '').trim(), phone: String(form.get('phone') || '').trim(), email: String(form.get('email') || '').trim(), address: String(form.get('address') || '').trim(), ...(!customer ? { openingDue: asCents(String(form.get('openingDue') || '0')) } : {}) };
    try { if (customer) await api(`/customers/${customer.id}`, { method: 'PATCH', body: JSON.stringify(body) }); else await post('/customers', body); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save customer details.'); }
    finally { setBusy(false); }
  };
  return <Modal title={customer ? 'Edit customer details' : 'Add a customer'} eyebrow="YOUR CUSTOMERS" onClose={onClose}><form className="form-stack" onSubmit={submit}><Field label="Customer name"><input name="name" defaultValue={customer?.name || ''} minLength={2} maxLength={80} required disabled={busy} autoComplete="name" placeholder="Full name" /></Field><Field label="Phone number"><input name="phone" type="tel" defaultValue={customer?.phone || ''} maxLength={30} disabled={busy} autoComplete="tel" placeholder="Contact number" /></Field><Field label="Email address"><input name="email" type="email" defaultValue={customer?.email || ''} maxLength={254} disabled={busy} autoComplete="email" placeholder="Optional email" /></Field><Field label="Address"><textarea name="address" defaultValue={customer?.address || ''} maxLength={300} rows={3} disabled={busy} autoComplete="street-address" placeholder="Street, area, city" /></Field>{!customer && <Field label="Opening balance due (৳)" hint="Money the customer already owed before you started using SmartShop. This is recorded as an opening balance."><input name="openingDue" type="number" min="0" max="1000000" step="0.01" defaultValue="0" disabled={busy} /></Field>}<ErrorNotice>{error}</ErrorNotice><SubmitButton busy={busy}><UserRound size={17} />{customer ? 'Save customer details' : 'Add customer'}</SubmitButton></form></Modal>;
}

function CustomerLedgerDialog({ customer, revision, onClose, onChanged, onSuccess }: { customer: Customer; revision: number; onClose: () => void; onChanged: () => void; onSuccess: (message: string) => void }) {
  const [data, setData] = useState<Ledger | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0), [busy, setBusy] = useState(false), [locked, setLocked] = useState(false);
  const [amount, setAmount] = useState(''), [method, setMethod] = useState<Method>('cash'), [note, setNote] = useState(''), [date, setDate] = useState(today);
  const [paymentError, setPaymentError] = useState(''), [receipt, setReceipt] = useState<{ amount: number; remainingDue: number } | null>(null);
  const pending = useRef<PaymentInput | null>(null);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError('');
    api<Ledger>(`/customers/${customer.id}/ledger`).then(result => { if (!cancelled) setData(result); }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the customer ledger.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [customer.id, revision, refresh]);
  const receive = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setPaymentError(''); setReceipt(null);
    if (!pending.current) pending.current = { amount: asCents(amount), method, note: note.trim(), date, requestId: newRequestId() };
    setLocked(true);
    try {
      const result = await post<{ id: number; amount: number; remainingDue: number }>(`/customers/${customer.id}/payments`, pending.current);
      pending.current = null; setLocked(false); setAmount(''); setNote(''); setReceipt(result); setRefresh(value => value + 1); onChanged(); onSuccess(`${money(result.amount)} received from ${customer.name}.`);
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Could not record the payment.');
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) { pending.current = null; setLocked(false); setRefresh(value => value + 1); }
    } finally { setBusy(false); }
  };
  const current = data?.customer ?? customer;
  return <Modal title={`${current.name}’s account`} eyebrow="CUSTOMER LEDGER" onClose={onClose} wide><div className="ledger-customer-contact">{current.phone && <span><Phone size={14} />{current.phone}</span>}{current.address && <span><MapPin size={14} />{current.address}</span>}</div><div className="customer-ledger-balance"><div><span>Current balance due</span><strong>{money(current.due)}</strong></div><Wallet size={29} /></div><ErrorNotice>{error}</ErrorNotice>{loading && !data ? <Loading label="Loading purchases and payments…" /> : data && <>
    {(data.customer.openingDue ?? 0) > 0 && <div className="opening-balance-note"><strong>Opening balance</strong><span>Brought forward: {money(data.customer.openingDue ?? 0)}</span><span>Collected: {money(data.customer.openingSettled ?? 0)}</span></div>}
    <section className="ledger-payment-section"><div className="management-section-heading compact"><span><ArrowDownLeft size={19} /></span><div><h3>Receive a payment</h3><p>Collect money against this customer’s outstanding balance.</p></div></div>{current.due > 0 || locked ? <form className="form-stack" onSubmit={receive}><div className="form-grid"><Field label="Amount received (৳)"><input type="number" min="0.01" max={current.due / 100} step="0.01" value={amount} onChange={event => setAmount(event.target.value)} required disabled={locked} placeholder="0.00" /></Field><Field label="Payment method"><select value={method} onChange={event => setMethod(event.target.value as Method)} disabled={locked}>{methods.map(item => <option value={item.value} key={item.value}>{item.label}</option>)}</select></Field><Field label="Payment date"><input type="date" value={date} onChange={event => setDate(event.target.value)} required disabled={locked} /></Field><Field label="Note / reference"><input value={note} onChange={event => setNote(event.target.value)} maxLength={300} disabled={locked} placeholder="Optional reference" /></Field></div><ErrorNotice>{paymentError}</ErrorNotice>{locked && paymentError && <p className="management-hint">Retry sends the same payment safely. Check payment history before recording a replacement.</p>}<SubmitButton busy={busy} disabled={!locked && (!Number.isFinite(Number(amount)) || asCents(amount) <= 0 || asCents(amount) > current.due)}><CreditCard size={17} />{locked ? 'Retry this payment' : 'Record payment'}</SubmitButton></form> : <p className="management-success"><CheckCircle2 size={17} />This customer has no outstanding balance.</p>}{receipt && <div className="ledger-payment-receipt" role="status"><CheckCircle2 size={20} /><div><strong>{money(receipt.amount)} received</strong><span>Remaining balance due: {money(receipt.remainingDue)}</span></div></div>}</section>
    <section className="ledger-history-section"><h3><ReceiptText size={18} />Purchase history</h3>{!data.sales.length ? <p className="management-hint">No sales have been recorded for this customer.</p> : <div className="table-scroll"><table className="ledger-sales-table"><thead><tr><th>Bill</th><th>Date</th><th>Total</th><th>Paid at sale</th><th>Received total</th><th>Still due</th></tr></thead><tbody>{data.sales.map(sale => <tr key={sale.id}><td>#{sale.id}</td><td>{dayLabel(sale.createdAt)}</td><td>{money(sale.total)}</td><td>{money(sale.paid)}</td><td>{money(sale.settled)}</td><td className={sale.due > 0 ? 'amount-due' : ''}>{money(sale.due)}</td></tr>)}</tbody></table></div>}</section>
    <section className="ledger-history-section"><h3><ArrowDownLeft size={18} />Payment history</h3>{!data.payments.length ? <p className="management-hint">Payments collected against earlier dues will appear here.</p> : <div className="ledger-payment-list">{data.payments.map(payment => <article key={payment.id}><span><CreditCard size={19} /></span><div><strong>{methods.find(item => item.value === payment.method)?.label || payment.method} payment</strong><p>{dayLabel(payment.date || payment.createdAt)}{payment.note && ` · ${payment.note}`}</p></div><strong>{money(payment.amount)}</strong></article>)}</div>}</section>
    </>}</Modal>;
}
