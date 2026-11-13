import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { applyMigrations, openDatabase } from '@ligo/db';
import { createLocalAssetStore } from './assets/store.ts';
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

// Server entry point (`pnpm dev`): the database and the Discord bot.
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
const client = createDiscordClient({ commands, buttons, forms, logger, db, assets });

// Deadlines need the bot to post, so the clock starts once Discord is ready.
const CLOCK_INTERVAL_MS = 60_000;
let stopClock: () => void = () => undefined;
client.once(Events.ClientReady, () => {
  stopClock = startClock(
    {
      db,
      gateway: createDiscordGateway(client),
      logger,
      locale: DEFAULT_LOCALE,
      now: () => Date.now(),
    },
    CLOCK_INTERVAL_MS,
  );
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  stopClock();
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
