import { useRef, useState } from 'react';
import { CheckCircle2, FileImage, FileText, LoaderCircle, UploadCloud, X } from 'lucide-react';
import { mediaUrl, upload } from './api';
import { ErrorNotice } from './components';

export interface CloudUpload { id: number; url: string; name: string; mimeType: string; size: number; storage: 'local' | 'firebase' | 'cloudinary'; purpose?: 'product' | 'owner-avatar' | 'profile-avatar' }

export function CloudUploadField({ purpose = 'product', value, onChange, onBusyChange, disabled = false }: {
  purpose?: 'product' | 'owner-avatar' | 'profile-avatar' | 'receipt'; value: CloudUpload | null; onChange: (value: CloudUpload | null) => void;
  onBusyChange?: (busy: boolean) => void; disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isImage = purpose !== 'receipt';
  const label = purpose === 'owner-avatar' ? 'Owner profile photo' : purpose === 'profile-avatar' ? 'Profile photo' : purpose === 'product' ? 'Product photo' : 'Receipt / supporting file';
  const actionLabel = purpose === 'owner-avatar' || purpose === 'profile-avatar' ? 'Choose your profile photo' : purpose === 'product' ? 'Choose a product photo' : 'Choose a receipt or file';
  const choose = async (file?: File) => {
    if (!file) return;
    setError('');
    const acceptedTypes = isImage ? ['image/jpeg', 'image/png', 'image/webp'] : ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!acceptedTypes.includes(file.type)) { setError(isImage ? 'Choose a JPG, PNG or WebP image.' : 'Choose a JPG, PNG, WebP or PDF file.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Choose a file smaller than 5 MB.'); return; }
    setBusy(true); onBusyChange?.(true);
    const form = new FormData(); form.append('file', file); form.append('purpose', purpose);
    try { onChange(await upload<CloudUpload>('/uploads', form)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not upload the file. Please try again.'); }
    finally { setBusy(false); onBusyChange?.(false); if (input.current) input.current.value = ''; }
  };
  const image = value?.mimeType.startsWith('image/');
  return <div className="cloud-upload-field">
    <span className="cloud-upload-label">{label} <small>Optional</small></span>
    <input ref={input} type="file" accept={isImage ? 'image/jpeg,image/png,image/webp' : 'image/jpeg,image/png,image/webp,application/pdf'} aria-label={`Upload ${purpose === 'owner-avatar' ? 'owner profile photo' : purpose === 'profile-avatar' ? 'profile photo' : purpose === 'product' ? 'product photo' : 'receipt or file'}`} className="upload-file-input" disabled={disabled || busy} onChange={event => choose(event.target.files?.[0])} />
    {value ? <div className="uploaded-file-card">{image ? <img src={mediaUrl(value.url)} alt={value.name} /> : <span className="uploaded-file-icon"><FileText size={27} /></span>}<div><strong>{value.name}</strong><span><CheckCircle2 size={13} />{value.storage === 'local' ? 'Saved to shop server' : 'Saved to cloud storage'} · {(value.size / 1024).toFixed(0)} KB</span><a href={mediaUrl(value.url)} target="_blank" rel="noopener noreferrer">View uploaded file</a></div><button type="button" className="icon-button" aria-label="Remove file from this form" onClick={() => onChange(null)} disabled={disabled || busy}><X size={17} /></button></div> : <button type="button" className="upload-dropzone" onClick={() => input.current?.click()} disabled={disabled || busy}>{busy ? <LoaderCircle size={26} className="spin" /> : isImage ? <FileImage size={27} /> : <UploadCloud size={27} />}<strong>{busy ? isImage ? 'Uploading photo…' : 'Uploading file…' : actionLabel}</strong><span>{isImage ? 'JPG, PNG or WebP' : 'JPG, PNG, WebP or PDF'} · up to 5 MB</span></button>}
    <ErrorNotice>{error}</ErrorNotice>
  </div>;
}
