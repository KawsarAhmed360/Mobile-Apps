import { ProfileEditor } from './ProfileEditor';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, CircleHelp, Link2, LoaderCircle, Mail, Phone, RefreshCw, ShieldCheck } from 'lucide-react';
import type { AuthResponse, User } from '../shared/types';
import { mediaUrl, api, post } from './api';
import { ErrorNotice, Field, Loading, Modal, SubmitButton } from './components';
import { PasswordField } from './PasswordField';
import { beginPhoneVerification, connectVerificationAccount, phoneVerificationSupported, sendVerificationEmail, verificationIdToken, verificationMessage, verificationSession, VerificationError, type PhoneChallenge, type VerificationConfig } from './firebase';

export function AccountPanel({ user, onUpdate, onClose, onSignOut, onActivated }: { user: User; onUpdate: (user: User) => void; onClose: () => void; onSignOut?: () => void; onActivated?: (result: AuthResponse) => void }) {
  const [config, setConfig] = useState<VerificationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [anotherAccount, setAnotherAccount] = useState(false);
  const [password, setPassword] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [phone, setPhone] = useState(user.phone || '+880');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [emailWait, setEmailWait] = useState(0);
  const [phoneWait, setPhoneWait] = useState(0);
  const recaptcha = useRef<HTMLDivElement>(null);
  const challenge = useRef<PhoneChallenge | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    api<VerificationConfig>('/config').then(async result => {
      if (!mounted.current) return;
      setConfig(result);
      if (result.verification.email) {
        const session = await verificationSession(result, user.email);
        if (mounted.current) { setConnected(session.connected); setAnotherAccount(session.anotherAccount); }
      }
    }).catch(err => { if (mounted.current) setError(err instanceof Error ? err.message : 'Could not load account settings.'); })
      .finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; challenge.current?.dispose(); };
  }, [user.id, user.email]);
  useEffect(() => {
    if (!emailWait && !phoneWait) return;
    const timer = setInterval(() => { setEmailWait(value => Math.max(0, value - 1)); setPhoneWait(value => Math.max(0, value - 1)); }, 1000);
    return () => clearInterval(timer);
  }, [!!emailWait, !!phoneWait]);

  const run = async (name: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(name); setError(''); setNotice('');
    try { await work(); }
    catch (err) { if (mounted.current) { setError(verificationMessage(err)); if (err instanceof VerificationError && err.code === 'verification/account-mismatch') setAnotherAccount(true); } }
    finally { if (mounted.current) setBusy(''); }
  };
  const connect = async (switchAccount = false) => {
    if (!config) return;
    await connectVerificationAccount(config, user.email, password, switchAccount);
    if (mounted.current) { setConnected(true); setAnotherAccount(false); setPassword(''); setNotice('Your verification account is connected. You can now send an email verification link.'); }
  };
  const sync = async () => {
    if (!config) return;
    const idToken = await verificationIdToken(config, user.email);
    const updated = await post<User>('/auth/verify-contact', { idToken });
    if (!mounted.current) return;
    onUpdate(updated);
    setNotice(updated.emailVerified && updated.phoneVerified ? 'Your email and phone number are verified.' : updated.emailVerified ? 'Your email is verified. You can now verify your phone number.' : 'Your contact details have been checked. Open the email link or finish the SMS step to verify them.');
  };
  const sendEmail = () => run('email', async () => {
    if (!config) return;
    if (!connected) await connect();
    await sendVerificationEmail(config, user.email);
    if (mounted.current) { setEmailWait(60); setNotice(`A verification link was sent to ${user.email}. Open the link in your inbox, then return and choose “Check verification”.`); }
  });
  const sendPhone = () => run('sms', async () => {
    if (!config || !recaptcha.current) return;
    challenge.current?.dispose(); challenge.current = null;
    setCodeSent(false); setCode('');
    const pending = await beginPhoneVerification(config, user.email, phone.trim(), recaptcha.current,
      () => { if (mounted.current) { setCodeSent(false); setBusy('check'); void sync().catch(err => setError(verificationMessage(err))).finally(() => setBusy('')); } },
      err => { if (mounted.current) { setError(verificationMessage(err)); setBusy(''); } });
    if (!mounted.current) { pending.dispose(); return; }
    challenge.current = pending;
    if (pending.completed) { await sync(); return; }
    setCodeSent(true); setPhoneWait(60); setNotice(`An SMS verification code was sent to ${phone.trim()}. Enter the latest code below.`);
  });
  const confirmPhone = (event: FormEvent) => { event.preventDefault(); void run('confirm', async () => {
    if (!challenge.current) throw new VerificationError('Request a new SMS code first.');
    await challenge.current.confirm(code.trim());
    challenge.current = null; setCodeSent(false); setCode(''); await sync();
  }); };

  const configuredEmail = config?.verification.email && !!config.firebase;
  const configuredPhone = config?.verification.phone && phoneVerificationSupported();
  return <Modal title="Your SmartShop account" eyebrow={user.role === 'owner' ? 'SHOP OWNER' : user.role === 'staff' ? 'SHOP STAFF' : 'CUSTOMER ACCOUNT'} onClose={onClose} wide>
    <style>{accountPanelStyles}</style>
    <div className="account-profile"><div className="account-profile-avatar">{user.avatarUrl ? <img src={mediaUrl(user.avatarUrl)} alt="Your profile" className="account-photo"/> : user.name.charAt(0).toUpperCase()}</div><div><h3>{user.name}</h3><p>@{user.username}</p></div><ShieldCheck size={26} /></div>
    {user.isDemo && <p className="account-pending-note">This is a sample preview account. Sign in with your own registered email to activate the real shop owner and verify your contacts.</p>}
    {config?.ownerSetupRequired && !user.isDemo && user.role === 'customer' && onActivated && <section className="account-verification-section"><div className="account-section-title"><ShieldCheck size={20}/><div><h3>Activate your shop owner</h3><p>If this is your shop, use the private code from your Mac. Your existing account and password will be kept.</p></div></div><form className="form-stack" onSubmit={event => { event.preventDefault(); void run('owner', async () => { const result = await post<AuthResponse>('/setup/owner/claim', { setupCode }); onActivated(result); }); }}><Field label="Owner activation code" hint="In your Mac project terminal, run npm run owner:code. This activates the owner once and disables the sample accounts."><input value={setupCode} onChange={event => setSetupCode(event.target.value)} required autoComplete="off" maxLength={128} placeholder="Private code from your Mac"/></Field><SubmitButton busy={busy === 'owner'} disabled={!!busy}>Activate as shop owner</SubmitButton></form></section>}
    <div className="account-verification-summary"><span className={user.emailVerified ? 'verified' : ''}><Mail size={15} />Email {user.emailVerified ? 'verified' : 'not verified'}</span><span className={user.phoneVerified ? 'verified' : ''}><Phone size={15} />Phone {user.phoneVerified ? 'verified' : 'not verified'}</span></div>
    <ProfileEditor key={user.id} user={user} onUpdate={onUpdate}/>
    <Field label="Registered email"><input value={user.email} type="email" readOnly /></Field>
    {user.phoneVerified && user.phone && <div className="verified-phone"><CheckCircle2 size={16} />{user.phone}</div>}
    {loading ? <Loading label="Loading verification options…" /> : <>
      {!configuredEmail && <div className="notice notice-info account-service-notice"><CircleHelp size={19} /><span>Email and phone verification are awaiting the shop’s verification service setup. Your account is saved; verification will become available here after setup.</span></div>}
      {configuredEmail && <section className="account-verification-section"><div className="account-section-title"><Mail size={20} /><div><h3>Verify your email</h3><p>Confirm that you can receive messages at your registered email address.</p></div></div>
        {!connected && <form className="form-stack" onSubmit={event => { event.preventDefault(); void run('connect', () => connect(false)); }}><PasswordField label="Verification password" hint="Use the password you chose for your verification account." autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} minLength={6} maxLength={128} required placeholder="At least 6 characters" disabled={!!busy} /><SubmitButton busy={busy === 'connect'} disabled={!!busy}><Link2 size={16} />Connect verification account</SubmitButton>{anotherAccount && <button className="button button-outline" type="button" disabled={!!busy || !password} onClick={() => void run('switch', () => connect(true))}>Switch to my account</button>}</form>}
        {connected && <p className="verification-connected"><CheckCircle2 size={15} />Verification account connected</p>}
        <div className="verification-actions"><button className="button button-outline" disabled={!!busy || !connected || emailWait > 0 || user.emailVerified} onClick={() => void sendEmail()}>{busy === 'email' ? <LoaderCircle size={16} className="spin" /> : <Mail size={16} />}{user.emailVerified ? 'Email verified' : emailWait ? `Resend in ${emailWait}s` : 'Send verification email'}</button><button className="button button-primary" disabled={!!busy || !connected} onClick={() => void run('check', sync)}>{busy === 'check' ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}Check verification</button></div>
      </section>}
      <section className="account-verification-section"><div className="account-section-title"><Phone size={20} /><div><h3>Verify your phone</h3><p>Receive a one-time SMS code on your own phone number.</p></div></div>
        {!config?.verification.phone && <p className="account-pending-note">SMS verification is awaiting service activation by the shop owner.</p>}
        {config?.verification.phone && !phoneVerificationSupported() && <p className="account-pending-note">Phone verification is not available in this Android build yet. The shop owner needs to finish the Android verification setup.</p>}
        <Field label="Phone number" hint="Include your country code. Bangladesh numbers start with +880."><input type="tel" autoComplete="tel" inputMode="tel" value={phone} onChange={event => setPhone(event.target.value)} maxLength={16} placeholder="+8801XXXXXXXXX" disabled={!!busy || !configuredPhone || user.phoneVerified} /></Field>
        <div ref={recaptcha} className="phone-recaptcha" />
        {configuredPhone && !connected && <p className="account-pending-note">Connect your email verification account above before requesting an SMS.</p>}
        {configuredPhone && connected && !user.emailVerified && <p className="account-pending-note">Verify your email and choose “Check verification” before requesting an SMS.</p>}
        <button className="button button-outline button-full" disabled={!!busy || !configuredPhone || !connected || !user.emailVerified || phoneWait > 0 || user.phoneVerified} onClick={() => void sendPhone()}>{busy === 'sms' ? <LoaderCircle size={16} className="spin" /> : <Phone size={16} />}{user.phoneVerified ? 'Phone verified' : phoneWait ? `Request another code in ${phoneWait}s` : 'Send SMS code'}</button>
        {codeSent && <form className="form-stack phone-code-form" onSubmit={confirmPhone}><Field label="SMS verification code"><input value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required placeholder="6-digit code" /></Field><SubmitButton busy={busy === 'confirm'} disabled={!!busy || code.length !== 6}><ShieldCheck size={17} />Verify phone number</SubmitButton></form>}
      </section>
    </>}
    <ErrorNotice>{error}</ErrorNotice>
    {notice && <div className="notice notice-success account-result" role="status"><CheckCircle2 size={18} /><span>{notice}</span></div>}
    {onSignOut && <div className="account-signout"><button className="button button-outline" onClick={onSignOut}>Sign out</button></div>}
  </Modal>;
}

const accountPanelStyles = `
.account-profile{display:flex;align-items:center;gap:13px;margin-bottom:18px}
.account-profile-avatar{width:51px;height:51px;border-radius:15px;background:#eaf2df;color:#47723b;display:grid;place-items:center;font-size:22px;font-weight:650;flex-shrink:0}
.account-profile>div:nth-child(2){flex:1;min-width:0}.account-profile h3{font-size:19px;color:#304b35;overflow-wrap:anywhere}.account-profile p{font-size:12px;color:#76846d;margin-top:4px}.account-profile>svg{color:#6f9561}
.account-verification-summary{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:21px}.account-verification-summary>span{display:inline-flex;align-items:center;gap:6px;font-size:11px;padding:7px 10px;border-radius:8px;background:#f5eee3;color:#987041}.account-verification-summary>span.verified{background:#e9f3e3;color:#3f7540}
.account-verification-section{border-top:1px solid #e6ecdf;margin-top:23px;padding-top:22px}.account-section-title{display:flex;align-items:flex-start;gap:11px;margin-bottom:17px;color:#4b7642}.account-section-title>svg{margin-top:2px}.account-section-title h3{font-size:16px;color:#345134}.account-section-title p{font-size:12px;color:#6b7c64;line-height:1.7;margin-top:5px}
.verification-actions{display:flex;flex-wrap:wrap;gap:9px;margin-top:14px}.verification-actions>.button{flex:1;min-height:44px;font-size:12px}.verification-connected,.verified-phone{display:flex;align-items:center;gap:7px;font-size:12px;color:#417645;margin:13px 0}.account-pending-note{font-size:12px;color:#927347;line-height:1.7;margin-bottom:15px}.account-service-notice{margin-top:20px}.account-service-notice span{line-height:1.8}.phone-recaptcha{margin:12px 0;max-width:100%;overflow-x:auto}.phone-code-form{margin-top:18px}.account-result{margin-top:20px;line-height:1.7}.notice.notice-success{background:#eef6e6;border:1px solid #d5e6c9;color:#427139}.account-signout{border-top:1px solid #e6ecdf;margin-top:23px;padding-top:18px;display:flex;justify-content:flex-end}
@media(max-width:700px){.account-profile h3{font-size:19px}.account-profile p{font-size:13px}.account-verification-summary>span{font-size:12px}.account-section-title h3{font-size:17px}.account-section-title p,.account-pending-note{font-size:13px}.verification-actions>.button{font-size:13px;min-height:46px}.verification-connected,.verified-phone{font-size:13px}.account-result{font-size:13px}.account-signout .button{min-height:44px}.account-verification-section>.button{min-height:46px}}
`;
