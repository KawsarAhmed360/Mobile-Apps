import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const java21 = '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
const javaHome = existsSync(java21) ? java21 : process.env.JAVA_HOME;
const sdk = process.env.ANDROID_HOME || join(homedir(), 'Library/Android/sdk');
if (!javaHome || !existsSync(join(javaHome, 'bin/java'))) {
  console.error('Java 21 is required. Read START_HERE_BN.md for the Mac setup.');
  process.exit(1);
}
if (!existsSync(sdk)) {
  console.error('Android SDK is missing. Complete the Android Studio setup wizard first.');
  process.exit(1);
}
const result = spawnSync('./gradlew', ['--no-daemon', 'assembleDebug'], {
  cwd: resolve('android'), stdio: 'inherit',
  env: { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk },
});
if (result.error) console.error(result.error.message);
if (result.status === 0) console.log('\nAPK ready: android/app/build/outputs/apk/debug/app-debug.apk\n');
process.exit(result.status ?? 1);
