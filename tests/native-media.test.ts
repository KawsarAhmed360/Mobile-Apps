import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Capacitor } from '@capacitor/core';
import { setApiBaseUrl } from '../src/api.js';
import { loadMediaBlobUrl, nativeMediaNeedsDownload } from '../src/media.js';

test('native photo downloads stay within the connected shop and return image object URLs', async () => {
  const nativePlatform = Capacitor.isNativePlatform;
  const originalFetch = globalThis.fetch;
  const url = 'http://192.168.1.50:3001/api/media/11111111-2222-4333-8444-555555555555';
  Capacitor.isNativePlatform = () => true;
  setApiBaseUrl('http://192.168.1.50:3001');
  try {
    assert.equal(nativeMediaNeedsDownload(url), true);
    assert.equal(nativeMediaNeedsDownload(url.replace('192.168.1.50', '192.168.1.51')), false);
    assert.equal(nativeMediaNeedsDownload(url.replace('/api/media/', '/api/auth/')), false);
    assert.equal(nativeMediaNeedsDownload(url.replace('http:', 'https:')), false);
    assert.equal(nativeMediaNeedsDownload(url + '?redirect=elsewhere'), false);
    let requests = 0;
    globalThis.fetch = async (input, options) => {
      requests++;
      assert.equal(input, url);
      assert.equal(options?.redirect, 'error');
      return new Response(new Blob(['fixture image bytes'], { type: 'image/png' }));
    };
    const objectUrl = await loadMediaBlobUrl(url);
    assert.match(objectUrl, /^blob:/);
    URL.revokeObjectURL(objectUrl);
    await assert.rejects(loadMediaBlobUrl(url.replace('192.168.1.50', '192.168.1.51')), /connected shop/);
    assert.equal(requests, 1);
    globalThis.fetch = async () => new Response('<html>not an image</html>', { headers: { 'Content-Type': 'text/html' } });
    await assert.rejects(loadMediaBlobUrl(url), /supported photo/);
    Capacitor.isNativePlatform = () => false;
    assert.equal(nativeMediaNeedsDownload(url), false);
  } finally {
    Capacitor.isNativePlatform = nativePlatform;
    globalThis.fetch = originalFetch;
  }
});
