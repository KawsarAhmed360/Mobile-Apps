import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

console.log('\nSmartShop setup check\n');
const major = Number(process.versions.node.split('.')[0]);
console.log(`${major === 24 ? '✓' : '!'} Node ${process.version}${major === 24 ? '' : ' — please use Node 24 LTS'}`);
console.log(`${existsSync('node_modules') ? '✓' : '!'} Project packages ${existsSync('node_modules') ? 'installed' : 'missing — run npm install'}`);
console.log(`${existsSync('/Applications/Visual Studio Code.app') ? '✓' : '!'} VS Code`);
const studio = '/Applications/Android Studio.app';
console.log(`${existsSync(studio) ? '✓' : '!'} Android Studio${existsSync(studio) ? '' : ' — needed later for Android builds'}`);
const java21 = '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
console.log(`${existsSync(java21) ? '✓' : '!'} Java 21 for Android builds`);
const sdk = process.env.ANDROID_HOME || join(homedir(), 'Library/Android/sdk');
console.log(`${existsSync(sdk) ? '✓' : '!'} Android SDK: ${sdk}`);
const adb = join(sdk, 'platform-tools/adb');
if (existsSync(adb)) {
  try { console.log(execFileSync(adb, ['devices'], { encoding: 'utf8' })); }
  catch { console.log('! Could not read Android devices.'); }
}
console.log('\nStart the app: npm run dev');
console.log('Open in your browser: http://localhost:5173');
console.log('Beginner guide: START_HERE_BN.md\n');
