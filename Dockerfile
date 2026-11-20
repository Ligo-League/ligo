# Ligo's server: the Discord bot and the website in one process (design doc section 13). Built on
# the VPS by deploy/update.sh, for its own processor (ARM or x86). Node runs the TypeScript
# sources directly, with no build step; better-sqlite3 and resvg ship their binaries for Linux
# x64 and ARM64, so no compiler is needed either.

# Exact versions: an update is a change made on purpose.
ARG NODE_IMAGE=node:26.13.1-bookworm-slim

FROM ${NODE_IMAGE} AS install
WORKDIR /app
# Node 25 and later no longer ship corepack: install the pnpm package.json names.
RUN npm install --global --no-fund --no-audit pnpm@12.19.0
# Every workspace manifest, so the lockfile matches, then the server's production dependencies.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/parsers/package.json packages/parsers/
COPY packages/render/package.json packages/render/
COPY packages/titles/package.json packages/titles/
RUN pnpm install --frozen-lockfile --prod --filter @ligo/server...
# The sources, the migrations, the fonts and the seed's fixtures (.dockerignore keeps the rest out).
COPY apps/server/src apps/server/src
COPY packages packages
COPY fixtures fixtures

FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/ligo.db \
    ASSETS_DIR=/data/assets/render \
    STORAGE_DIR=/data/storage
WORKDIR /app
COPY --from=install /app /app
# The database, its backups, the prepared logos and the stored screenshots live in /data, a
# volume the unprivileged `node` user owns.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/server/src/main.ts"]
