import { execFile, spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import QRCode from 'qrcode';
import { chooseAddress, privateIPv4 } from './phone-address.js';

const execFileAsync = promisify(execFile);
const phoneBuildScript = fileURLToPath(new URL('../scripts/phone-build.mjs', import.meta.url));
const latestDownload = '/downloads/latest.apk';
const output = resolve('output');
const apkPath = join(output, 'SmartShop-Latest.apk');
const pngPath = join(output, 'SmartShop-Latest-QR.png');
const svgPath = join(output, 'SmartShop-Latest-QR.svg');
const connectionPath = join(output, 'latest-phone-connection.txt');
const qrPaths = [pngPath, svgPath, connectionPath];

async function usbReverse(port: number, signal: AbortSignal): Promise<boolean> {
  const sdk = process.env.ANDROID_HOME || join(homedir(), 'Library/Android/sdk');
  const adb = process.env.SMARTSHOP_ADB || join(sdk, 'platform-tools/adb');
  const options = { timeout: 4_000, signal };
  try {
    const state = await execFileAsync(adb, ['-d', 'get-state'], options);
    if (state.stdout.trim() !== 'device') return false;
    await execFileAsync(adb, ['-d', 'reverse', `tcp:${port}`, `tcp:${port}`], options);
    return true;
  } catch {
    signal.throwIfAborted();
    return false;
  }
}

async function phoneConnection(host: string, port: number, signal: AbortSignal) {
  const wildcard = host === '0.0.0.0' || host === '::';
  if ((wildcard || host === '127.0.0.1') && await usbReverse(port, signal)) {
    return { apiUrl: `http://127.0.0.1:${port}`, instruction: 'Keep this authorized Android phone connected by USB.' };
  }
  const address = wildcard ? chooseAddress() : privateIPv4(host) ? host : undefined;
  if (!address) throw new Error('Connect your authorized Android phone by USB, or connect the Mac and phone to the same Wi-Fi and start the server again.');
  return { apiUrl: `http://${address}:${port}`, instruction: 'Connect the Android phone and Mac to the same Wi-Fi.' };
}

function buildApk(apiUrl: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolveBuild, reject) => {
    const processGroup = process.platform !== 'win32';
    const child = spawn(process.execPath, [phoneBuildScript], {
      detached: processGroup,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, SMARTSHOP_API_URL: apiUrl, SMARTSHOP_APK_NAME: 'SmartShop-Latest.apk' },
    });
    const cancel = () => {
      if (!child.pid) return;
      try { process.kill(processGroup ? -child.pid : child.pid, 'SIGTERM'); } catch { /* Build already exited. */ }
    };
    signal.addEventListener('abort', cancel, { once: true });
    child.once('error', error => {
      signal.removeEventListener('abort', cancel);
      reject(error);
    });
    child.once('close', code => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) reject(signal.reason);
      else if (code === 0) resolveBuild();
      else reject(new Error('Android build failed. Review the build output above, then start the server again.'));
    });
  });
}

async function checkServer(url: string, method: 'GET' | 'HEAD', signal: AbortSignal): Promise<Response> {
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(3_000)]) });
  if (!response.ok) throw new Error(`Download server returned HTTP ${response.status}.`);
  return response;
}

export async function prepareStartupApk(host: string, port: number, publish: (path?: string) => void, signal: AbortSignal) {
  await mkdir(output, { recursive: true });
  await Promise.all([...qrPaths, apkPath].map(path => rm(path, { force: true })));
  try {
    const { apiUrl, instruction } = await phoneConnection(host, port, signal);
    await checkServer(`${apiUrl}/api/health`, 'GET', signal);
    console.log('Building the latest Android APK for the download QR…');
    await buildApk(apiUrl, signal);
    signal.throwIfAborted();

    const url = `${apiUrl}${latestDownload}`;
    publish(apkPath);
    const response = await checkServer(url, 'HEAD', signal);
    if (Number(response.headers.get('content-length')) <= 0 || response.headers.get('content-type') !== 'application/vnd.android.package-archive') {
      throw new Error('The download endpoint did not return a valid APK.');
    }
    await Promise.all([
      QRCode.toFile(pngPath, url, { width: 420, margin: 4 }),
      QRCode.toFile(svgPath, url, { margin: 4 }),
      writeFile(connectionPath, `${url}\n${instruction}\nKeep the Mac server running.\n`),
    ]);
    const qr = await QRCode.toString(url, { type: 'terminal', small: true });
    signal.throwIfAborted();
    console.log(`\nSmartShop latest APK — scan with your Android phone\n${qr}\n${url}\n${instruction}\nQR image: output/SmartShop-Latest-QR.png\n`);
  } catch (error) {
    publish(undefined);
    await Promise.allSettled(qrPaths.map(path => rm(path, { force: true })));
    throw error;
  }
}
