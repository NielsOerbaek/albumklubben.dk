#!/usr/bin/env bash
# Usage: ops/deploy.sh <commit>   Deploys a commit of this repo into the live worktree.
# A failed install or build leaves the live site as it was: the old commit stays checked out,
# dist/ is untouched (the build goes to dist.new and is swapped in only on success) and the
# service is not restarted.
set -euo pipefail
LIVE=/home/theta/albumklubben-live

install_deps() { CI=true pnpm install --frozen-lockfile --prefer-offline; }

healthy() {
  local port; port=$(grep -m1 '^PORT=' .env | cut -d= -f2-)
  for _ in $(seq 1 20); do
    local body; body=$(curl -fs "127.0.0.1:${port:-3600}/api/archive" 2>/dev/null) || body=
    [[ "$body" == '{"meetings":'* ]] && return 0
    sleep 1
  done
  return 1
}

rollback() {
  echo "deploy of $1 failed, back to $PREV" >&2
  git checkout --detach --force "$PREV"
  install_deps || true
  rm -rf dist.new
  if [ -d dist.old ]; then rm -rf dist; mv dist.old dist; systemctl --user restart albumklubben; fi
  exit 1
}

# Everything lives in a function: the checkout below rewrites this very file while bash runs it.
main() {
  [ $# -eq 1 ] || { echo "usage: $0 <commit>" >&2; exit 1; }
  cd "$LIVE"
  PREV=$(git rev-parse HEAD)
  rm -rf dist.new dist.old
  git checkout --detach "$1" || { echo "checkout failed" >&2; exit 1; }
  { install_deps && pnpm exec vite build --outDir "$LIVE/dist.new"; } || rollback "$1"
  mv dist dist.old; mv dist.new dist
  systemctl --user restart albumklubben
  healthy || rollback "$1"
  rm -rf dist.old
  echo "deployed $(git rev-parse --short HEAD)"
}
main "$@"
exit
