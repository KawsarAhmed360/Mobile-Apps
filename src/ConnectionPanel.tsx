import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, LoaderCircle, PlugZap, Server } from 'lucide-react';
import { getApiBaseUrl, normalizeApiBaseUrl, setApiBaseUrl } from './api';
import { ErrorNotice, Field, Modal } from './components';

export default function ConnectionPanel({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [address, setAddress] = useState(() => getApiBaseUrl() || window.location.origin);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState('');
  const [testing, setTesting] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const attempt = useRef(0);
  useEffect(() => () => { controller.current?.abort(); }, []);

  const edit = (value: string) => {
    attempt.current++;
    controller.current?.abort();
    setAddress(value); setError(''); setConnected(''); setTesting(false);
  };
  const test = async () => {
    setError(''); setConnected('');
    let url: string;
    try { url = normalizeApiBaseUrl(address); }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Check the server address.'); return; }
    controller.current?.abort();
    const current = ++attempt.current;
    const request = new AbortController(); controller.current = request;
    const timeout = setTimeout(() => request.abort(), 8000);
    setTesting(true);
    try {
      // Connection checks never transmit the current account's bearer token.
      const response = await fetch(`${url}/api/health`, {
        method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit',
        redirect: 'error', cache: 'no-store', signal: request.signal,
      });
      if (!response.headers.get('Content-Type')?.includes('application/json')) {
        throw new Error('This address did not return a SmartShop server response. Check the address and port.');
      }
      const result: unknown = await response.json();
      if (!response.ok || !result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
        throw new Error('This address responded, but it did not identify itself as a working SmartShop server.');
      }
      if (current === attempt.current) setConnected(`Connected to SmartShop at ${url}`);
    } catch (problem) {
      if (current === attempt.current) setError(problem instanceof Error && problem.name !== 'AbortError' && !/fetch|network|load failed/i.test(problem.message)
        ? problem.message
        : 'Could not reach the shop. Keep your Mac server running, use the same Wi-Fi and check the address.');
    } finally {
      clearTimeout(timeout);
      if (current === attempt.current) setTesting(false);
    }
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    try {
      setApiBaseUrl(address);
      onSaved(); onClose();
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Check the server address.'); }
  };

  return <Modal title="Connect to your shop." eyebrow="SHOP CONNECTION" onClose={onClose}>
    <p className="modal-intro">Use the shop server address shown on your Mac. For the class demo, keep your phone and Mac on the same Wi-Fi.</p>
    <form className="form-stack" onSubmit={save}>
      <Field label="Shop server address" hint="Example: http://192.168.1.5:3001. Use HTTPS for an internet server.">
        <input type="url" inputMode="url" value={address} onChange={event => edit(event.target.value)} required
          spellCheck={false} autoCapitalize="none" autoComplete="off" placeholder="http://192.168.1.5:3001" />
      </Field>
      <ErrorNotice>{error}</ErrorNotice>
      {connected && <div className="notice notice-info" role="status" aria-live="polite"><CheckCircle2 size={18} /><span>{connected}</span></div>}
      <button className="button button-outline button-full" type="button" onClick={test} disabled={testing || !address.trim()}>
        {testing ? <LoaderCircle size={18} className="spin" /> : <PlugZap size={18} />}{testing ? 'Testing connection…' : 'Test connection'}
      </button>
      <p className="form-note">Changing the server signs you out. You can save the address while the server is offline and reconnect when it starts.</p>
      <button className="button button-primary button-full" type="submit" disabled={!address.trim()}><Server size={18} />Save and reconnect</button>
    </form>
  </Modal>;
}
