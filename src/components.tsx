import { mediaUrl } from './api';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, LoaderCircle, PackageOpen, X } from 'lucide-react';

export const money = (cents: number) => `৳${new Intl.NumberFormat('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format((cents || 0) / 100)}`;
export const asCents = (value: string | number) => Math.round(Number(value) * 100);
export const dayLabel = (value: string) => new Intl.DateTimeFormat('en-GB', { month: 'short', day: 'numeric', timeZone: 'Asia/Dhaka' }).format(new Date(value));

export function Modal({ title, eyebrow, children, onClose, wide = false }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></div><button type="button" className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={21} /></button></div>
    {children}
  </dialog>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function ErrorNotice({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <div className="notice notice-error" role="alert"><AlertCircle size={17} /><span>{children}</span></div>;
}

export function Loading({ label = 'Loading your shop…' }: { label?: string }) {
  return <div className="loading-state" role="status"><LoaderCircle className="spin" size={25} /><p>{label}</p></div>;
}

export function Empty({ title, message, children }: { title: string; message: string; children?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><PackageOpen size={29} /></div><h3>{title}</h3><p>{message}</p>{children}</div>;
}

export function ProductArt({ emoji, category, imageUrl, small = false }: { emoji: string; category?: string; imageUrl?: string | null; small?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [imageUrl]);
  const colours = ['sage', 'peach', 'lavender', 'sand', 'blue'];
  const colour = colours[[...(category ?? emoji ?? '')].reduce((n, c) => n + c.charCodeAt(0), 0) % colours.length];
  return <div className={`product-art ${colour} ${small ? 'art-small' : ''} ${imageUrl && !imageFailed ? 'has-photo' : ''}`} aria-hidden="true">{imageUrl && !imageFailed ? <img src={mediaUrl(imageUrl)} alt="" loading="lazy" onError={() => setImageFailed(true)} /> : <span>{emoji || '📦'}</span>}</div>;
}

export function SubmitButton({ busy, children, className = 'button button-primary', disabled = false }: { busy: boolean; children: ReactNode; className?: string; disabled?: boolean }) {
  return <button className={className} type="submit" disabled={busy || disabled}>{busy && <LoaderCircle size={17} className="spin" />}{busy ? 'Please wait…' : children}</button>;
}
