import { Capacitor } from '@capacitor/core';
import { getApiBaseUrl } from './api';

/** Native HTTPS WebViews can block HTTP image tags even when API fetches work. */
export function nativeMediaNeedsDownload(resolvedUrl: string): boolean {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const media = new URL(resolvedUrl);
    const shop = new URL(getApiBaseUrl());
    const mediaPath = `${shop.pathname.replace(/\/+$/, '')}/api/media/`;
    return media.protocol === 'http:' && media.origin === shop.origin &&
      media.pathname.startsWith(mediaPath) &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(media.pathname.slice(mediaPath.length)) &&
      !media.search && !media.hash;
  } catch { return false; }
}

/** The caller owns the object URL and revokes it after displaying the photo. */
export async function loadMediaBlobUrl(resolvedUrl: string, signal?: AbortSignal): Promise<string> {
  if (!nativeMediaNeedsDownload(resolvedUrl)) throw new Error('Choose a photo from the connected shop.');
  const response = await fetch(resolvedUrl, { signal, redirect: 'error', credentials: 'omit', cache: 'no-cache' });
  if (!response.ok) throw new Error('The shop photo could not be loaded.');
  const photo = await response.blob();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.type.toLowerCase()) || photo.size === 0 || photo.size > 5 * 1024 * 1024) {
    throw new Error('The shop did not return a supported photo.');
  }
  return URL.createObjectURL(photo);
}
