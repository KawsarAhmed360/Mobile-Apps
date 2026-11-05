import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import type { Auth, ConfirmationResult, RecaptchaVerifier as WebRecaptchaVerifier } from 'firebase/auth';
import { ApiError } from './api';

export interface VerificationConfig {
  demo: boolean;
  ownerSetupRequired: boolean;
  verification: { provider: 'firebase' | null; email: boolean; phone: boolean };
  storage: { provider: 'local' | 'firebase' | 'cloudinary' | null; configured: boolean };
  firebase?: { apiKey: string; authDomain: string; projectId: string; appId: string; storageBucket?: string };
}

export class VerificationError extends Error {
  constructor(message: string, public code = 'verification/error') { super(message); }
}

const nativeReady = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('FirebaseAuthentication');
export const phoneVerificationSupported = () => !Capacitor.isNativePlatform() || nativeReady();
const codeOf = (error: unknown) => typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

export function verificationMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof VerificationError) return error.message;
  const code = codeOf(error);
  if (/invalid-credential|wrong-password|invalid-login-credentials/.test(code)) return 'The verification password is incorrect. Try the password you chose for this email.';
  if (/weak-password|password-does-not-meet-requirements/.test(code)) return 'Choose a stronger verification password and try again.';
  if (/too-many-requests/.test(code)) return 'Too many attempts. Wait a little before trying again.';
  if (/quota-exceeded|billing-not-enabled/.test(code)) return 'SMS verification is unavailable for this shop right now. The shop owner needs to check the SMS service.';
  if (/invalid-phone-number/.test(code)) return 'Enter a complete phone number with its country code, such as +880 followed by your number.';
  if (/invalid-verification-code/.test(code)) return 'That SMS code is incorrect. Check the latest message and try again.';
  if (/session-expired|code-expired/.test(code)) return 'The SMS code has expired. Request a new code.';
  if (/credential-already-in-use/.test(code)) return 'This phone number is already linked to another account.';
  if (/provider-already-linked/.test(code)) return 'A phone number is already linked. Use “Check verification” to update its status.';
  if (/requires-recent-login/.test(code)) return 'Reconnect your verification account with its password before trying again.';
  if (/network-request-failed|network/.test(code)) return 'Could not reach the verification service. Check your internet connection.';
  if (/captcha-check-failed|missing-app-credential|invalid-app-credential/.test(code)) return 'The phone verification check could not finish. Complete the verification prompt and try again.';
  if (/unauthorized-domain|app-not-authorized/.test(code)) return 'Verification has not been enabled for this app address yet. Ask the shop owner to finish the setup.';
  if (/operation-not-allowed|invalid-api-key|project-not-found|configuration-not-found/.test(code)) return 'The shop’s verification service is not ready yet. Please try again after setup is complete.';
  return 'Verification could not be completed. Please try again.';
}

async function webAuth(config: VerificationConfig): Promise<Auth> {
  if (!config.firebase?.apiKey || !config.firebase.projectId) throw new VerificationError('Email verification will be available when the shop finishes its verification service setup.');
  const [{ getApps, initializeApp }, { getAuth, setPersistence, browserSessionPersistence }] = await Promise.all([import('firebase/app'), import('firebase/auth')]);
  const name = `smartshop-verification-${config.firebase.projectId}`;
  const app = getApps().find(item => item.name === name) ?? initializeApp(config.firebase, name);
  const auth = getAuth(app);
  // Verification identities, like shop accounts, stay independent in each browser window.
  await setPersistence(auth, browserSessionPersistence);
  await auth.authStateReady();
  return auth;
}

function requireConfigured(config: VerificationConfig) {
  if (!config.verification.email || config.verification.provider !== 'firebase' || !config.firebase) {
    throw new VerificationError('Email verification will be available when the shop finishes its verification service setup.');
  }
}

export async function verificationSession(config: VerificationConfig, email: string) {
  requireConfigured(config);
  const user = nativeReady() ? (await FirebaseAuthentication.getCurrentUser()).user : (await webAuth(config)).currentUser;
  const matches = !!user?.email && user.email.toLowerCase() === email.toLowerCase();
  return { connected: matches, anotherAccount: !!user && !matches };
}

/** Called only after a user chooses to connect/switch the verification account. */
export async function connectVerificationAccount(config: VerificationConfig, email: string, password: string, switchAccount = false) {
  requireConfigured(config);
  const normalizedEmail = email.toLowerCase();
  if (nativeReady()) {
    const existing = (await FirebaseAuthentication.getCurrentUser()).user;
    if (existing?.email?.toLowerCase() === normalizedEmail) return;
    if (!password) throw new VerificationError('Enter a verification password to continue.');
    if (existing && !switchAccount) throw new VerificationError('Another verification account is signed in on this device. Choose “Switch to my account” to continue with your email.', 'verification/account-mismatch');
    if (existing) await FirebaseAuthentication.signOut();
    try { await FirebaseAuthentication.createUserWithEmailAndPassword({ email, password }); }
    catch (error) {
      if (/email-already-in-use/.test(codeOf(error))) await FirebaseAuthentication.signInWithEmailAndPassword({ email, password });
      else throw error;
    }
    return;
  }
  const auth = await webAuth(config);
  if (auth.currentUser?.email?.toLowerCase() === normalizedEmail) return;
  if (!password) throw new VerificationError('Enter a verification password to continue.');
  if (auth.currentUser && !switchAccount) throw new VerificationError('Another verification account is signed in on this device. Choose “Switch to my account” to continue with your email.', 'verification/account-mismatch');
  const sdk = await import('firebase/auth');
  if (auth.currentUser) await sdk.signOut(auth);
  try { await sdk.createUserWithEmailAndPassword(auth, email, password); }
  catch (error) {
    if (/email-already-in-use/.test(codeOf(error))) await sdk.signInWithEmailAndPassword(auth, email, password);
    else throw error;
  }
}

async function assertSession(config: VerificationConfig, email: string) {
  const session = await verificationSession(config, email);
  if (!session.connected) throw new VerificationError('Connect your email verification account first.');
}

export async function sendVerificationEmail(config: VerificationConfig, email: string) {
  await assertSession(config, email);
  if (nativeReady()) { await FirebaseAuthentication.sendEmailVerification(); return; }
  const auth = await webAuth(config);
  await (await import('firebase/auth')).sendEmailVerification(auth.currentUser!);
}

export async function verificationIdToken(config: VerificationConfig, email: string): Promise<string> {
  await assertSession(config, email);
  if (nativeReady()) {
    await FirebaseAuthentication.reload();
    return (await FirebaseAuthentication.getIdToken({ forceRefresh: true })).token;
  }
  const auth = await webAuth(config);
  const sdk = await import('firebase/auth');
  await sdk.reload(auth.currentUser!);
  return sdk.getIdToken(auth.currentUser!, true);
}

export interface PhoneChallenge { completed: boolean; confirm: (code: string) => Promise<void>; dispose: () => void }

export async function beginPhoneVerification(config: VerificationConfig, email: string, phoneNumber: string, container: HTMLElement, onAutoVerified: () => void, onFailure: (error: unknown) => void): Promise<PhoneChallenge> {
  await assertSession(config, email);
  if (!config.verification.phone) throw new VerificationError('SMS verification will be available when the shop enables its phone verification service.');
  if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) throw new VerificationError('Enter your phone number with its country code, such as +880 followed by your number.');
  if (Capacitor.isNativePlatform() && !nativeReady()) throw new VerificationError('Phone verification is not ready in this Android build yet. Ask the shop owner to finish the Android verification setup.');
  if (nativeReady()) {
    const handles: PluginListenerHandle[] = [];
    let stopped = false;
    let sent = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dispose = () => { stopped = true; if (timer) clearTimeout(timer); for (const handle of handles) void handle.remove(); };
    return new Promise<PhoneChallenge>((resolve, reject) => {
      const fail = (error: unknown) => { if (stopped) return; if (!sent) reject(error); else onFailure(error); dispose(); };
      const setup = async () => {
        handles.push(await FirebaseAuthentication.addListener('phoneCodeSent', event => {
          if (stopped) return;
          sent = true;
          if (timer) clearTimeout(timer);
          resolve({ completed: false, dispose, confirm: async code => { await FirebaseAuthentication.confirmVerificationCode({ verificationId: event.verificationId, verificationCode: code }); dispose(); } });
        }));
        handles.push(await FirebaseAuthentication.addListener('phoneVerificationCompleted', () => {
          if (stopped) return;
          if (!sent) resolve({ completed: true, dispose, confirm: async () => {} });
          else onAutoVerified();
          dispose();
        }));
        handles.push(await FirebaseAuthentication.addListener('phoneVerificationFailed', event => fail(event)));
        timer = setTimeout(() => fail(new VerificationError('The SMS request timed out. Check your connection and try again.')), 90_000);
        await FirebaseAuthentication.linkWithPhoneNumber({ phoneNumber });
      };
      void setup().catch(fail);
    });
  }
  const auth = await webAuth(config);
  const sdk = await import('firebase/auth');
  let verifier: WebRecaptchaVerifier | undefined;
  try {
    verifier = new sdk.RecaptchaVerifier(auth, container, { size: 'normal' });
    await verifier.render();
    const confirmation: ConfirmationResult = await sdk.linkWithPhoneNumber(auth.currentUser!, phoneNumber, verifier);
    return { completed: false, confirm: async code => { await confirmation.confirm(code); verifier?.clear(); }, dispose: () => verifier?.clear() };
  } catch (error) { verifier?.clear(); throw error; }
}
