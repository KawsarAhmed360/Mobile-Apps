import { existsSync, readFileSync } from 'node:fs';
const path = '.data/owner-setup-code';
if (!existsSync(path)) { console.error('Start SmartShop once with npm run dev, then run this command again.'); process.exit(1); }
console.log('\nOwner activation code (keep private; use once in Create owner account):\n');
console.log(readFileSync(path, 'utf8').trim());
console.log('\nUse your own name, email and a new password in the app.\n');
