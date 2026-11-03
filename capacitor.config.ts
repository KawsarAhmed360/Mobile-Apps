import type { CapacitorConfig } from '@capacitor/cli';

const devServer = process.env.CAPACITOR_DEV_SERVER_URL;
if (devServer && !/^https?:\/\//.test(devServer)) {
  throw new Error('CAPACITOR_DEV_SERVER_URL must be an http(s) URL.');
}

const config: CapacitorConfig = {
  appId: 'com.smartshop.app',
  appName: 'SmartShop',
  webDir: 'dist',
  ...(devServer ? { server: { url: devServer, cleartext: devServer.startsWith('http:') } } : {}),
};

export default config;
