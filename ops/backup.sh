#!/usr/bin/env bash
# Nightly backup: SQLite online backup + hard-linked uploads. Keeps the newest 14 days.
set -euo pipefail
LIVE=$HOME/albumklubben-live
NODE=/usr/bin/node  # same node as the service
DEST=$HOME/albumklubben-backups
env_get() { grep -m1 "^$1=" "$LIVE/.env" | cut -d= -f2-; }
DB_PATH=$(env_get DB_PATH); UPLOAD_DIR=$(env_get UPLOAD_DIR)
[ -n "$DB_PATH" ] && [ -n "$UPLOAD_DIR" ] || { echo "DB_PATH/UPLOAD_DIR missing in $LIVE/.env" >&2; exit 1; }
umask 077
mkdir -p "$DEST"; chmod 700 "$DEST"
DAY=$(date +%F)
prev=$(find "$DEST" -mindepth 1 -maxdepth 1 -type d -name '????-??-??' ! -name "$DAY" | sort | tail -n1)
mkdir -p "$DEST/$DAY"
cd "$LIVE"
"$NODE" -e '
const Database = require("better-sqlite3");
const db = new Database(process.argv[1], { readonly: true });
db.backup(process.argv[2]).then(() => db.close()).catch((e) => { console.error(e); process.exit(1); });
' "$DB_PATH" "$DEST/$DAY/albumklubben.sqlite"
link=()
[ -n "$prev" ] && [ -d "$prev/uploads" ] && link=(--link-dest="$prev/uploads")
rsync -a --delete "${link[@]}" "$UPLOAD_DIR"/ "$DEST/$DAY/uploads/"
find "$DEST" -mindepth 1 -maxdepth 1 -type d -name '????-??-??' | sort | head -n -14 | xargs -r rm -rf
echo "backup ok: $DEST/$DAY"
