import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { applicationDefault, cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDownloadURL, getStorage } from 'firebase-admin/storage';

export class ServiceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type StorageProvider = 'local' | 'firebase' | 'cloudinary';
export interface PublicFirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
}
export interface VerifiedFirebaseIdentity {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
}

const setting = (name: string) => process.env[name]?.trim() || '';

/** Only browser-safe Firebase identifiers are included in this response. */
export function getServiceConfig() {
  const apiKey = setting('FIREBASE_API_KEY');
  const authDomain = setting('FIREBASE_AUTH_DOMAIN');
  const projectId = setting('FIREBASE_PROJECT_ID');
  const appId = setting('FIREBASE_APP_ID');
  const storageBucket = setting('FIREBASE_STORAGE_BUCKET');
  const firebase: PublicFirebaseConfig | null = apiKey && authDomain && projectId && appId ? {
    apiKey, authDomain, projectId, appId, ...(storageBucket ? { storageBucket } : {}),
  } : null;
  const requestedStorage = setting('STORAGE_PROVIDER');
  const provider: StorageProvider | null = requestedStorage === 'local' || requestedStorage === 'firebase' || requestedStorage === 'cloudinary' ? requestedStorage : null;
  const credentialFile = setting('GOOGLE_APPLICATION_CREDENTIALS');
  const firebaseCredentialsReady = !!credentialFile && existsSync(credentialFile) || setting('FIREBASE_USE_APPLICATION_DEFAULT') === 'true';
  const storageConfigured = provider === 'local' ? true : provider === 'firebase'
    ? !!projectId && !!storageBucket && !storageBucket.includes('://') && firebaseCredentialsReady
    : provider === 'cloudinary'
      ? !!setting('CLOUDINARY_CLOUD_NAME') && !!setting('CLOUDINARY_API_KEY') && !!setting('CLOUDINARY_API_SECRET')
      : false;
  return {
    firebase,
    verification: {
      provider: firebase ? 'firebase' as const : null,
      email: !!firebase,
      phone: !!firebase && setting('FIREBASE_PHONE_ENABLED') === 'true',
    },
    storage: { provider, configured: storageConfigured },
  };
}

function firebaseAdminApp(): App {
  const projectId = setting('FIREBASE_PROJECT_ID');
  if (!projectId) throw new ServiceError(503, 'Firebase verification is not configured. Add the Firebase project settings first.');
  const credentialFile = setting('GOOGLE_APPLICATION_CREDENTIALS');
  const appName = `smartshop-${createHash('sha256').update(`${projectId}:${credentialFile}`).digest('hex').slice(0, 20)}`;
  const existing = getApps().find(app => app.name === appName);
  if (existing) return existing;
  try {
    const credential = credentialFile
      ? cert(JSON.parse(readFileSync(credentialFile, 'utf8')) as ServiceAccount)
      : applicationDefault();
    return initializeApp({ projectId, credential, ...(setting('FIREBASE_STORAGE_BUCKET') ? { storageBucket: setting('FIREBASE_STORAGE_BUCKET') } : {}) }, appName);
  } catch {
    throw new ServiceError(503, 'Firebase server credentials could not be loaded. Check the server configuration.');
  }
}

/** Accept only cryptographically verified Firebase client ID tokens. */
export async function verifyFirebaseIdToken(token: string): Promise<VerifiedFirebaseIdentity> {
  if (!setting('FIREBASE_PROJECT_ID')) throw new ServiceError(503, 'Firebase verification is not configured yet.');
  if (typeof token !== 'string' || token.length < 20 || token.length > 20_000) throw new ServiceError(401, 'The Firebase verification token is invalid. Sign in again.');
  try {
    const decoded = await getAuth(firebaseAdminApp()).verifyIdToken(token);
    return {
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email : null,
      emailVerified: decoded.email_verified === true,
      phone: typeof decoded.phone_number === 'string' ? decoded.phone_number : null,
    };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if (['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled', 'auth/tenant-id-mismatch'].includes(code)) {
      throw new ServiceError(401, 'The Firebase verification token is invalid or expired. Sign in again.');
    }
    throw new ServiceError(503, 'Firebase could not verify this account right now. Please try again.');
  }
}

export interface CloudImage {
  url: string;
  storagePath: string;
  provider: StorageProvider;
}

export type PublicImagePurpose = 'product' | 'owner-avatar' | 'profile-avatar' | 'shop-logo';
type PublicImageInput = { buffer: Buffer; mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; userId: number; name: string; purpose: PublicImagePurpose };

const opaqueImageId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const localUploadDirectory = () => resolve(setting('LOCAL_UPLOAD_DIR') || '.data/uploads');

/** Read an image only from a server-generated, immutable local filename. */
export function readLocalImage(id: string, storagePath: string): Buffer {
  if (!opaqueImageId.test(id) || !new RegExp(`^${id}\\.(?:jpg|png|webp)$`).test(storagePath)) throw new ServiceError(404, 'Photo not found.');
  let descriptor: number | undefined;
  try {
    descriptor = openSync(join(localUploadDirectory(), storagePath), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 5 * 1024 * 1024) throw new Error('Invalid local image file');
    return readFileSync(descriptor);
  } catch { throw new ServiceError(404, 'Photo not found.'); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

/** Public product images, profile photos and shop logos. */
export async function uploadPublicImage(input: PublicImageInput): Promise<CloudImage> {
  const config = getServiceConfig().storage;
  if (!config.configured || !config.provider) throw new ServiceError(503, 'Photo storage is not configured for this shop yet.');
  const extension = input.mimeType === 'image/jpeg' ? 'jpg' : input.mimeType === 'image/png' ? 'png' : 'webp';
  if (config.provider === 'local') {
    const id = randomUUID();
    const storagePath = `${id}.${extension}`;
    try {
      mkdirSync(localUploadDirectory(), { recursive: true, mode: 0o700 });
      writeFileSync(join(localUploadDirectory(), storagePath), input.buffer, { flag: 'wx', mode: 0o600 });
      return { url: `/api/media/${id}`, storagePath, provider: 'local' };
    } catch { throw new ServiceError(503, 'The shop server could not save this photo. Check its available storage and try again.'); }
  }
  const folder = { product: 'products', 'owner-avatar': 'owner-avatars', 'profile-avatar': 'profile-images', 'shop-logo': 'shop-logos' }[input.purpose];
  const imageId = `smartshop/${folder}/${input.userId}/${randomUUID()}`;
  if (config.provider === 'firebase') {
    const storagePath = `${imageId}.${extension}`;
    try {
      const file = getStorage(firebaseAdminApp()).bucket(setting('FIREBASE_STORAGE_BUCKET')).file(storagePath);
      await file.save(input.buffer, {
        resumable: false,
        validation: 'crc32c',
        metadata: {
          contentType: input.mimeType,
          cacheControl: 'public,max-age=3600',
          metadata: { firebaseStorageDownloadTokens: randomUUID() },
        },
      });
      return { url: await getDownloadURL(file), storagePath, provider: 'firebase' };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(502, 'Firebase Storage could not save the image. Check the bucket, billing and server credentials.');
    }
  }

  const cloudName = setting('CLOUDINARY_CLOUD_NAME');
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(cloudName)) throw new ServiceError(503, 'The Cloudinary cloud name is invalid.');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const parameters = { allowed_formats: 'jpg,png,webp', overwrite: 'false', public_id: imageId, timestamp };
  const canonical = Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('&');
  const signature = createHash('sha256').update(canonical + setting('CLOUDINARY_API_SECRET')).digest('hex');
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }), `${input.purpose}.${extension}`);
  for (const [key, value] of Object.entries(parameters)) form.append(key, value);
  form.append('api_key', setting('CLOUDINARY_API_KEY'));
  form.append('signature', signature);
  try {
    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new ServiceError(502, 'Cloudinary could not save the image. Check the server credentials and upload settings.');
    const result = await response.json() as { secure_url?: unknown; public_id?: unknown };
    if (typeof result.secure_url !== 'string' || result.public_id !== imageId) throw new ServiceError(502, 'Cloudinary returned an unexpected upload response.');
    const url = new URL(result.secure_url);
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') throw new ServiceError(502, 'Cloudinary did not return a valid HTTPS image URL.');
    return { url: url.toString(), storagePath: imageId, provider: 'cloudinary' };
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(502, 'The cloud upload could not finish. Check the connection and try again.');
  }
}

/** Retained for callers that upload a product image directly. */
export const uploadProductImage = (input: Omit<PublicImageInput, 'purpose'>) => uploadPublicImage({ ...input, purpose: 'product' });
