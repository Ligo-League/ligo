import { mkdirSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { dirname, resolve } from 'node:path';
import { applyMigrations, backupFolder, openDatabase } from '@ligo/db';
import { createEvidenceStore } from './assets/evidence-store.ts';
import { createDiskObjectStore, createR2ObjectStore, withReadFallback } from '@ligo/storage';
import { createTranscriptStore } from './assets/transcript-store.ts';
import { createLocalAssetStore } from './assets/store.ts';
import { SCREENSHOT_MAX_BYTES } from './services/results.ts';
import { loadConfig } from './config.ts';
import { Events } from 'discord.js';
import { buttons } from './discord/buttons/index.ts';
import { startClock } from './discord/clock.ts';
import { startReconciler } from './discord/reconciler-clock.ts';
import { createDiscordClient } from './discord/client.ts';
import { commands } from './discord/commands/index.ts';
import { forms } from './discord/forms.ts';
import { createDiscordGateway } from './discord/gateway.ts';
import { DEFAULT_LOCALE } from './i18n/index.ts';
import { keepConnecting } from './discord/connect.ts';
import { loginHint } from './discord/login-hint.ts';
import { createLogger } from './logger.ts';
import { createWebApp, loadStaticFiles } from './web/app.ts';
import { buildUploader } from './web/uploader-bundle.ts';
import { createDiscordOAuth } from './web/oauth.ts';
import { createRoleReader } from './web/roles.ts';
import { botInstallUrl } from './discord/install.ts';

// Server entry point (`pnpm dev`): the database, the Discord bot and the website.
const loaded = loadConfig(process.env);
if (!loaded.ok) {
  console.error(`Invalid configuration: ${loaded.errors.join('; ')}. See .env.example.`);
  process.exit(1);
}
const { config } = loaded;

const logger = createLogger(config.logLevel);

// The server owns the schema: it applies pending migrations before anything reads the database.
const databasePath = resolve(config.databasePath);
mkdirSync(dirname(databasePath), { recursive: true });
const db = openDatabase(databasePath);
// A copy before any schema change, kept in `backups/` next to the database (design doc section 13).
const { backup } = applyMigrations(db, {
  backup: { dir: backupFolder(databasePath), now: Date.now() },
});
if (backup) logger.info({ backup }, 'Copied the database before migrating');
logger.info({ path: databasePath }, 'Database ready');

const assets = createLocalAssetStore(resolve(config.assetsDir));
const publicUrl = new URL(config.web.publicUrl);
// Files go to R2 when it is set (phase 5); what was kept on disk before is read from there until
// `copy-to-r2.ts` has copied it. Without R2, the disk keeps everything and signs its own uploads.
const disk = createDiskObjectStore(resolve(config.storageDir), {
  upload: config.web.login
    ? { secret: config.web.login.sessionSecret, publicUrl: publicUrl.href }
    : null,
  now: Date.now,
});
const objects = config.r2
  ? withReadFallback(createR2ObjectStore(config.r2, { now: Date.now }), disk)
  : disk;
logger.info({ storage: config.r2 ? 'r2' : 'disk' }, 'Storage ready');
// The replay uploader (design doc section 8): the parser build browsers must use, and the island
// and Web Worker bundled from @ligo/uploader. Without a build, the website refuses replay uploads
// until `pnpm parsers:build`.
const uploader = await buildUploader(resolve(config.parsersDir));
if (!uploader.ok) {
  logger.error({ error: uploader.error }, 'No R6 parser build: replay uploads are off');
}
// The browser sends raw files to R2 directly: its address is let through the page's policy.
const uploadOrigin = config.r2
  ? new URL(config.r2.endpoint ?? `https://${config.r2.accountId}.r2.cloudflarestorage.com`).origin
  : null;
const evidence = createEvidenceStore(objects, SCREENSHOT_MAX_BYTES, logger);
const transcripts = createTranscriptStore(objects);
const newClient = () =>
  createDiscordClient({ commands, buttons, forms, logger, db, assets, evidence, publicUrl });
// Replaced by a new one when a login fails and is tried again (see keepConnecting below).
let client = newClient();
// Calls through the gateway fail until the bot is connected; the website then sees no roles.
const gateway = createDiscordGateway(() => client);

const login = config.web.login && {
  oauth: createDiscordOAuth({
    clientId: config.discordClientId,
    clientSecret: config.web.login.clientSecret,
    redirectUri: new URL('/auth/callback', publicUrl).href,
  }),
  secret: config.web.login.sessionSecret,
  publicUrl,
};
if (!login)
  logger.info('Website login is off: DISCORD_CLIENT_SECRET and SESSION_SECRET are not set');
const web = createWebApp({
  db,
  assets,
  evidence,
  locale: DEFAULT_LOCALE,
  files: await loadStaticFiles(),
  logger,
  login,
  roles: createRoleReader(gateway),
  gateway,
  botInstallUrl: botInstallUrl(config.discordClientId),
  discordReady: () => client.isReady(),
  trustProxy: config.web.trustProxy,
  uploads:
    !config.r2 && config.web.login ? { secret: config.web.login.sessionSecret, store: disk } : null,
  replays: { objects, parserVersion: uploader.ok ? uploader.files.version : null, uploadOrigin },
  uploader: uploader.ok ? uploader.files : null,
  now: () => Date.now(),
});
const server = serve(
  { fetch: web.fetch, hostname: config.web.host, port: config.web.port },
  (info) => {
    const address = login ? publicUrl.origin : `http://${config.web.host}:${String(info.port)}`;
    logger.info({ address }, 'Website ready');
  },
);

// Deadlines need the bot to post, so the clock starts once Discord is ready.
const CLOCK_INTERVAL_MS = 60_000;
let stopClock: (() => void) | null = null;
// The league servers' sync (design doc section 6) also needs the bot connected.
let stopReconciler: (() => void) | null = null;
const startClockOnReady = () => {
  client.once(Events.ClientReady, () => {
    stopClock ??= startClock(
      {
        db,
        gateway,
        logger,
        locale: DEFAULT_LOCALE,
        publicUrl,
        assets,
        objects,
        now: () => Date.now(),
      },
      CLOCK_INTERVAL_MS,
    );
    stopReconciler ??= startReconciler({
      db,
      gateway,
      logger,
      locale: DEFAULT_LOCALE,
      publicUrl,
      transcripts,
      now: () => Date.now(),
    });
  });
};

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  stopClock?.();
  stopReconciler?.();
  server.close();
  void client.destroy().finally(() => {
    db.$client.close();
    process.exit(0);
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

// The website is already up: if Discord cannot be reached, the bot keeps trying in the
// background. A wrong token or a missing intent stops the server, since only .env or the
// Developer Portal can fix them.
let firstAttempt = true;
const connected = await keepConnecting({
  attempt: async () => {
    // A client whose login failed cannot log in again (discord.js marks it destroyed).
    if (!firstAttempt) client = newClient();
    firstAttempt = false;
    startClockOnReady();
    await client.login(config.discordToken);
  },
  hint: loginHint,
  log: logger,
  wait: (ms) => new Promise((done) => setTimeout(done, ms)),
});
if (!connected.ok) {
  logger.fatal({ err: connected.error }, connected.hint);
  process.exit(1);
}
