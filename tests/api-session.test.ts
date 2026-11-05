import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Capacitor } from '@capacitor/core';
import type { AuthResponse } from '../shared/types';

type ApiModule = typeof import('../src/api');
const savedKey = 'smartshop-saved-session';
const originA = 'https://shop-a.example';
const originB = 'https://shop-b.example';
let sequence = 0;
const original = new Map(['window', 'localStorage', 'sessionStorage', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const auth = (account = 'a', rotation = 'initial'): AuthResponse => ({
  token: `${account}-access-${rotation}`, refreshToken: `${account.repeat(48)}.${rotation}`,
  user: { id: account === 'a' ? 1 : 2, name: account, username: account, email: `${account}@example.com`, role: 'customer' },
});
async function loadApi(): Promise<ApiModule> { return import(`../src/api.ts?session-test=${sequence++}`); }
function installFetch(callback: (url: string, options: RequestInit) => Promise<Response>) {
  globalThis.fetch = ((input: RequestInfo | URL, options: RequestInit = {}) => callback(String(input), options)) as typeof fetch;
}
function activeKey() {
  const marker = JSON.parse(sessionStorage.getItem('smartshop-window-session') || 'null');
  return marker ? `${savedKey}:${encodeURIComponent(marker.origin)}:${marker.id}` : savedKey;
}
function stored() { return JSON.parse(localStorage.getItem(activeKey()) || 'null'); }
function storageChanged(key: string) { window.dispatchEvent(Object.assign(new Event('storage'), { key: key === savedKey ? activeKey() : key })); }

describe('persistent browser sessions', () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries({ window: new EventTarget(), localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() })) {
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
  });
  afterEach(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });

  it('restores a saved sign-in after reload and keeps it during temporary network failures', async () => {
    const first = await loadApi(); first.setApiBaseUrl(originA); first.setAuthSession(auth());
    const reloaded = await loadApi();
    assert.equal(reloaded.hasAccessToken(), true);
    installFetch(async () => { throw new TypeError('offline'); });
    await assert.rejects(reloaded.api('/auth/me'), error => error instanceof reloaded.ApiError && error.status === 0);
    assert.equal(stored().refreshToken, auth().refreshToken);
    assert.equal(reloaded.hasAccessToken(), true);
    installFetch(async (_url, options) => {
      assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${auth().token}`);
      return json(auth().user);
    });
    assert.equal((await reloaded.api<AuthResponse['user']>('/auth/me')).id, 1);
  });

  it('shares one refresh across simultaneous expired requests and retries with the rotated access token', async () => {
    const api = await loadApi(); api.setApiBaseUrl(originA); api.setAuthSession(auth());
    const refreshed = deferred<Response>(); let refreshes = 0;
    installFetch(async (url, options) => {
      assert.equal(options.redirect, 'error');
      if (url.endsWith('/auth/refresh')) { refreshes++; return refreshed.promise; }
      return new Headers(options.headers).get('Authorization') === `Bearer ${auth('a', 'rotated').token}` ? json({ ok: true }) : json({ error: 'expired' }, 401);
    });
    const results = [api.api('/auth/me'), api.api('/dashboard')];
    await tick(); assert.equal(refreshes, 1);
    refreshed.resolve(json(auth('a', 'rotated')));
    assert.deepEqual(await Promise.all(results), [{ ok: true }, { ok: true }]);
    assert.equal(stored().refreshToken, auth('a', 'rotated').refreshToken);
  });

  it('preserves the saved session when refreshing is offline or temporarily unavailable', async () => {
    const api = await loadApi(); api.setApiBaseUrl(originA); api.setAuthSession(auth());
    for (const failure of ['offline', 'unavailable']) {
      installFetch(async url => {
        if (!url.endsWith('/auth/refresh')) return json({ error: 'expired' }, 401);
        if (failure === 'offline') throw new TypeError('offline');
        return json({ error: 'maintenance' }, 503);
      });
      await assert.rejects(api.api('/auth/me'), error => error instanceof api.ApiError && error.status === 0);
      assert.equal(stored().refreshToken, auth().refreshToken);
      assert.equal(api.hasAccessToken(), true);
    }
  });

  it('clears a genuinely revoked session after a refresh rejection', async () => {
    const api = await loadApi(); api.setApiBaseUrl(originA); api.setAuthSession(auth());
    installFetch(async () => json({ error: 'revoked' }, 401));
    await assert.rejects(api.api('/auth/me'), error => error instanceof api.ApiError && error.status === 401);
    assert.equal(api.hasAccessToken(), false); assert.equal(stored(), null);
  });

  it('cannot resurrect sign-in when a refresh completes after manual sign-out', async () => {
    const api = await loadApi(); api.setApiBaseUrl(originA); api.setAuthSession(auth());
    const refreshed = deferred<Response>(); let protectedCalls = 0;
    installFetch(async url => {
      if (url.endsWith('/auth/refresh')) return refreshed.promise;
      if (url.endsWith('/auth/logout')) return json({ ok: true });
      protectedCalls++; return json({ error: 'expired' }, 401);
    });
    const pending = api.api('/auth/me'); const rejected = assert.rejects(pending, error => error instanceof api.ApiError && error.status === 0);
    await tick(); await api.signOutSession();
    assert.equal(api.hasAccessToken(), false); assert.equal(stored(), null);
    refreshed.resolve(json(auth('a', 'rotated'))); await rejected;
    assert.equal(protectedCalls, 1); assert.equal(api.hasAccessToken(), false); assert.equal(stored(), null);
  });

  it('clears the device immediately while offline and does not erase a later sign-in when logout finishes', async () => {
    const api = await loadApi(); api.setApiBaseUrl(originA); api.setAuthSession(auth());
    const logout = deferred<Response>(); installFetch(async () => logout.promise);
    const signingOut = api.signOutSession();
    assert.equal(api.hasAccessToken(), false); assert.equal(stored(), null);
    api.setAuthSession(auth('b'));
    logout.resolve(json({ ok: true })); await signingOut;
    assert.equal(stored().token, auth('b').token);
    installFetch(async () => { throw new TypeError('offline'); });
    await api.signOutSession(); assert.equal(api.hasAccessToken(), false); assert.equal(stored(), null);
  });

  it('does not retry an old account request with a newly signed-in account', async () => {
    const api = await loadApi(); api.setApiBaseUrl(originA); api.setAuthSession(auth());
    const response = deferred<Response>(); let calls = 0;
    installFetch(async () => { calls++; return response.promise; });
    const pending = api.api('/sales', { method: 'POST', body: JSON.stringify({ requestId: 'old-account-sale' }) });
    const rejected = assert.rejects(pending, error => error instanceof api.ApiError && error.status === 0);
    api.setAuthSession(auth('b')); response.resolve(json({ error: 'expired' }, 401)); await rejected;
    assert.equal(calls, 1); assert.equal(stored().token, auth('b').token);
  });

  it('binds refresh and retry credentials to the selected shop during an in-flight server switch', async () => {
    const api = await loadApi(); api.setApiBaseUrl(originA); api.setAuthSession(auth());
    const oldRefresh = deferred<Response>(); const calls: { url: string; token: string | null; body: unknown }[] = [];
    installFetch(async (url, options) => {
      calls.push({ url, token: new Headers(options.headers).get('Authorization'), body: options.body ? JSON.parse(String(options.body)) : null });
      if (url === `${originA}/api/auth/refresh`) return oldRefresh.promise;
      if (url === `${originB}/api/auth/refresh`) return json(auth('b', 'rotated'));
      return new Headers(options.headers).get('Authorization') === `Bearer ${auth('b', 'rotated').token}` ? json({ shop: 'b' }) : json({ error: 'expired' }, 401);
    });
    const old = api.api('/auth/me'); const rejected = assert.rejects(old, error => error instanceof api.ApiError && error.status === 0);
    await tick(); api.setApiBaseUrl(originB); api.setAuthSession(auth('b'));
    assert.deepEqual(await api.api('/auth/me'), { shop: 'b' });
    oldRefresh.resolve(json(auth('a', 'rotated'))); await rejected;
    assert.equal(stored().origin, originB); assert.equal(stored().token, auth('b', 'rotated').token);
    for (const call of calls.filter(call => call.url.startsWith(originB))) {
      assert.ok(!call.token?.includes('a-access'));
      assert.ok(!JSON.stringify(call.body).includes(auth().refreshToken));
    }
  });

  it('keeps a newer cross-tab rotation when a delayed old refresh is rejected', async () => {
    const api = await loadApi(); api.setApiBaseUrl(originA); api.setAuthSession(auth());
    const oldRefresh = deferred<Response>();
    installFetch(async url => url.endsWith('/auth/refresh') ? oldRefresh.promise : json({ error: 'expired' }, 401));
    const pending = api.api('/auth/me'); const rejected = assert.rejects(pending, error => error instanceof api.ApiError && error.status === 0);
    await tick();
    localStorage.setItem(activeKey(), JSON.stringify({ origin: originA, ...auth('a', 'newer-tab') }));
    oldRefresh.resolve(json({ error: 'stale refresh' }, 401)); await rejected;
    assert.equal(stored().refreshToken, auth('a', 'newer-tab').refreshToken); assert.equal(api.hasAccessToken(), true);
  });

  it('ignores credentials saved for another shop and cancels an old response after another tab signs out', async () => {
    localStorage.setItem('smartshop-api-url', originA);
    localStorage.setItem(savedKey, JSON.stringify({ origin: originB, ...auth('b') }));
    const api = await loadApi(); assert.equal(api.hasAccessToken(), false);
    installFetch(async (_url, options) => {
      assert.equal(new Headers(options.headers).has('Authorization'), false);
      return json({ public: true });
    });
    await api.api('/products');
    api.setAuthSession(auth());
    const response = deferred<Response>(); installFetch(async () => response.promise);
    const pending = api.api('/auth/me'); const rejected = assert.rejects(pending, error => error instanceof api.ApiError && error.status === 0);
    localStorage.removeItem(activeKey()); storageChanged(savedKey);
    response.resolve(json(auth().user)); await rejected;
    assert.equal(api.hasAccessToken(), false);
  });

  it('does not change this window when another window changes its shop or signs in', async () => {
    const api = await loadApi(); api.setApiBaseUrl(originA); api.setAuthSession(auth());
    localStorage.setItem('smartshop-api-url', originB);
    localStorage.setItem(`${savedKey}:${encodeURIComponent(originB)}:${auth('b').refreshToken.split('.')[0]}`, JSON.stringify({ origin: originB, ...auth('b') }));
    storageChanged('smartshop-api-url');
    window.dispatchEvent(Object.assign(new Event('storage'), { key: `${savedKey}:${encodeURIComponent(originB)}:${auth('b').refreshToken.split('.')[0]}` }));
    assert.equal(api.getApiBaseUrl(), originA); assert.equal(api.hasAccessToken(), true);
    installFetch(async (url, options) => {
      assert.equal(url, `${originA}/api/auth/me`);
      assert.equal(new Headers(options.headers).get('Authorization'), `Bearer ${auth().token}`);
      return json(auth().user);
    });
    assert.equal((await api.api<AuthResponse['user']>('/auth/me')).id, 1);
  });

  it('does not restore a session removed by another tab before its logout event arrives', async () => {
    const api = await loadApi(); api.setApiBaseUrl(originA); api.setAuthSession(auth());
    const refreshed = deferred<Response>();
    installFetch(async url => url.endsWith('/auth/refresh') ? refreshed.promise : json({ error: 'expired' }, 401));
    const pending = api.api('/auth/me'); const rejected = assert.rejects(pending, error => error instanceof api.ApiError && error.status === 0);
    await tick(); localStorage.removeItem(activeKey());
    refreshed.resolve(json(auth('a', 'rotated'))); await rejected;
    assert.equal(api.hasAccessToken(), false); assert.equal(stored(), null);
  });
  it('keeps owner and customer windows independent through sign-in, refresh, storage events and logout', async () => {
    const shared = localStorage;
    const ownerWindow = window;
    const ownerTab = sessionStorage;
    const owner = await loadApi(); owner.setApiBaseUrl(originA);
    owner.setAuthSession({ ...auth('a'), user: { ...auth('a').user, role: 'owner' } });
    const ownerKey = activeKey();
    // A fresh browser window shares localStorage but has a separate tab session.
    const customerWindow = new EventTarget();
    const customerTab = new MemoryStorage();
    Object.defineProperty(globalThis, 'window', { value: customerWindow, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: customerTab, configurable: true, writable: true });
    const customer = await loadApi();
    assert.equal(customer.hasAccessToken(), false, 'fresh windows must not inherit a remembered owner');
    customer.setAuthSession(auth('b'));
    const customerKey = activeKey();
    assert.notEqual(ownerKey, customerKey);
    ownerWindow.dispatchEvent(Object.assign(new Event('storage'), { key: customerKey }));
    customerWindow.dispatchEvent(Object.assign(new Event('storage'), { key: ownerKey }));
    installFetch(async (_url, options) => json({ bearer: new Headers(options.headers).get('Authorization') }));
    assert.deepEqual(await owner.api('/auth/me'), { bearer: `Bearer ${auth('a').token}` });
    assert.deepEqual(await customer.api('/auth/me'), { bearer: `Bearer ${auth('b').token}` });
    const customerReload = await loadApi();
    assert.deepEqual(await customerReload.api('/auth/me'), { bearer: `Bearer ${auth('b').token}` });
    await customerReload.signOutSession();
    ownerWindow.dispatchEvent(Object.assign(new Event('storage'), { key: customerKey }));
    assert.equal(owner.hasAccessToken(), true, 'customer sign-out must not affect the owner');
    assert.ok(shared.getItem(ownerKey)); assert.equal(shared.getItem(customerKey), null);
    Object.defineProperty(globalThis, 'window', { value: ownerWindow, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: ownerTab, configurable: true, writable: true });
    const ownerReload = await loadApi();
    assert.deepEqual(await ownerReload.api('/auth/me'), { bearer: `Bearer ${auth('a').token}` });
    await ownerReload.signOutSession(); assert.equal(shared.getItem(ownerKey), null);
  });

  it('restores the native Android app session after a new WebView session without auto-login in a fresh web window', async () => {
    const originalNative = Capacitor.isNativePlatform;
    try {
      Capacitor.isNativePlatform = () => true;
      const native = await loadApi(); native.setApiBaseUrl(originA); native.setAuthSession(auth());
      Object.defineProperty(globalThis, 'sessionStorage', { value: new MemoryStorage(), configurable: true, writable: true });
      const restarted = await loadApi(); assert.equal(restarted.hasAccessToken(), true);
      installFetch(async (_url, options) => json({ bearer: new Headers(options.headers).get('Authorization') }));
      assert.deepEqual(await restarted.api('/auth/me'), { bearer: `Bearer ${auth().token}` });
      Capacitor.isNativePlatform = () => false;
      Object.defineProperty(globalThis, 'sessionStorage', { value: new MemoryStorage(), configurable: true, writable: true });
      const browser = await loadApi(); assert.equal(browser.hasAccessToken(), false);
      await restarted.signOutSession();
      assert.equal(localStorage.getItem('smartshop-native-session'), null);
    } finally { Capacitor.isNativePlatform = originalNative; }
  });

});
