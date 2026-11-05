import { normalizeSignupPhone } from '../shared/phone.js';
import { ServiceError, type VerifiedFirebaseIdentity } from './services.js';

interface SignupContact {
  email: string;
  phone: string;
  idToken?: string;
}

interface SignupPolicy { email: boolean; phone: boolean }

export async function verifySignupContact(
  contact: SignupContact,
  policy: SignupPolicy,
  verify: (token: string) => Promise<VerifiedFirebaseIdentity>,
) {
  if (!policy.email) {
    if (contact.idToken || policy.phone) throw new ServiceError(503, 'Signup verification is not configured on this server.');
    return { uid: null, phone: contact.phone, emailVerified: 0, phoneVerified: 0 };
  }
  const phone = normalizeSignupPhone(contact.phone);
  if ((contact.phone || policy.phone) && !phone) {
    throw new ServiceError(400, 'Enter a valid phone number with its country code, for example +880.');
  }
  if (!contact.idToken) throw new ServiceError(403, 'Verify your email before completing signup.');
  const identity = await verify(contact.idToken);
  if (!identity.emailVerified || identity.email?.toLowerCase() !== contact.email.toLowerCase()) {
    throw new ServiceError(403, 'Verify the same email address you entered on the signup form.');
  }
  const verifiedPhone = !!phone && phone === identity.phone;
  if (policy.phone && !verifiedPhone) throw new ServiceError(403, 'Verify the same phone number you entered on the signup form.');
  return { uid: identity.uid, phone: phone ?? '', emailVerified: 1, phoneVerified: verifiedPhone ? 1 : 0 };
}
