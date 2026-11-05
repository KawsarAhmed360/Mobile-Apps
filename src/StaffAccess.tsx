import { useEffect, useState } from 'react';
import { Search, ShieldCheck, UserRoundCheck, Users } from 'lucide-react';
import type { User } from '../shared/types';
import { mediaUrl, api } from './api';
import { Empty, ErrorNotice, Loading } from './components';

type Directory = { items: User[]; total: number; page: number; pages: number };

export function StaffAccess({ revision, onSaved }: { revision: number; onSaved: () => void }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Directory | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true); setError('');
      api<Directory>(`/staff/users?search=${encodeURIComponent(search)}&page=${page}&limit=6`)
        .then(value => { if (active) setResult(value); })
        .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Could not load registered accounts.'); })
        .finally(() => { if (active) setLoading(false); });
    }, search ? 300 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [search, page, revision]);
  async function changeRole(user: User) {
    if (busy !== null || user.role === 'owner') return;
    setBusy(user.id); setError(''); setNotice('');
    try {
      const updated = await api<User>(`/staff/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ role: user.role === 'staff' ? 'customer' : 'staff' }) });
      setResult(current => current ? { ...current, items: current.items.map(item => item.id === updated.id ? updated : item) } : current);
      setNotice(updated.role === 'staff' ? `${updated.name} can now work as shop staff.` : `${updated.name} now has customer access.`);
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not update staff access.'); }
    finally { setBusy(null); }
  }
  return <section className="panel management-panel staff-access-panel">
    <div className="management-section-heading"><span><Users size={22}/></span><div><h2>Staff access</h2><p>Ask your team member to create a customer account, then find them here and give staff access.</p></div></div>
    <p className="management-hint">Staff can manage stock, sales, expenses and customer balances. Only you can change shop settings or manage staff.</p>
    <label className="search-box staff-search"><Search size={17}/><input aria-label="Search registered accounts" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Search name, username or email"/></label>
    <ErrorNotice>{error}</ErrorNotice>
    {notice && <p className="management-success" role="status"><UserRoundCheck size={17}/>{notice}</p>}
    {loading ? <Loading label="Finding registered accounts…"/> : !result?.items.length ? <Empty title="No matching accounts" message="Your team member must create an account with this shop first. Sample accounts are not listed here."/> : <>
      <div className="staff-directory">{result.items.map(user => <article className="staff-person" key={user.id}><span className="ledger-avatar">{user.avatarUrl ? <img src={mediaUrl(user.avatarUrl)} alt="" className="account-photo"/> : user.name.charAt(0).toUpperCase()}</span><div><h3>{user.name}</h3><p>@{user.username}</p><p>{user.email}</p></div><span className={`staff-role ${user.role}`}>{user.role === 'owner' && <ShieldCheck size={14}/>} {user.role === 'owner' ? 'Owner' : user.role === 'staff' ? 'Staff' : 'Customer'}</span>{user.role !== 'owner' && <button className={`button button-small ${user.role === 'staff' ? 'button-outline' : 'button-primary'}`} disabled={busy !== null} onClick={() => void changeRole(user)}>{busy === user.id ? 'Saving…' : user.role === 'staff' ? 'Remove staff access' : 'Make staff'}</button>}</article>)}</div>
      <div className="staff-pagination"><span>{result.total} registered accounts</span><button className="button button-small button-outline" disabled={page <= 1 || busy !== null} onClick={() => setPage(value => value - 1)}>Previous</button><span>{result.page} / {Math.max(1, result.pages)}</span><button className="button button-small button-outline" disabled={page >= result.pages || busy !== null} onClick={() => setPage(value => value + 1)}>Next</button></div>
    </>}
  </section>;
}
