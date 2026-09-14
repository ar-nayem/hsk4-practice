#!/usr/bin/env bash
# Rebuild the app from data/ + src/, push the server to the VPS, restart it.
# Live at https://hsk.arnayem.top — nginx proxies to pm2 process "hsk4" (Node 24 via nvm) on port 7800.
# The server's data.db (accounts + history) and .env (JWT secret) are never touched by this script.
set -e
cd "$(dirname "$0")"
python3 build.py

if [ -z "$SSHPASS" ]; then
  echo "SSHPASS is not set — export the VPS root password before running this script" >&2
  exit 1
fi
export SSHPASS
export PATH="/opt/homebrew/bin:$PATH"
HOST=root@45.76.15.203
# While the AmneziaWG VPN is on, the server's public IP is unreachable from this Mac; use its tunnel address.
if ! nc -z -G 5 45.76.15.203 22 2>/dev/null && nc -z -G 5 10.66.67.1 22 2>/dev/null; then HOST=root@10.66.67.1; fi
SSH="ssh -o StrictHostKeyChecking=no"

sshpass -e rsync -az --no-owner --no-group -e "$SSH" \
  --exclude node_modules --exclude 'data.db*' --exclude .env \
  server/ "$HOST:/var/www/hsk4-server/"

sshpass -e $SSH "$HOST" '
  set -e
  cd /var/www/hsk4-server
  export NVM_DIR=/root/.nvm; . "$NVM_DIR/nvm.sh" >/dev/null; nvm use 24 >/dev/null
  npm ci --omit=dev --no-audit --no-fund >/dev/null
  pm2 restart hsk4 >/dev/null
  curl -sf --retry 10 --retry-connrefused --retry-delay 1 -o /dev/null http://127.0.0.1:7800/api/auth/me && echo "app healthy"
'
echo "deployed to https://hsk.arnayem.top"
