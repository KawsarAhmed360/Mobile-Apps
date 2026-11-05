import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const adb = process.env.SMARTSHOP_ADB || join(process.env.ANDROID_HOME || '/Users/kawsarahmed/Library/Android/sdk', 'platform-tools/adb');
function run(command, args, env = process.env, capture = false) {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'Phone operation failed.');
  return result.stdout || '';
}
try {
  if (!existsSync(adb)) throw new Error('Android platform tools are missing. Set SMARTSHOP_ADB to your adb location.');
  const devices = run(adb, ['devices'], process.env, true).split('\n').slice(1).map(line => line.trim().split(/\s+/)).filter(([id]) => id && !id.startsWith('emulator-'));
  const preferred = process.env.SMARTSHOP_PHONE_SERIAL;
  const matches = preferred ? devices.filter(([id]) => id === preferred) : devices;
  if (!matches.length) throw new Error('Connect your Android phone with USB, unlock it, enable USB debugging and allow this Mac on the phone. No emulator will be started.');
  if (matches.length > 1) throw new Error('More than one physical phone is connected. Set SMARTSHOP_PHONE_SERIAL to the intended device.');
  const [serial, state] = matches[0];
  if (state !== 'device') throw new Error(state === 'unauthorized' ? 'Unlock the phone and tap Allow on the USB debugging prompt, then retry.' : 'The phone is not ready. Reconnect the cable and retry.');
  const currentUser = run(adb, ['-s', serial, 'shell', 'am', 'get-current-user'], process.env, true).trim();
  if (!/^\d+$/.test(currentUser)) throw new Error('Could not identify the active phone profile. Unlock the phone and retry.');
  run(process.execPath, [join(root, 'scripts/phone-build.mjs')], { ...process.env, SMARTSHOP_API_URL: 'http://127.0.0.1:3001', SMARTSHOP_APK_NAME: 'SmartShop-USB.apk' });
  const apk = join(root, 'output/SmartShop-USB.apk');
  run(adb, ['-s', serial, 'reverse', 'tcp:3001', 'tcp:3001']);
  run(adb, ['-s', serial, 'install', '--no-streaming', '-r', '--user', currentUser, apk]);
  const installed = run(adb, ['-s', serial, 'shell', 'pm', 'path', '--user', currentUser, 'com.smartshop.app'], process.env, true);
  if (!installed.includes('package:')) throw new Error('Android has not installed the app in your active phone profile. Check the phone for an installation prompt.');
  const launch = run(adb, ['-s', serial, 'shell', 'am', 'start', '--user', currentUser, '-W', '-n', 'com.smartshop.app/.MainActivity'], process.env, true);
  if (/Error:|Error type|Exception|Status:\s*(?:timeout|error)/i.test(launch)) throw new Error('The app was installed but Android could not open it. Try the SmartShop icon on the phone.');
  console.log(launch);
  console.log('\nSmartShop installed on your physical phone. Keep USB connected and the Mac API running. No emulator was used.\n');
} catch (error) { console.error(error.message); process.exitCode = 1; }
