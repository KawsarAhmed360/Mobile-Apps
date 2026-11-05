import type { CapacitorConfig } from '@capacitor/cli';
import { existsSync } from 'node:fs';

const devServer = process.env.CAPACITOR_DEV_SERVER_URL;
const phonePreview = process.env.SMARTSHOP_PHONE_PREVIEW === '1';
if (devServer && !/^https?:\/\//.test(devServer)) {
  throw new Error('CAPACITOR_DEV_SERVER_URL must be an http(s) URL.');
}

const config: CapacitorConfig = {
  appId: 'com.smartshop.app',
  appName: 'SmartShop',
  webDir: 'dist',
  includePlugins: existsSync('android/app/google-services.json') ? ['@capacitor-firebase/authentication'] : [],
  plugins: { FirebaseAuthentication: { providers: ['phone'] } },
  ...(phonePreview ? { android: { allowMixedContent: true }, server: { cleartext: true } } : {}),
  ...(devServer ? { server: { url: devServer, cleartext: devServer.startsWith('http:') } } : {}),
};

export default config;
