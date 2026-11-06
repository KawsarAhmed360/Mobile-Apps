import { useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import type { ShopDocument } from '../shared/document';
import { api } from './api';
import { ErrorNotice } from './components';

export function PdfDownloadButton({ path, label = 'Download PDF', className = 'button button-outline', disabled = false }: {
  path: string;
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ path: string; message: string } | null>(null);
  const download = async () => {
    if (busy || disabled || !path) return;
    setBusy(true);
    setError(null);
    try {
      const { downloadShopDocument } = await import('./pdf-documents');
      const document = await api<ShopDocument>(path);
      await downloadShopDocument(document);
    } catch (err) {
      setError({ path, message: err instanceof Error ? err.message : 'Could not download the PDF. Try again.' });
    } finally {
      setBusy(false);
    }
  };
  return <div className="pdf-download">
    <button type="button" className={className} disabled={disabled || busy || !path} onClick={() => void download()}>
      {busy ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
      {busy ? 'Preparing PDF…' : label}
    </button>
    {error?.path === path && <ErrorNotice>{error.message}</ErrorNotice>}
  </div>;
}
