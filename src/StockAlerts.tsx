import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, PackageCheck, RefreshCw, X } from 'lucide-react';
import { api, post } from './api';
import { ErrorNotice, Loading } from './components';
import './management.css';

interface AlertData { items: { id: number; name: string; stock: number; unit: string; reorderLevel: number; read: boolean }[]; unreadCount: number }

export function StockAlerts({ revision, onOpenStock }: { revision: number; onOpenStock: () => void }) {
  const [open, setOpen] = useState(false), [data, setData] = useState<AlertData | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  const container = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let cancelled = false; setLoading(true); setError('');
    api<AlertData>('/stock-alerts').then(result => { if (!cancelled) setData(result); }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load stock alerts.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [revision, refresh]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const markRead = async () => {
    if (busy || !data) return; setBusy(true); setError('');
    try { await post('/stock-alerts/read', { productIds: data.items.filter(item => !item.read).map(item => item.id) }); setRefresh(value => value + 1); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not mark alerts as read.'); }
    finally { setBusy(false); }
  };
  const openStock = () => { setOpen(false); onOpenStock(); };
  return <div className="stock-alert-anchor" ref={container}><button ref={button} className="icon-button stock-alert-bell" aria-label={`Stock alerts, ${data?.unreadCount ?? 0} unread`} aria-expanded={open} aria-controls="stock-alert-panel" aria-haspopup="dialog" onClick={() => setOpen(value => !value)}><Bell size={20} />{!!data?.unreadCount && <span className="stock-alert-badge" aria-hidden="true">{data.unreadCount > 99 ? '99+' : data.unreadCount}</span>}</button>{open && <section className="stock-alert-popover" id="stock-alert-panel" role="dialog" aria-label="Low stock alerts"><div className="stock-alert-heading"><div><h3>Stock alerts</h3><p>Stay ready for the next sale.</p></div><button className="icon-button" aria-label="Close stock alerts" onClick={() => setOpen(false)}><X size={18} /></button></div><ErrorNotice>{error}</ErrorNotice>{error && <button className="text-button" onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15} />Retry</button>}{loading && !data ? <Loading label="Checking stock…" /> : !data?.items.length ? <div className="stock-alert-empty"><PackageCheck size={32} /><strong>Your shelves look good</strong><p>No products are at or below their reorder level.</p></div> : <div className="stock-alert-items">{data.items.map(item => <button className={`stock-alert-item ${item.read ? 'is-read' : ''}`} key={item.id} onClick={openStock}><span className={`stock-alert-indicator ${item.stock === 0 ? 'empty' : ''}`} /><div><strong>{item.name}</strong><p>{item.stock === 0 ? 'Out of stock' : `${item.stock} ${item.unit} left`}<span> · Alert at {item.reorderLevel} {item.unit}</span></p></div>{!item.read && <span className="stock-alert-unread-dot" aria-label="Unread" />}</button>)}</div>}<div className="stock-alert-footer">{!!data?.unreadCount && <button className="text-button" disabled={busy} onClick={markRead}><CheckCheck size={15} />{busy ? 'Saving…' : 'Mark all as read'}</button>}<button className="button button-primary button-small" onClick={openStock}>Manage stock</button></div><p className="stock-alert-live-note">Alerts update while SmartShop is open.</p></section>}</div>;
}
