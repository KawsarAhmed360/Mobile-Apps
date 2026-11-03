#!/bin/zsh
set -eu
cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"

printf '\nSmartShop — local development\n\n'
if ! command -v node >/dev/null 2>&1; then
  printf 'Node.js is missing. Read START_HERE_BN.md for installation steps.\n'
  read -r '?Press Enter to close.'
  exit 1
fi
if [[ "$(node -p 'process.versions.node.split(".")[0]')" != '24' ]]; then
  printf 'Please use Node.js 24 LTS. Read START_HERE_BN.md.\n'
  read -r '?Press Enter to close.'
  exit 1
fi
if [[ ! -d node_modules ]]; then
  printf 'Installing SmartShop packages for the first time...\n'
  npm ci
fi
printf 'Open http://localhost:5173 in Chrome after the app is ready.\n'
printf 'Keep this window open. Press Control+C to stop the app.\n\n'
npm run dev
