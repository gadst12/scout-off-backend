#!/usr/bin/env bash
# Deploy ScoutOff backend on the staging server.
# Invoked remotely by .github/workflows/deploy-staging.yml after the release
# tarball is uploaded and extracted.
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"

echo "Installing production dependencies..."
npm ci --omit=dev

echo "Building TypeScript..."
npm run build

echo "Restarting application..."
if systemctl list-units --full -all 2>/dev/null | grep -Fq 'scout-off-backend.service'; then
  sudo systemctl restart scout-off-backend
elif command -v pm2 >/dev/null 2>&1; then
  pm2 restart scout-off-backend 2>/dev/null || pm2 start dist/index.js --name scout-off-backend
else
  echo "No systemd unit or pm2 process found for scout-off-backend"
  exit 1
fi

echo "Staging deploy complete"
