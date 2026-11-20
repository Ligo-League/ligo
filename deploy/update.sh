#!/usr/bin/env bash
# Deploys what is on GitHub's main (design doc section 13): pulls it, builds the server image on
# the VPS and restarts what changed. The server copies the database and applies new migrations
# as it starts. Run on the VPS as the ligo user: `/opt/ligo/deploy/update.sh`.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f deploy/.env ]; then
  echo "deploy/.env is missing: copy deploy/.env.example and fill it in (docs/setup.md)." >&2
  exit 1
fi
# Changes made by hand on the VPS would be overwritten or block the pull: stop instead.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "The checkout has local changes; nothing was deployed:" >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

before=$(git rev-parse --short HEAD)
git pull --ff-only origin main
after=$(git rev-parse --short HEAD)
echo "main: $before -> $after"

cd deploy
docker compose build --pull server
docker compose up -d --remove-orphans
# Old server images are no longer needed once the new one runs.
docker image prune -f >/dev/null

echo "Waiting for the server to answer /healthz..."
for _ in $(seq 1 30); do
  if docker compose exec -T server node -e "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" 2>/dev/null; then
    echo "Deployed $after: the database and Discord answer."
    exit 0
  fi
  sleep 2
done
echo "The server does not answer /healthz after 60 s. Its last logs:" >&2
docker compose logs --tail 30 server >&2
exit 1
