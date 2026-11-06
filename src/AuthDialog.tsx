import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, Mail, Phone, Store, Users } from 'lucide-react';
import type { AuthResponse } from '../shared/types';
import { api, post } from './api';
import { ErrorNotice, Field, Modal, SubmitButton } from './components';
import {
  beginPhoneVerification,
  normalizeSignupPhone,
  phoneVerificationSupported,
  sendVerificationEmail,
  signupVerificationState,
  startSignupVerification,
  verificationIdToken,
  verificationMessage,
  VerificationError,
  type PhoneChallenge,
  type VerificationConfig,
} from './firebase';
import { PasswordField } from './PasswordField';
import { PasswordResetForm } from './PasswordResetForm';

type Step = 'details' | 'email' | 'phone' | 'finish';
type Contacts = { emailVerified: boolean; phone: string | null };

function useResendTimer() {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const remaining = Math.max(0, Math.ceil((until - now) / 1000));
  const waiting = remaining > 0;

  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waiting]);

  return {
    remaining,
    start() {
      const started = Date.now();
      setNow(started);
      setUntil(started + 60_000);
    },
  };
}

export function AuthDialog({ onClose, onLogin }: { onClose: () => void; onLogin: (result: AuthResponse) => void }) {
  const [register, setRegister] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [owner, setOwner] = useState(false);
  const [config, setConfig] = useState<VerificationConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [configRetry, setConfigRetry] = useState(0);
  const [step, setStep] = useState<Step>('details');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [linkedPhone, setLinkedPhone] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [anotherAccount, setAnotherAccount] = useState(false);
  const emailTimer = useResendTimer();
  const smsTimer = useResendTimer();
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const challenge = useRef<PhoneChallenge | null>(null);
  const smsAttempt = useRef(0);
  const recaptcha = useRef<HTMLDivElement>(null);
  const detailsForm = useRef<HTMLFormElement>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      smsAttempt.current++;
      challenge.current?.dispose();
    };
  }, []);

  useEffect(() => {
    let active = true;
    api<VerificationConfig>('/config').then(result => {
      if (active) {
        setConfig(result);
        setConfigError(false);
      }
    }).catch(() => {
      if (active) setConfigError(true);
    });
    return () => { active = false; };
  }, [configRetry]);

  useEffect(() => {
    const value = username.trim();
    if (!register || !/^[a-zA-Z0-9_]{3,24}$/.test(value)) {
      setAvailable(null);
      setChecking(false);
      return;
    }
    let active = true;
    setAvailable(null);
    setChecking(true);
    const timer = window.setTimeout(() => {
      api<{ available: boolean }>(`/auth/username?username=${encodeURIComponent(value)}`)
        .then(result => { if (active) setAvailable(result.available); })
        .catch(() => { if (active) setAvailable(null); })
        .finally(() => { if (active) setChecking(false); });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [username, register]);

  useEffect(() => {
    if (step !== 'details') stepHeading.current?.focus();
  }, [step]);

  const emailAddress = email.trim().toLowerCase();
  const phoneNumber = normalizeSignupPhone(phone);
  const emailRequired = !!config?.verification.email;
  const phoneRequired = !!config?.verification.phone;
  const phoneSupported = phoneVerificationSupported();
  const verificationSteps: { id: Step; label: string }[] = [
    { id: 'details', label: 'Account details' },
    { id: 'email', label: 'Verify email' },
    ...(phoneRequired ? [{ id: 'phone' as const, label: 'Verify phone' }] : []),
    { id: 'finish', label: 'Create account' },
  ];

  const clearPhoneChallenge = useCallback(() => {
    smsAttempt.current++;
    challenge.current?.dispose();
    challenge.current = null;
    setCode('');
    setCodeSent(false);
  }, []);

  const applyContacts = useCallback((contacts: Contacts) => {
    if (!mounted.current) return;
    const verifiedNumber = contacts.phone ? normalizeSignupPhone(contacts.phone) : null;
    setLinkedPhone(verifiedNumber);
    if (!contacts.emailVerified) {
      setStep('email');
    } else if (phoneRequired && verifiedNumber !== phoneNumber) {
      setStep('phone');
    } else {
      clearPhoneChallenge();
      setStep('finish');
    }
  }, [phoneNumber, phoneRequired, clearPhoneChallenge]);

  useEffect(() => {
    if (step !== 'email' || !config) return;
    let active = true;
    let checkingEmail = false;
    let lastCheck = 0;
    const checkAfterReturning = () => {
      if (!active || checkingEmail || inFlight.current || document.visibilityState !== 'visible' || Date.now() - lastCheck < 2000) return;
      checkingEmail = true;
      lastCheck = Date.now();
      void signupVerificationState(config, emailAddress).then(contacts => {
        if (active && !inFlight.current && contacts.emailVerified) {
          setError('');
          setNotice('');
          applyContacts(contacts);
        }
      }).catch(() => {
        // The explicit check button can report errors when the user asks to retry.
      }).finally(() => { checkingEmail = false; });
    };
    document.addEventListener('visibilitychange', checkAfterReturning);
    window.addEventListener('focus', checkAfterReturning);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', checkAfterReturning);
      window.removeEventListener('focus', checkAfterReturning);
    };
  }, [step, config, emailAddress, applyContacts]);

  function backToDetails() {
    clearPhoneChallenge();
    setStep('details');
    setLinkedPhone(null);
    setAnotherAccount(false);
    setError('');
    setNotice('');
  }

  function switchMode() {
    backToDetails();
    setRegister(value => !value);
    setOwner(false);
    setPassword('');
  }

  async function run(action: string, work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(action);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (failure) {
      if (!mounted.current) return;
      setError(verificationMessage(failure));
      if (failure instanceof VerificationError && failure.code === 'verification/account-mismatch') {
        setAnotherAccount(true);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy('');
    }
  }

  async function createAccount(idToken?: string) {
    const result = await post<AuthResponse>(owner ? '/setup/owner' : '/auth/register', {
      name: name.trim(),
      username: username.trim(),
      email: emailAddress,
      password,
      phone: phoneNumber || phone.trim(),
      ...(owner ? { setupCode: setupCode.trim() } : {}),
      ...(idToken ? { idToken } : {}),
    });
    if (mounted.current) onLogin(result);
  }

  function startSignup(switchAccount = false) {
    void run('start', async () => {
      if (!config) throw new VerificationError('Could not load signup options. Try loading them again.');
      if ((phoneRequired || (emailRequired && phone.trim())) && !phoneNumber) {
        throw new VerificationError('Enter a valid mobile number, such as 01712345678 or +8801712345678.');
      }
      if (phoneRequired && !phoneSupported) {
        throw new VerificationError('This Android build cannot verify phones. Open SmartShop in a supported browser or install the latest APK.');
      }
      const result = await api<{ available: boolean }>(`/auth/username?username=${encodeURIComponent(username.trim())}`);
      if (!mounted.current) return;
      setAvailable(result.available);
      if (!result.available) throw new VerificationError('That username is already taken. Choose another username.');
      if (!emailRequired) {
        await createAccount();
        return;
      }
      const contacts = await startSignupVerification(config, emailAddress, password, switchAccount);
      if (!mounted.current) return;
      setAnotherAccount(false);
      applyContacts(contacts);
      if (!contacts.emailVerified) emailTimer.start();
    });
  }

  function submitDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (register) {
      startSignup();
      return;
    }
    void run('login', async () => {
      const result = await post<AuthResponse>('/auth/login', { email: emailAddress, password });
      if (mounted.current) onLogin(result);
    });
  }

  async function refreshVerification(needPhone = false) {
    if (!config) return;
    const contacts = await signupVerificationState(config, emailAddress);
    if (!mounted.current) return;
    applyContacts(contacts);
    if (!contacts.emailVerified) {
      throw new VerificationError('Open the verification link in your email first, then return here and check again.');
    }
    if (needPhone && (!contacts.phone || normalizeSignupPhone(contacts.phone) !== phoneNumber)) {
      throw new VerificationError('This number has not been verified yet. Enter the SMS code or use your linked number.');
    }
  }

  function resendEmail() {
    if (!config || emailTimer.remaining) return;
    void run('resend', async () => {
      await sendVerificationEmail(config, emailAddress);
      if (!mounted.current) return;
      emailTimer.start();
      setNotice('A new link was sent. Use the latest email in your inbox.');
    });
  }

  function sendSms() {
    const container = recaptcha.current;
    if (!config || !phoneNumber || !container || smsTimer.remaining) return;
    void run('send-sms', async () => {
      clearPhoneChallenge();
      const attempt = smsAttempt.current;
      const current = () => mounted.current && smsAttempt.current === attempt;
      let completedAutomatically = false;
      let receivedChallenge = false;
      const pending = await beginPhoneVerification(config, emailAddress, phoneNumber, container, () => {
        if (!current()) return;
        completedAutomatically = true;
        if (receivedChallenge) void run('check-sms', () => refreshVerification(true));
      }, failure => {
        if (!current()) return;
        clearPhoneChallenge();
        setError(verificationMessage(failure));
      });
      if (!current()) {
        pending.dispose();
        return;
      }
      if (pending.completed || completedAutomatically) {
        pending.dispose();
        await refreshVerification(true);
        return;
      }
      challenge.current = pending;
      receivedChallenge = true;
      setCodeSent(true);
      smsTimer.start();
      setNotice(`A code was sent to ${phoneNumber}.`);
    });
  }

  function confirmSms(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run('confirm-sms', async () => {
      const pending = challenge.current;
      if (!pending) throw new VerificationError('Request a new SMS code first.');
      await pending.confirm(code);
      if (!mounted.current) return;
      clearPhoneChallenge();
      await refreshVerification(true);
    });
  }

  function finishSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config) return;
    void run('finish', async () => {
      const idToken = await verificationIdToken(config, emailAddress);
      if (mounted.current) await createAccount(idToken);
    });
  }

  function demo(isOwner: boolean) {
    setEmail(isOwner ? 'owner@smartshop.local' : 'customer@smartshop.local');
    setPassword(isOwner ? 'SmartShop@123' : 'Customer@123');
    setRegister(false);
    setOwner(false);
    setError('');
  }

  const locked = !!busy;
  const linkedOtherNumber = linkedPhone && linkedPhone !== phoneNumber;

  if (resetting) return <Modal title="Reset your password" eyebrow="YOUR SMARTSHOP ACCOUNT" onClose={onClose}>
    <PasswordResetForm initialEmail={emailAddress} onBack={() => setResetting(false)} onReset={address => {
      setEmail(address);
      setPassword('');
      setResetting(false);
      setNotice('Password reset. Sign in with your new password.');
    }} />
  </Modal>;

  return <Modal title={register ? (owner ? 'Set up your shop owner' : 'Create your account') : 'Welcome back'} eyebrow="YOUR SMARTSHOP ACCOUNT" onClose={onClose}>
    {!register && <p className="modal-intro">Sign in to your SmartShop account.</p>}
    {register && emailRequired && <ol className="signup-progress" aria-label="Signup steps">
      {verificationSteps.map(item => <li key={item.id} aria-current={item.id === step ? 'step' : undefined}>{item.label}</li>)}
    </ol>}
    {step === 'details' && <form ref={detailsForm} className={register ? 'form-stack signup-details' : 'form-stack'} onSubmit={submitDetails}>
      {register && <>
        {config?.ownerSetupRequired && <Field label="Account type">
          <select value={owner ? 'owner' : 'customer'} disabled={locked} onChange={event => setOwner(event.target.value === 'owner')}>
            <option value="customer">Customer</option>
            <option value="owner">Shop owner</option>
          </select>
        </Field>}
        {owner && <Field label="Owner activation code" hint="On your Mac, run npm run owner:code. This code activates the shop owner once.">
          <input value={setupCode} onChange={event => setSetupCode(event.target.value)} required autoComplete="off" maxLength={128} placeholder="Code from your Mac" disabled={locked} />
        </Field>}
        <Field label="Your name">
          <input value={name} onChange={event => setName(event.target.value)} required minLength={2} maxLength={80} autoComplete="name" placeholder="Full name" disabled={locked} />
        </Field>
        <Field label="Username">
          <input value={username} onChange={event => setUsername(event.target.value)} required minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]+" autoComplete="username" placeholder="Choose a unique username" disabled={locked} />
          <small className={available === true ? 'available-text' : available === false ? 'unavailable-text' : undefined} role="status">
            {checking ? 'Checking availability…' : available === true ? 'This username is available' : available === false ? 'This username is already taken' : 'Use letters, numbers and underscores.'}
          </small>
        </Field>
        <Field label="Phone number" hint={phoneRequired ? 'We will send a verification code to this number after you verify your email.' : 'Optional. You can use a Bangladesh number starting with 01 or enter your country code.'}>
          <input type="tel" value={phone} onChange={event => setPhone(event.target.value)} required={phoneRequired} maxLength={30} autoComplete="tel" inputMode="tel" placeholder="01712345678 or +880…" disabled={locked} />
        </Field>
      </>}
      <Field label="Email address">
        <input type="email" value={email} onChange={event => { setEmail(event.target.value); setAnotherAccount(false); }} required maxLength={254} autoComplete="email" placeholder="you@example.com" disabled={locked} />
      </Field>
      <PasswordField
        key={register ? 'signup' : 'login'}
        value={password}
        onChange={event => setPassword(event.target.value)}
        required
        minLength={register ? (owner ? 10 : 8) : 1}
        maxLength={128}
        autoComplete={register ? 'new-password' : 'current-password'}
        placeholder={register ? `At least ${owner ? 10 : 8} characters` : 'Your password'}
        disabled={locked}
      />
      {!register && <button type="button" className="text-button auth-forgot-password" disabled={locked} onClick={() => {
        setError('');
        setNotice('');
        setPassword('');
        setResetting(true);
      }}>Forgot password?</button>}
      {register && config && !emailRequired && <div className="notice notice-info">Email verification is unavailable on this server. This signup creates a local account.</div>}
      {register && emailRequired && !phoneRequired && <div className="notice notice-info">SMS verification is currently unavailable. You can sign up by verifying your email.</div>}
      {register && configError && <div className="signup-actions">
        <ErrorNotice>Could not load signup options.</ErrorNotice>
        <button type="button" className="button button-outline" onClick={() => { setConfigError(false); setConfigRetry(value => value + 1); }}>Retry</button>
      </div>}
      <ErrorNotice>{error}</ErrorNotice>
      {!register && notice && <div className="signup-status" role="status"><CheckCircle2 size={17} /><span>{notice}</span></div>}
      <SubmitButton busy={locked} disabled={register && (!config || checking || available === false)}>
        {!register ? 'Sign in' : emailRequired ? 'Send verification email' : 'Create account'}<ArrowRight size={17} />
      </SubmitButton>
      {register && anotherAccount && <button className="button button-outline" type="button" disabled={locked} onClick={() => {
        if (detailsForm.current?.reportValidity()) startSignup(true);
      }}>Switch verification account and continue</button>}
    </form>}
    {step !== 'details' && <section className="signup-verification">
      {step === 'email' && <>
        <h3 ref={stepHeading} tabIndex={-1}>Check your inbox</h3>
        <p>We sent a verification link to <strong>{emailAddress}</strong>. Open it, then return to this screen. Check your spam folder if the email takes a while.</p>
        <div className="signup-actions">
          <button className="button button-primary" type="button" disabled={locked} onClick={() => void run('check-email', () => refreshVerification())}>
            <CheckCircle2 size={17} />{busy === 'check-email' ? 'Checking…' : 'Check email verification'}
          </button>
          <button className="button button-outline" type="button" disabled={locked || !!emailTimer.remaining} onClick={resendEmail}>
            <Mail size={17} />{emailTimer.remaining ? `Resend in ${emailTimer.remaining}s` : 'Resend email'}
          </button>
        </div>
      </>}
      {step === 'phone' && <>
        <h3 ref={stepHeading} tabIndex={-1}>Verify your phone number</h3>
        <p>Your email is verified. Confirm that you can receive SMS at <strong>{phoneNumber}</strong>.</p>
        {linkedOtherNumber ? <>
          <p>Your Firebase account already has the verified number <strong>{linkedPhone}</strong>.</p>
          <button className="button button-primary" type="button" disabled={locked} onClick={() => {
            setPhone(linkedPhone);
            clearPhoneChallenge();
            setError('');
            setNotice('');
            setStep('finish');
          }}>Use my verified number</button>
        </> : <>
          <div className="signup-recaptcha" ref={recaptcha} />
          <div className="signup-actions">
            <button className="button button-outline" type="button" disabled={locked || !!smsTimer.remaining} onClick={sendSms}>
              <Phone size={17} />{busy === 'send-sms' ? 'Sending…' : smsTimer.remaining ? `Resend in ${smsTimer.remaining}s` : 'Send SMS code'}
            </button>
            {!codeSent && <button className="button button-outline" type="button" disabled={locked} onClick={() => void run('check-sms', () => refreshVerification(true))}>Check phone verification</button>}
          </div>
          {codeSent && <form className="form-stack" onSubmit={confirmSms}>
            <Field label="SMS verification code">
              <input value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required disabled={locked} placeholder="6-digit code" />
            </Field>
            <SubmitButton busy={busy === 'confirm-sms'} disabled={locked || code.length !== 6}>Verify SMS code</SubmitButton>
          </form>}
        </>}
      </>}
      {step === 'finish' && <form className="form-stack" onSubmit={finishSignup}>
        <h3 ref={stepHeading} tabIndex={-1}>Finish creating your account</h3>
        <p><strong>{emailAddress}</strong> is verified.{phoneRequired && <> Your phone number <strong>{phoneNumber}</strong> is verified too.</>}</p>
        <SubmitButton busy={locked}>{owner ? 'Create owner account' : 'Create account'}<ArrowRight size={17} /></SubmitButton>
      </form>}
      <ErrorNotice>{error}</ErrorNotice>
      {notice && <div className="signup-status" role="status"><CheckCircle2 size={17} /><span>{notice}</span></div>}
      <button className="button button-outline" type="button" disabled={locked} onClick={backToDetails}>Edit signup details</button>
    </section>}
    <p className="auth-switch">
      {register ? 'Already have an account?' : 'New around here?'}
      <button type="button" disabled={locked} onClick={switchMode}>{register ? 'Sign in' : 'Create an account'}</button>
    </p>
    {config?.demo && !register && <div className="demo-accounts">
      <p>CLASS PREVIEW ACCOUNTS</p>
      <span>These sample accounts stop working after a real owner is activated.</span>
      <div>
        <button type="button" disabled={locked} onClick={() => demo(true)}><Store size={16} />Sample owner</button>
        <button type="button" disabled={locked} onClick={() => demo(false)}><Users size={16} />Sample customer</button>
      </div>
    </div>}
  </Modal>;
}
