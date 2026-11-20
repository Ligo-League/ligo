#!/usr/bin/env bash
# Brings Ligo back from R2 (design doc section 13): the database from Litestream's copy, then
# the files deploy/backup-storage.sh copied. Run as the ligo user, after deploy/setup-vps.sh,
# the clone into /opt/ligo and deploy/.env.
#
#   deploy/restore.sh             a VPS with no database yet: restore it, then start Ligo
#   deploy/restore.sh --rehearse  restore to a new folder beside the live data and check it;
#                                 the running Ligo and its database are not touched
#
# It never overwrites a database: if one is there, it stops and says so.
set -euo pipefail
cd "$(dirname "$0")"

mode=${1:-}
if [ -n "$mode" ] && [ "$mode" != "--rehearse" ]; then
  echo "usage: deploy/restore.sh [--rehearse]" >&2
  exit 2
fi
if [ ! -f .env ]; then
  echo "deploy/.env is missing: copy deploy/.env.example and fill it in (docs/setup.md)." >&2
  exit 1
fi

# Inside the containers the data folder is /data (DATA_DIR on the VPS).
in_data() { docker compose run --rm --no-deps --entrypoint sh files -c "$1"; }

# Opens the restored copy with the server's own SQLite and reads it whole.
check() {
  docker compose run --rm --no-deps -w /app/packages/db server node -e "
    const db = new (require('better-sqlite3'))(process.argv[1], { readonly: true });
    const ok = db.pragma('integrity_check', { simple: true });
    const count = (t) => db.prepare('select count(*) as n from ' + t).get().n;
    console.log('integrity: ' + ok + '; ' + count('team') + ' teams, ' + count('match') + ' matches, ' + count('player') + ' players');
    process.exit(ok === 'ok' ? 0 : 1);
  " "$1"
}

if [ "$mode" = "--rehearse" ]; then
  target="/data/rehearsal-$(date -u +%Y%m%dT%H%M%SZ)"
  in_data "mkdir -p '$target'"
  docker compose run --rm --no-deps litestream restore -o "$target/ligo.db" /data/ligo.db
  check "$target/ligo.db"
  in_data "for d in storage assets; do rclone copy --checksum \"r2:\$R2_BUCKET/backups/files/\$d\" '$target/'\$d; done; du -sh '$target'/*"
  echo "Rehearsal done in $target (DATA_DIR on the VPS). Delete that folder when you are done with it."
  exit 0
fi

if ! in_data "[ ! -e /data/ligo.db ]"; then
  echo "A database is already in DATA_DIR: nothing was restored. Move it away yourself first if" >&2
  echo "you really mean to replace it, or use --rehearse to check the copy on R2." >&2
  exit 1
fi
docker compose stop server litestream 2>/dev/null || true
docker compose run --rm --no-deps litestream restore /data/ligo.db
check /data/ligo.db
in_data "for d in storage assets; do rclone copy --checksum \"r2:\$R2_BUCKET/backups/files/\$d\" /data/\$d; done"
docker compose up -d
echo "Restored. Ligo is starting: deploy/update.sh's checks, or docker compose logs -f server."
