import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, Mail } from 'lucide-react';
import { post } from './api';
import { ErrorNotice, Field, SubmitButton } from './components';
import { PasswordField } from './PasswordField';

function actionCode(input: string) {
  const value = input.trim();
  if (/^[A-Za-z0-9_-]{8,2048}$/.test(value)) return value;
  try {
    const url = new URL(value);
    const code = url.searchParams.get('oobCode');
    if (url.protocol === 'https:' && url.searchParams.get('mode') === 'resetPassword' && code && /^[A-Za-z0-9_-]{8,2048}$/.test(code)) return code;
  } catch { /* A malformed link cannot supply a reset code. */ }
  return null;
}

export function PasswordResetForm({ initialEmail, onBack, onReset }: {
  initialEmail: string;
  onBack: () => void;
  onReset: (email: string) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [confirm, setConfirm] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const instructions = useRef<HTMLParagraphElement>(null);

  useEffect(() => { instructions.current?.focus(); }, [confirm]);

  function changeStage(next: boolean) {
    setError('');
    setSent(false);
    setConfirm(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const address = email.trim().toLowerCase();
    const fields = new FormData(event.currentTarget);
    setError('');
    setBusy(true);
    try {
      if (!confirm) {
        await post('/auth/password-reset/request', { email: address });
        setSent(true);
        setConfirm(true);
        return;
      }
      const code = actionCode(String(fields.get('code') ?? ''));
      const password = String(fields.get('password') ?? '');
      if (!code) {
        setError('Paste the password reset link from your email or its one-time code.');
        return;
      }
      if (password !== fields.get('confirmPassword')) {
        setError('The new passwords do not match.');
        return;
      }
      await post('/auth/password-reset/confirm', { email: address, code, password });
      onReset(address);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Password reset could not finish. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <p className="modal-intro" ref={instructions} tabIndex={-1}>{confirm
      ? 'Paste the full reset link from your email or browser address bar. You can also paste the one-time code inside the link. Set your new password below to finish in SmartShop.'
      : 'Enter the email address you use to sign in to SmartShop.'}</p>
    <form className="form-stack" onSubmit={submit}>
      {sent && <div className="signup-status" role="status"><CheckCircle2 size={17} /><span>If this address can be used for password recovery, a reset email will arrive shortly. Check your spam folder too.</span></div>}
      <Field label="Email address">
        <input type="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} autoComplete="email" placeholder="you@example.com" disabled={busy} />
      </Field>
      {confirm && <>
        <Field label="Reset link or code">
          <input name="code" required maxLength={4096} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Paste your reset link" disabled={busy} />
        </Field>
        <PasswordField name="password" label="New password" required minLength={10} maxLength={128} autoComplete="new-password" placeholder="At least 10 characters" disabled={busy} />
        <PasswordField name="confirmPassword" label="Confirm new password" required minLength={10} maxLength={128} autoComplete="new-password" disabled={busy} />
      </>}
      <ErrorNotice>{error}</ErrorNotice>
      <SubmitButton busy={busy}>{confirm ? <>Reset password<ArrowRight size={17} /></> : <>Send reset email<Mail size={17} /></>}</SubmitButton>
      <div className="signup-actions">
        <button type="button" className="button button-outline" disabled={busy} onClick={() => changeStage(!confirm)}>
          {confirm ? 'Request a new link' : 'I have a reset link'}
        </button>
        <button type="button" className="button button-outline" disabled={busy} onClick={onBack}>Back to sign in</button>
      </div>
    </form>
  </>;
}
