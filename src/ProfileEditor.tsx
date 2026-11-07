import { MediaImage } from './MediaImage';
import { useState, type FormEvent } from 'react';
import { CheckCircle2, Save, UserRound } from 'lucide-react';
import type { User } from '../shared/types';
import { api } from './api';
import { ErrorNotice, Field, SubmitButton } from './components';
import { CloudUploadField, type CloudUpload } from './uploads';

export function ProfileEditor({ user, onUpdate }: { user: User; onUpdate: (user: User) => void }) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone || '');
  const [address, setAddress] = useState(user.address || '');
  const [pendingPhoto, setPendingPhoto] = useState<CloudUpload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function savePhoto(photo: CloudUpload | null) {
    setBusy('photo'); setError(''); setNotice('');
    try {
      onUpdate(await api<User>('/auth/profile', { method: 'PATCH', body: JSON.stringify({ avatarUploadId: photo?.id ?? null }) }));
      setPendingPhoto(null); setNotice(photo ? 'Your profile photo is saved.' : 'Your profile photo has been removed.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save your photo.'); }
    finally { setBusy(''); }
  }
  async function saveDetails(event: FormEvent) {
    event.preventDefault(); setBusy('details'); setError(''); setNotice('');
    try {
      onUpdate(await api<User>('/auth/profile', { method: 'PATCH', body: JSON.stringify({ name: name.trim(), phone: phone.trim(), address: address.trim() }) }));
      setNotice('Your profile details are saved.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save your details.'); }
    finally { setBusy(''); }
  }
  const locked = !!busy || uploading;
  return <section className="account-verification-section profile-editor">
    <div className="account-section-title"><UserRound size={20}/><div><h3>Your profile</h3><p>Make your account your own. Your shop owner can see your profile and contact details.</p></div></div>
    {user.avatarUrl && <div className="self-photo-preview"><MediaImage src={user.avatarUrl} alt="Your profile photo"/><button type="button" className="text-button" disabled={locked} onClick={() => void savePhoto(null)}>Remove current photo</button></div>}
    <CloudUploadField purpose="profile-avatar" value={pendingPhoto} disabled={!!busy} onBusyChange={setUploading} onChange={photo => { setPendingPhoto(photo); if (photo) void savePhoto(photo); }}/>
    {pendingPhoto && error && <button className="button button-outline button-small" disabled={locked} onClick={() => void savePhoto(pendingPhoto)}>Retry saving photo</button>}
    <form className="form-stack" onSubmit={saveDetails}>
      <Field label="Your name"><input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={80} required disabled={locked} autoComplete="name"/></Field>
      <Field label="Your phone"><input type="tel" value={phone} onChange={event => setPhone(event.target.value)} maxLength={30} disabled={locked} autoComplete="tel"/></Field>
      <Field label="Your address"><textarea value={address} onChange={event => setAddress(event.target.value)} maxLength={300} rows={2} disabled={locked} autoComplete="street-address"/></Field>
      <SubmitButton busy={busy === 'details'} disabled={locked}><Save size={16}/>Save profile details</SubmitButton>
    </form>
    <ErrorNotice>{error}</ErrorNotice>{notice && <p className="management-success" role="status"><CheckCircle2 size={16}/>{notice}</p>}
  </section>;
}
