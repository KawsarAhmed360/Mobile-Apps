import { MediaImage } from './MediaImage';
import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, MapPin, Save, Store, UserRound } from 'lucide-react';
import type { Shop, User } from '../shared/types';
import { api } from './api';
import { ErrorNotice, Field, Loading, SubmitButton } from './components';
import { CloudUploadField, type CloudUpload } from './uploads';
import './management.css';

interface Settings { owner: { name: string; email: string; phone: string; avatarUrl?: string | null; avatarUploadId?: number | null }; shop: Shop }
interface ShopForm { name: string; tagline: string; phone: string; email: string; address: string; openingHours: string; latitude: string; longitude: string }

export function ShopSettings({ onUserUpdate, onSaved }: { onUserUpdate: (user: User) => void; onSaved: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [shop, setShop] = useState<ShopForm>({ name: '', tagline: '', phone: '', email: '', address: '', openingHours: '', latitude: '', longitude: '' });
  const [owner, setOwner] = useState({ name: '', phone: '' });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [ownerError, setOwnerError] = useState('');
  const [shopError, setShopError] = useState('');
  const [ownerSaved, setOwnerSaved] = useState(false);
  const [shopSaved, setShopSaved] = useState(false);
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarUpload, setAvatarUpload] = useState<CloudUpload | null>(null);
  const [shopBusy, setShopBusy] = useState(false);
  const [logoUpload, setLogoUpload] = useState<CloudUpload | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState('');
  const [retry, setRetry] = useState(0);
  const ownerLocked = ownerBusy || avatarUploading || avatarSaving;
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLoadError('');
    api<Settings>('/settings').then(result => {
      if (cancelled) return;
      setSettings(result); setOwner({ name: result.owner.name, phone: result.owner.phone || '' });
      setShop({ name: result.shop.name, tagline: result.shop.tagline, phone: result.shop.phone, email: result.shop.email, address: result.shop.address, openingHours: result.shop.openingHours, latitude: result.shop.latitude === null ? '' : String(result.shop.latitude), longitude: result.shop.longitude === null ? '' : String(result.shop.longitude) });
    }).catch(err => { if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load shop settings.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [retry]);
  const changeShop = (field: keyof ShopForm, value: string) => { setShop(current => ({ ...current, [field]: value })); setShopSaved(false); };
  const saveOwner = async (event: FormEvent) => {
    event.preventDefault(); if (ownerLocked) return;
    setOwnerBusy(true); setOwnerError(''); setOwnerSaved(false);
    try {
      const updated = await api<User>('/owner/profile', { method: 'PATCH', body: JSON.stringify({ name: owner.name.trim(), phone: owner.phone.trim() }) });
      setOwner({ name: updated.name, phone: updated.phone || '' });
      setSettings(current => current ? { ...current, owner: { ...current.owner, name: updated.name, phone: updated.phone || '', avatarUrl: updated.avatarUrl, avatarUploadId: updated.avatarUploadId } } : current);
      onUserUpdate(updated); setOwnerSaved(true);
    } catch (err) { setOwnerError(err instanceof Error ? err.message : 'Could not save your details.'); }
    finally { setOwnerBusy(false); }
  };
  const saveAvatar = async (photo: CloudUpload | null) => {
    if (avatarSaving || ownerBusy) return;
    setAvatarSaving(true); setOwnerError(''); setOwnerSaved(false);
    try {
      const updated = await api<User>('/owner/profile', { method: 'PATCH', body: JSON.stringify({ avatarUploadId: photo?.id ?? null }) });
      setSettings(current => current ? { ...current, owner: { ...current.owner, avatarUrl: updated.avatarUrl, avatarUploadId: updated.avatarUploadId } } : current);
      setAvatarUpload(null); onUserUpdate(updated); setOwnerSaved(true);
    } catch (err) { setOwnerError(err instanceof Error ? err.message : 'Could not save your profile photo.'); }
    finally { setAvatarSaving(false); }
  };
  const saveShop = async (event: FormEvent) => {
    event.preventDefault(); if (shopBusy) return;
    setShopError(''); setShopSaved(false);
    const latText = shop.latitude.trim(), lngText = shop.longitude.trim();
    if (!!latText !== !!lngText) { setShopError('Enter both map coordinates, or leave both empty to use the shop address.'); return; }
    const latitude = latText ? Number(latText) : null, longitude = lngText ? Number(lngText) : null;
    if ((latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) || (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) { setShopError('Enter a latitude from -90 to 90 and a longitude from -180 to 180.'); return; }
    setShopBusy(true);
    try {
      const updated = await api<Shop>('/shop', { method: 'PUT', body: JSON.stringify({ ...shop, name: shop.name.trim(), tagline: shop.tagline.trim(), phone: shop.phone.trim(), email: shop.email.trim(), address: shop.address.trim(), openingHours: shop.openingHours.trim(), latitude, longitude }) });
      setSettings(current => current ? { ...current, shop: updated } : current); setShopSaved(true); onSaved();
    } catch (err) { setShopError(err instanceof Error ? err.message : 'Could not save shop details.'); }
    finally { setShopBusy(false); }
  };
  const saveLogo = async (uploadId: number | null) => {
    if (logoBusy || logoUploading) return;
    setLogoBusy(true);
    setLogoError('');
    try {
      const updated = await api<Shop>('/shop/logo', { method: 'PATCH', body: JSON.stringify({ uploadId }) });
      setSettings(current => current ? { ...current, shop: updated } : current);
      setLogoUpload(null);
      onSaved();
    } catch (err) { setLogoError(err instanceof Error ? err.message : 'Could not save the shop logo.'); }
    finally { setLogoBusy(false); }
  };
  if (loading) return <Loading label="Loading your shop settings…" />;
  if (loadError || !settings) return <section className="panel management-panel"><ErrorNotice>{loadError || 'Shop settings could not be loaded.'}</ErrorNotice><button className="button button-outline" onClick={() => setRetry(value => value + 1)}>Try again</button></section>;
  return <div className="shop-settings-layout">
    <style>{ownerPhotoStyles}</style>
    <section className="panel management-panel"><div className="management-section-heading"><span className="owner-heading-avatar">{settings.owner.avatarUrl ? <MediaImage src={settings.owner.avatarUrl} alt="Your profile"/> : <UserRound size={22} />}</span><div><h2>Owner details</h2><p>Your name, profile photo and contact number for this shop.</p></div></div>
    <div className="owner-photo-preview"><span>{settings.owner.avatarUrl ? <MediaImage src={settings.owner.avatarUrl} alt={`${settings.owner.name}'s profile photo`}/> : <UserRound size={36}/>}</span><div><strong>Your profile photo</strong><p>Choose the picture shown beside your owner account.</p>{settings.owner.avatarUrl && <button type="button" className="text-button" disabled={ownerLocked} onClick={() => void saveAvatar(null)}>Remove profile photo</button>}</div></div>
    <CloudUploadField purpose="owner-avatar" value={avatarUpload} onBusyChange={setAvatarUploading} disabled={ownerBusy || avatarSaving} onChange={photo => { setAvatarUpload(photo); if (photo) void saveAvatar(photo); }}/>
    {avatarSaving && <p className="management-hint" role="status">Saving your profile photo…</p>}
    {avatarUpload && !ownerLocked && <button className="button button-outline owner-photo-retry" type="button" onClick={() => void saveAvatar(avatarUpload)}>Save profile photo</button>}
    <form className="form-stack owner-details-form" onSubmit={saveOwner}>
      <Field label="Owner name"><input value={owner.name} onChange={event => { setOwner(current => ({ ...current, name: event.target.value })); setOwnerSaved(false); }} minLength={2} maxLength={80} required autoComplete="name" disabled={ownerLocked} /></Field>
      <Field label="Owner phone"><input type="tel" value={owner.phone} onChange={event => { setOwner(current => ({ ...current, phone: event.target.value })); setOwnerSaved(false); }} maxLength={30} autoComplete="tel" disabled={ownerLocked} placeholder="Your contact number" /></Field>
      <Field label="Account email" hint="This is the email you use to sign in."><input value={settings.owner.email} readOnly type="email" /></Field>
      <ErrorNotice>{ownerError}</ErrorNotice>{ownerSaved && <p className="management-success" role="status"><CheckCircle2 size={17} />Your owner details are saved.</p>}
      <SubmitButton busy={ownerBusy} disabled={avatarUploading || avatarSaving}><Save size={17} />Save owner details</SubmitButton>
    </form></section>
    <section className="panel management-panel"><div className="management-section-heading"><span><Store size={22} /></span><div><h2>Your shop profile</h2><p>Customers see these details in the app.</p></div></div><form className="form-stack" onSubmit={saveShop}>
      <div className="form-grid"><Field label="Shop name"><input value={shop.name} onChange={event => changeShop('name', event.target.value)} minLength={2} maxLength={120} required disabled={shopBusy} placeholder="Your shop name" /></Field><Field label="Shop phone"><input type="tel" value={shop.phone} onChange={event => changeShop('phone', event.target.value)} maxLength={30} disabled={shopBusy} placeholder="Shop contact number" /></Field></div>
      <Field label="Short description"><input value={shop.tagline} onChange={event => changeShop('tagline', event.target.value)} maxLength={200} disabled={shopBusy} placeholder="Tell customers a little about your shop" /></Field>
      <div className="form-grid"><Field label="Shop email"><input type="email" value={shop.email} onChange={event => changeShop('email', event.target.value)} maxLength={254} disabled={shopBusy} placeholder="shop@example.com" /></Field><Field label="Opening hours"><input value={shop.openingHours} onChange={event => changeShop('openingHours', event.target.value)} maxLength={120} disabled={shopBusy} placeholder="Every day, 9 AM – 10 PM" /></Field></div>
      <Field label="Shop address"><textarea value={shop.address} onChange={event => changeShop('address', event.target.value)} maxLength={500} rows={3} disabled={shopBusy} placeholder="Street, area, city" /></Field>
      <div className="settings-map-heading"><MapPin size={17} /><strong>Map location</strong><span>Optional coordinates</span></div><p className="management-hint">Add the coordinates of your shop for an exact map pin. Leave both empty to locate the shop using its address.</p>
      <div className="form-grid"><Field label="Latitude"><input type="number" min="-90" max="90" step="any" value={shop.latitude} onChange={event => changeShop('latitude', event.target.value)} disabled={shopBusy} placeholder="e.g. 23.8103" /></Field><Field label="Longitude"><input type="number" min="-180" max="180" step="any" value={shop.longitude} onChange={event => changeShop('longitude', event.target.value)} disabled={shopBusy} placeholder="e.g. 90.4125" /></Field></div>
      <ErrorNotice>{shopError}</ErrorNotice>{shopSaved && <p className="management-success" role="status"><CheckCircle2 size={17} />Shop details saved. Your customer profile has been updated.</p>}
      <div className="management-form-end"><SubmitButton busy={shopBusy}><Save size={17} />Save shop details</SubmitButton></div>
    </form>
    <div className="form-stack shop-logo-settings">
      <div className="owner-photo-preview"><span>{settings.shop.logoUrl ? <MediaImage src={settings.shop.logoUrl} alt="Current shop logo" /> : <Store size={30} />}</span><div><strong>Invoice logo</strong><p>This logo appears on shop invoices, receipts and reports.</p>{settings.shop.logoUrl && <button type="button" className="text-button" disabled={logoUploading || logoBusy} onClick={() => void saveLogo(null)}>Remove shop logo</button>}</div></div>
      <CloudUploadField purpose="shop-logo" value={logoUpload} onChange={setLogoUpload} onBusyChange={setLogoUploading} disabled={logoBusy} />
      {logoUpload && <button type="button" className="button button-outline" disabled={logoBusy || logoUploading} onClick={() => void saveLogo(logoUpload.id)}><Save size={17} />{logoBusy ? 'Saving logo…' : 'Save shop logo'}</button>}
      <ErrorNotice>{logoError}</ErrorNotice>
    </div></section>
  </div>;
}

const ownerPhotoStyles = `
.owner-heading-avatar{overflow:hidden}.owner-heading-avatar img{width:100%;height:100%;object-fit:cover}.owner-photo-preview{display:flex;align-items:center;gap:14px;margin:4px 0 20px}.owner-photo-preview>span{width:78px;height:78px;border-radius:50%;overflow:hidden;background:#edf4e6;color:#578145;display:grid;place-items:center;flex-shrink:0}.owner-photo-preview img{width:100%;height:100%;object-fit:cover}.owner-photo-preview strong{font-size:14px;color:#36563a}.owner-photo-preview p{font-size:12px;color:#70836a;line-height:1.7;margin-top:5px}.owner-photo-preview .text-button{font-size:12px;margin-top:9px}.owner-details-form{margin-top:24px}.owner-photo-retry{margin-top:12px}@media(max-width:700px){.owner-photo-preview p,.owner-photo-preview .text-button{font-size:13px}.owner-photo-preview .text-button{min-height:40px}.owner-photo-preview>span{width:72px;height:72px}}
`;
