import { mkdirSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { dirname, resolve } from 'node:path';
import { applyMigrations, openDatabase } from '@ligo/db';
import { createLocalEvidenceStore } from './assets/evidence-store.ts';
import { createLocalAssetStore } from './assets/store.ts';
import { SCREENSHOT_MAX_BYTES } from './services/results.ts';
import { loadConfig } from './config.ts';
import { Events } from 'discord.js';
import { buttons } from './discord/buttons/index.ts';
import { startClock } from './discord/clock.ts';
import { createDiscordClient } from './discord/client.ts';
import { commands } from './discord/commands/index.ts';
import { forms } from './discord/forms.ts';
import { createDiscordGateway } from './discord/gateway.ts';
import { DEFAULT_LOCALE } from './i18n/index.ts';
import { loginHint } from './discord/login-hint.ts';
import { createLogger } from './logger.ts';
import { createWebApp, loadStaticFiles } from './web/app.ts';
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
applyMigrations(db);
logger.info({ path: databasePath }, 'Database ready');

const assets = createLocalAssetStore(resolve(config.assetsDir));
const evidence = createLocalEvidenceStore(resolve(config.storageDir), SCREENSHOT_MAX_BYTES, logger);
const publicUrl = new URL(config.web.publicUrl);
const client = createDiscordClient({
  commands,
  buttons,
  forms,
  logger,
  db,
  assets,
  evidence,
  publicUrl,
});
// Calls through the gateway fail until the bot is connected; the website then sees no roles.
const gateway = createDiscordGateway(client);

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
let stopClock: () => void = () => undefined;
client.once(Events.ClientReady, () => {
  stopClock = startClock(
    {
      db,
      gateway,
      logger,
      locale: DEFAULT_LOCALE,
      publicUrl,
      now: () => Date.now(),
    },
    CLOCK_INTERVAL_MS,
  );
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  stopClock();
  server.close();
  void client.destroy().finally(() => {
    db.$client.close();
    process.exit(0);
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

try {
  await client.login(config.discordToken);
} catch (error) {
  logger.fatal({ err: error }, loginHint(error) ?? 'Could not connect to Discord');
  process.exit(1);
}
