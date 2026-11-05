import { Capacitor } from '@capacitor/core';
import type { AuthResponse } from '../shared/types';

const SERVER_KEY = 'smartshop-api-url';
const SESSION_KEY = 'smartshop-session';
const SESSION_ORIGIN_KEY = 'smartshop-session-origin';
const SAVED_SESSION_KEY = 'smartshop-saved-session';
const ACTIVE_SESSION_KEY = 'smartshop-window-session';
const ACTIVE_SERVER_KEY = 'smartshop-window-api-url';
const NATIVE_SESSION_KEY = 'smartshop-native-session';
// Capture each browsing context. Neither another tab nor a later login may replace it.
const browserWindow = typeof window === 'undefined' ? null : window;
const tabStorage = typeof sessionStorage === 'undefined' ? null : sessionStorage;
const deviceStorage = typeof localStorage === 'undefined' ? null : localStorage;
const nativeApp = Capacitor.isNativePlatform();
const read = (storage: Storage | null, key: string) => { try { return storage?.getItem(key) ?? null; } catch { return null; } };
const write = (storage: Storage | null, key: string, value: string) => { try { storage?.setItem(key, value); } catch { /* Memory fallback. */ } };
const remove = (storage: Storage | null, key: string) => { try { storage?.removeItem(key); } catch { /* Memory fallback. */ } };
const parse = (value: string | null): any => { try { return JSON.parse(value || 'null'); } catch { return null; } };
const sessionId = (value: string | null) => {
  const id = value?.split('.')[0];
  return id && /^[a-zA-Z0-9_-]{1,128}$/.test(id) ? id : null;
};
const credentialKey = (origin: string, id: string) => `${SAVED_SESSION_KEY}:${encodeURIComponent(origin)}:${id}`;

/** HTTP is restricted to an explicitly chosen local development address. */
export function normalizeApiBaseUrl(value: string): string {
  const input = value.trim();
  if (!input || /\s/.test(input)) throw new Error('Enter a complete shop server address, for example http://192.168.1.5:3001.');
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('Enter an address starting with https:// or a local http:// address.'); }
  if (url.username || url.password || input.includes('?') || input.includes('#')) {
    throw new Error('Use the server address without a username, password, query or # fragment.');
  }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Only HTTPS or local HTTP server addresses are supported.');
  const parts = url.hostname.split('.').map(Number);
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname) && parts.every(part => part >= 0 && part <= 255);
  const local = url.hostname === 'localhost' || (ipv4 && (
    parts[0] === 10 || parts[0] === 127 ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
  ));
  if (url.protocol === 'http:' && !local) throw new Error('Internet shop servers must use HTTPS. HTTP is allowed only on your local network.');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

const configuredBaseUrl = (() => {
  const value = import.meta.env?.VITE_API_URL?.trim() ?? '';
  return value ? normalizeApiBaseUrl(value) : '';
})();
function savedBaseUrl() {
  const value = read(tabStorage, ACTIVE_SERVER_KEY) ?? read(deviceStorage, SERVER_KEY);
  try { return value ? normalizeApiBaseUrl(value) : configuredBaseUrl; } catch { return configuredBaseUrl; }
}
let baseUrl = savedBaseUrl();
// Freeze this window's selection so later connection changes in another window do not affect it.
write(tabStorage, ACTIVE_SERVER_KEY, baseUrl);
let connectionRevision = 0;
function markerId() {
  const marker = parse(read(tabStorage, ACTIVE_SESSION_KEY) ?? (nativeApp ? read(deviceStorage, NATIVE_SESSION_KEY) : null));
  return marker?.origin === baseUrl && typeof marker.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(marker.id) ? marker.id as string : null;
}
let activeSessionId = markerId();
function savedSession(): { token: string | null; refreshToken: string | null } {
  if (activeSessionId) {
    const data = parse(read(deviceStorage, credentialKey(baseUrl, activeSessionId)));
    if (data?.origin === baseUrl && typeof data.token === 'string' && data.token &&
        typeof data.refreshToken === 'string' && sessionId(data.refreshToken) === activeSessionId) return data;
  }
  // Legacy tab-scoped credentials can remain usable; a global remembered account is never adopted.
  if (read(tabStorage, SESSION_ORIGIN_KEY) === baseUrl) return { token: read(tabStorage, SESSION_KEY), refreshToken: null };
  return { token: null, refreshToken: null };
}
let { token: accessToken, refreshToken } = savedSession();
let sessionRevision = 0;
type RequestContext = { connection: number; session: number; origin: string };
let refreshInFlight: { context: RequestContext; promise: Promise<void> } | null = null;

function context(): RequestContext { return { connection: connectionRevision, session: sessionRevision, origin: baseUrl }; }
function assertCurrent(request: RequestContext) {
  if (request.connection !== connectionRevision || request.session !== sessionRevision) {
    throw new ApiError('The shop connection or signed-in account changed. Please try again.', 0);
  }
}
function sameSession(a: string | null, b: string | null) {
  // Rotation preserves the opaque session ID before the first dot.
  return typeof a === 'string' && !!a && typeof b === 'string' && !!b && a.split('.')[0] === b.split('.')[0];
}
function sessionChanged() { sessionRevision++; refreshInFlight = null; }
function announceSessionChange() {
  browserWindow?.dispatchEvent(new Event('smartshop-session-changed'));
}

export function getApiBaseUrl() { return baseUrl; }

type LiveSubscription = { onChange: () => void; source: EventSource };
const subscriptions = new Set<LiveSubscription>();
function restartSubscriptions() {
  for (const subscription of subscriptions) {
    subscription.source.close();
    subscription.source = new EventSource(`${baseUrl}/api/events`);
    subscription.source.addEventListener('change', subscription.onChange);
  }
}

function clearMarker(id: string | null) {
  remove(tabStorage, ACTIVE_SESSION_KEY);
  if (nativeApp) {
    const marker = parse(read(deviceStorage, NATIVE_SESSION_KEY));
    if (!id || marker?.id === id) remove(deviceStorage, NATIVE_SESSION_KEY);
  }
}
function saveMarker(id: string) {
  const value = JSON.stringify({ origin: baseUrl, id });
  write(tabStorage, ACTIVE_SESSION_KEY, value);
  if (nativeApp) write(deviceStorage, NATIVE_SESSION_KEY, value);
}
function changeBaseUrl(next: string) {
  if (next === baseUrl) return;
  // Changing this window's backend must not delete another window's credentials.
  clearMarker(activeSessionId);
  baseUrl = next; activeSessionId = null;
  connectionRevision++;
  sessionChanged(); accessToken = null; refreshToken = null;
  remove(tabStorage, SESSION_KEY); remove(tabStorage, SESSION_ORIGIN_KEY);
  write(tabStorage, ACTIVE_SERVER_KEY, next);
  restartSubscriptions();
  browserWindow?.dispatchEvent(new Event('smartshop-api-changed'));
}

export function setApiBaseUrl(value: string) {
  const next = normalizeApiBaseUrl(value);
  changeBaseUrl(next);
  write(tabStorage, ACTIVE_SERVER_KEY, next);
  // A default for a future window/app launch, never a command to switch an existing window.
  write(deviceStorage, SERVER_KEY, next);
  return next;
}

browserWindow?.addEventListener('storage', event => {
  const key = (event as StorageEvent).key;
  if (!activeSessionId || (key !== credentialKey(baseUrl, activeSessionId) && key !== null)) return;
  const saved = savedSession();
  // Only updates/revocation of THIS session are relevant. Another account's key is ignored.
  if (!saved.refreshToken) {
    sessionChanged(); accessToken = null; refreshToken = null;
    clearMarker(activeSessionId); activeSessionId = null;
  } else { accessToken = saved.token; refreshToken = saved.refreshToken; }
  announceSessionChange();
});

function saveAuthSession(result: AuthResponse) {
  const id = sessionId(result.refreshToken);
  if (!id) throw new ApiError('The shop returned an invalid saved sign-in. Please try again.', 0);
  activeSessionId = id;
  accessToken = result.token; refreshToken = result.refreshToken;
  write(deviceStorage, credentialKey(baseUrl, id), JSON.stringify({ origin: baseUrl, token: accessToken, refreshToken }));
  saveMarker(id);
  remove(tabStorage, SESSION_KEY); remove(tabStorage, SESSION_ORIGIN_KEY);
}
export function setAuthSession(result: AuthResponse) {
  sessionChanged();
  saveAuthSession(result);
}
export function setAccessToken(token: string | null) {
  const previousId = activeSessionId;
  sessionChanged();
  accessToken = token; refreshToken = null; activeSessionId = null;
  if (previousId) remove(deviceStorage, credentialKey(baseUrl, previousId));
  clearMarker(previousId);
  if (token) {
    write(tabStorage, SESSION_KEY, token); write(tabStorage, SESSION_ORIGIN_KEY, baseUrl);
  } else { remove(tabStorage, SESSION_KEY); remove(tabStorage, SESSION_ORIGIN_KEY); }
}
export function hasAccessToken() { return accessToken !== null || refreshToken !== null; }

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function refreshSession(requestContext: RequestContext) {
  assertCurrent(requestContext);
  if (refreshInFlight && refreshInFlight.context.connection === requestContext.connection && refreshInFlight.context.session === requestContext.session) return refreshInFlight.promise;
  const originalRefresh = refreshToken;
  const work = async () => {
    const saved = savedSession();
    if (saved.refreshToken && !sameSession(saved.refreshToken, originalRefresh)) throw new ApiError('The signed-in account changed. Please try again.', 0);
    const supplied = saved.refreshToken || originalRefresh;
    if (!supplied) throw new ApiError('Please sign in to continue.', 401);
    let response: Response;
    try { response = await fetch(`${requestContext.origin}/api/auth/refresh`, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: supplied }) }); }
    catch { throw new ApiError('Could not reconnect to SmartShop. Your saved sign-in will be retried when the connection is available.', 0); }
    const result = await response.json().catch(() => null);
    assertCurrent(requestContext);
    const latest = savedSession();
    if (saved.refreshToken && !latest.refreshToken) {
      // Observe another tab's logout even before its storage event is delivered.
      setAccessToken(null); announceSessionChange();
      throw new ApiError('This device has signed out. Please sign in to continue.', 0);
    }
    if (response.status === 401) {
      // A newer rotation in another tab must not be erased by a delayed rejection.
      if (latest.refreshToken && latest.refreshToken !== supplied) throw new ApiError('Your saved sign-in changed in another window. Please try again.', 0);
      setAccessToken(null); announceSessionChange();
      throw new ApiError('Your saved sign-in is no longer active. Please sign in again.', 401);
    }
    if (!response.ok || typeof result?.token !== 'string' || !result.token || typeof result?.refreshToken !== 'string' || !sameSession(result.refreshToken, supplied)) throw new ApiError('Could not restore your saved sign-in. Please try again.', 0);
    if (latest.refreshToken && latest.refreshToken !== supplied && latest.refreshToken !== result.refreshToken) {
      // Keep a later rotation/account already saved by another tab.
      if (!sameSession(latest.refreshToken, supplied)) throw new ApiError('The signed-in account changed. Please try again.', 0);
      accessToken = latest.token; refreshToken = latest.refreshToken;
      return;
    }
    saveAuthSession(result as AuthResponse);
  };
  const flight = { context: requestContext, promise: work() };
  refreshInFlight = flight;
  try { await flight.promise; } finally { if (refreshInFlight === flight) refreshInFlight = null; }
}

export async function signOutSession() {
  const origin = baseUrl;
  const signedOutAccess = accessToken;
  const latest = savedSession().refreshToken;
  const supplied = sameSession(latest, refreshToken) ? latest : refreshToken;
  // Clear immediately, including offline; late network replies cannot restore it.
  setAccessToken(null); announceSessionChange();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(`${origin}/api/auth/logout`, {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...(signedOutAccess ? { Authorization: `Bearer ${signedOutAccess}` } : {}) },
      body: JSON.stringify(supplied ? { refreshToken: supplied } : {}),
      signal: controller.signal,
    });
  } catch { /* This device remains signed out when the server is unreachable. */ }
  finally { clearTimeout(timeout); }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const requestContext = context();
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  let response: Response;
  const request = () => {
    assertCurrent(requestContext);
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`); else headers.delete('Authorization');
    return fetch(`${requestContext.origin}/api${path}`, { ...options, headers, redirect: 'error' });
  };
  try {
    response = await request();
  } catch {
    throw new ApiError('Could not connect to SmartShop. Check your connection and keep the development server running on your Mac.', 0);
  }
  assertCurrent(requestContext);
  const canRefresh = !['/auth/login','/auth/register','/auth/refresh','/auth/logout','/setup/owner'].includes(path);
  if (response.status === 401 && refreshToken && canRefresh) {
    await refreshSession(requestContext);
    try { response = await request(); } catch { throw new ApiError('Could not reconnect to SmartShop. Please try again.', 0); }
  }
  const data = await response.json().catch(() => null);
  assertCurrent(requestContext);
  if (!response.ok) {
    const message = typeof data?.error === 'string' ? data.error : typeof data?.message === 'string' ? data.message : 'Something went wrong. Please try again.';
    throw new ApiError(message, response.status);
  }
  if (data === null) throw new ApiError('The shop server returned an unexpected response. Check your API connection.', 0);
  return data as T;
}

export function subscribeToChanges(onChange: () => void) {
  const subscription = { onChange, source: new EventSource(`${baseUrl}/api/events`) };
  subscription.source.addEventListener('change', onChange);
  subscriptions.add(subscription);
  return () => { subscription.source.close(); subscriptions.delete(subscription); };
}

export const post = <T,>(path: string, value: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(value) });
export const upload = <T,>(path: string, value: FormData) => api<T>(path, { method: 'POST', body: value });

/** Local media follows the selected shop connection on both web and Android. */
export function mediaUrl(value: string | null | undefined): string {
  if (!value) return "";
  return value.startsWith("/api/media/") ? `${baseUrl}${value}` : value;
}
