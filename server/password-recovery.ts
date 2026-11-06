import { randomBytes } from 'node:crypto';
import { getServiceConfig, ServiceError } from './services.js';

export interface PasswordRecovery {
  send(email: string, provision: boolean): Promise<void>;
  verifyCode(code: string): Promise<string>;
  reset(code: string, email: string, password: string): Promise<{ uid: string; email: string }>;
}

class FirebaseRecoveryError extends Error {
  constructor(public code: string) { super(code); }
}

async function firebaseRequest(method: string, body: object): Promise<Record<string, unknown>> {
  const key = getServiceConfig().firebase?.apiKey;
  if (!key) throw new ServiceError(503, 'Email password reset is not configured for this shop.');
  const url = new URL(`https://identitytoolkit.googleapis.com/v1/accounts:${method}`);
  url.searchParams.set('key', key);
  try {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.timeout(8_000),
    });
    const result = await response.json();
    if (!response.ok) {
      const code = typeof result?.error?.message === 'string' ? result.error.message.split(/\s|:/)[0] : 'UNAVAILABLE';
      throw new FirebaseRecoveryError(code);
    }
    if (!result || typeof result !== 'object') throw new FirebaseRecoveryError('UNAVAILABLE');
    return result;
  } catch (error) {
    if (error instanceof FirebaseRecoveryError) throw error;
    throw new ServiceError(503, 'The email verification service could not be reached. Please try again.');
  }
}

const invalidCode = () => new ServiceError(400, 'That reset link or code is invalid, expired or already used. Request a new one.');

function recoveryError(error: unknown, checkingCode = false): never {
  if (error instanceof ServiceError) throw error;
  if (error instanceof FirebaseRecoveryError) {
    if (checkingCode && ['INVALID_OOB_CODE', 'EXPIRED_OOB_CODE', 'USER_DISABLED', 'EMAIL_NOT_FOUND'].includes(error.code)) throw invalidCode();
    if (['WEAK_PASSWORD', 'PASSWORD_DOES_NOT_MEET_REQUIREMENTS'].includes(error.code)) throw new ServiceError(400, 'Choose a stronger password and try again.');
    if (['TOO_MANY_ATTEMPTS_TRY_LATER', 'QUOTA_EXCEEDED'].includes(error.code)) throw new ServiceError(429, 'The email verification service has reached its limit. Try again later.');
  }
  throw new ServiceError(503, 'The email verification service could not complete this request. Please try again.');
}

async function resetPassword(code: string, password?: string) {
  try {
    const result = await firebaseRequest('resetPassword', { oobCode: code, ...(password === undefined ? {} : { newPassword: password }) });
    if (result.requestType !== 'PASSWORD_RESET' || typeof result.email !== 'string') throw invalidCode();
    return result.email.toLowerCase();
  } catch (error) { return recoveryError(error, true); }
}

export const firebasePasswordRecovery: PasswordRecovery = {
  async send(email, provision) {
    try {
      if (provision) {
        // Older SmartShop accounts may have been created before Firebase signup.
        try {
          await firebaseRequest('signUp', { email, password: `${randomBytes(32).toString('base64url')}aA1!`, returnSecureToken: true });
        } catch (error) {
          if (!(error instanceof FirebaseRecoveryError && error.code === 'EMAIL_EXISTS')) throw error;
        }
      }
      await firebaseRequest('sendOobCode', { requestType: 'PASSWORD_RESET', email });
    } catch (error) {
      if (error instanceof FirebaseRecoveryError && ['EMAIL_NOT_FOUND', 'USER_DISABLED'].includes(error.code)) return;
      recoveryError(error);
    }
  },
  verifyCode: code => resetPassword(code),
  async reset(code, email, password) {
    if (await resetPassword(code, password) !== email) throw invalidCode();
    try {
      const result = await firebaseRequest('signInWithPassword', { email, password, returnSecureToken: true });
      if (typeof result.localId !== 'string' || !result.localId || typeof result.email !== 'string') throw invalidCode();
      return { uid: result.localId, email: result.email.toLowerCase() };
    } catch (error) { return recoveryError(error); }
  },
};
