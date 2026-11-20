# deploy

How Ligo runs on the VPS (design document, section 13; the steps are in `docs/setup.md`).

| File                | What it does                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `compose.yml`       | Caddy, the server (built from the repository's `Dockerfile`) and Litestream                 |
| `Caddyfile`         | HTTPS for `ligoleague.eu`, `www` redirected to it, HSTS, proxy to the server                |
| `litestream.yml`    | Copies the database to R2 (`backups/db`) continuously, one full copy a night, kept 30 days  |
| `.env.example`      | The values `deploy/.env` holds on the VPS: Discord, the session secret, R2. Never committed |
| `setup-vps.sh`      | Once, as root: Docker, the `ligo` user, firewall, SSH by key only, the nightly backup timer |
| `update.sh`         | Deploys GitHub's `main`: pull, build the image on the VPS, restart, wait for `/healthz`     |
| `backup-storage.sh` | Each night: screenshots, logos and the copies before migrations to R2 (`backups/files`)     |
| `restore.sh`        | A new VPS from R2 (never over a database), or `--rehearse` to check R2's copy               |

The database, its copies before migrations, the prepared logos and the stored screenshots live
in `/srv/ligo/data` on the VPS (`DATA_DIR`), owned by user 1000, the containers' user.
