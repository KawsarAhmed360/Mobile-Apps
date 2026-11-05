import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chooseAddress, privateIPv4 } from '../server/phone-address.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function serverUrl(value) {
  const input = value.trim();
  if (!input || /\s/.test(input)) throw new Error('SMARTSHOP_API_URL must be a complete server URL.');
  const url = new URL(input);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || input.includes('?') || input.includes('#')) {
    throw new Error('Use an HTTPS server URL, or a private LAN HTTP address, without credentials, query or fragment.');
  }
  const loopback = /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.protocol === 'http:' && !privateIPv4(url.hostname) && url.hostname !== 'localhost' && !loopback) {
    throw new Error('An internet backend requires HTTPS. This phone preview permits HTTP only on a private local network.');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}
function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Phone build stopped: ${command} exited with ${result.status ?? 'an error'}.`);
}

try {
  const address = chooseAddress();
  const supplied = process.env.SMARTSHOP_API_URL?.trim();
  if (!supplied && !address) throw new Error('No private network address was found. Connect the Mac and phone to the same Wi-Fi, then run this command again.');
  const apiUrl = serverUrl(supplied || `http://${address}:3001`);
  const env = { ...process.env, VITE_API_URL: apiUrl, SMARTSHOP_PHONE_PREVIEW: '1' };
  // A physical-phone APK always bundles its UI. Never retain an emulator/live-server URL.
  delete env.CAPACITOR_DEV_SERVER_URL;
  if (!existsSync(join(root, 'node_modules/@capacitor/cli/bin/capacitor'))) throw new Error('Project packages are missing. Run npm install first.');
  console.log(`\nSmartShop phone preview\nShop API: ${apiUrl}\nThe app UI will be bundled in the APK.\n`);
  const npmCli = process.env.npm_execpath;
  if (npmCli) run(process.execPath, [npmCli, 'run', 'build'], env);
  else run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], env);
  run(process.execPath, [join(root, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'android'], env);
  const nativeConfig = JSON.parse(readFileSync(join(root, 'android/app/src/main/assets/capacitor.config.json'), 'utf8'));
  if (nativeConfig.server?.url) throw new Error('The generated Android config still has a live-server URL. Refusing to build a phone APK with remote UI.');
  if (apiUrl.startsWith('http:') && nativeConfig.server?.cleartext !== true) {
    throw new Error('Local phone preview HTTP is not enabled in Capacitor. Check SMARTSHOP_PHONE_PREVIEW handling.');
  }
  run(process.execPath, [join(root, 'scripts/android-build.mjs')], env);
  const output = join(root, 'output');
  mkdirSync(output, { recursive: true });
  const usb = process.env.SMARTSHOP_APK_NAME === 'SmartShop-USB.apk';
  const latest = process.env.SMARTSHOP_APK_NAME === 'SmartShop-Latest.apk';
  const apkName = latest ? 'SmartShop-Latest.apk' : usb ? 'SmartShop-USB.apk' : 'SmartShop-Phone.apk';
  const pendingApk = join(output, `.${apkName}.${process.pid}.tmp`);
  try {
    copyFileSync(join(root, 'android/app/build/outputs/apk/debug/app-debug.apk'), pendingApk);
    renameSync(pendingApk, join(output, apkName));
  } finally {
    rmSync(pendingApk, { force: true });
  }
  if (latest) process.exit(0);
  const downloadUrl = `${apiUrl}/downloads/${usb ? 'usb' : 'apk'}`;
  const instructions = usb ? 'Keep the USB cable connected and adb reverse tcp:3001 tcp:3001 active.' : 'Both devices must use the same Wi-Fi for this local address.';
  writeFileSync(join(output, usb ? 'usb-connection.txt' : 'phone-connection.txt'), `SmartShop local class demo\nAPI: ${apiUrl}\nAPK download: ${downloadUrl}\n${instructions}\nKeep the Mac API server running.\n`);
  console.log(`\nPhone APK ready: output/${apkName}\nShop API: ${apiUrl}\nPhone download: ${downloadUrl}\nKeep the Mac server running. ${instructions}\n`);
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : 'Phone build failed.'}\n`);
  process.exitCode = 1;
}
