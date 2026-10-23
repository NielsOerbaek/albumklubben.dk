#!/usr/bin/env bash
# Usage: ops/deploy.sh <commit>   Deploys a commit of this repo into the live worktree.
set -euo pipefail
LIVE=/home/theta/albumklubben-live
[ $# -eq 1 ] || { echo "usage: $0 <commit>" >&2; exit 1; }
cd "$LIVE"
git checkout --detach "$1"
CI=true pnpm install --frozen-lockfile --prefer-offline
pnpm build
systemctl --user restart albumklubben
PORT=$(grep -m1 '^PORT=' .env | cut -d= -f2-)
for _ in $(seq 1 20); do
  if curl -fs "127.0.0.1:${PORT:-3600}/api/archive" | head -c 12 | grep -q '{"meetings":'; then
    echo "deployed $(git rev-parse --short HEAD)"; exit 0
  fi
  sleep 1
done
echo "deploy failed: /api/archive does not answer" >&2; exit 1
