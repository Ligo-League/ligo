#!/usr/bin/env bash
# Copies the files Litestream does not cover to R2 (design doc section 13): the stored
# screenshots, the prepared logos and the database copies taken before migrations. Run each
# night by the ligo-backup-files timer (deploy/setup-vps.sh); safe to run by hand.
#
# `rclone copy`, never `sync`: a file deleted or damaged on the VPS is never removed from R2.
set -euo pipefail
cd "$(dirname "$0")"

copy() {
  local from="$1" to="$2"
  # A folder that does not exist yet (no screenshot stored so far) is not an error.
  docker compose run --rm --no-deps --entrypoint sh files -c \
    "[ ! -d '/data/$from' ] || rclone copy --checksum '/data/$from' \"r2:\$R2_BUCKET/$to\""
}

copy storage backups/files/storage
copy assets backups/files/assets
copy backups backups/files/before-migrations
echo "Files copied to R2 at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
