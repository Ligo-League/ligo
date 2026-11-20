# deploy

How Ligo runs on the VPS (design document, section 13; the steps are in `docs/setup.md`).

| File             | What it does                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `compose.yml`    | Caddy, the server (built from the repository's `Dockerfile`) and Litestream                 |
| `Caddyfile`      | HTTPS for `ligoleague.eu`, `www` redirected to it, HSTS, proxy to the server                |
| `litestream.yml` | Copies the database to R2 (`backups/db`) continuously, one full copy a night, kept 30 days  |
| `.env.example`   | The values `deploy/.env` holds on the VPS: Discord, the session secret, R2. Never committed |

The database, its copies before migrations, the prepared logos and the stored screenshots live
in `/srv/ligo/data` on the VPS (`DATA_DIR`), owned by user 1000, the containers' user.
