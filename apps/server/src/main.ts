import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { applyMigrations, openDatabase } from '@ligo/db';
import { loadConfig } from './config.ts';
import { buttons } from './discord/buttons/index.ts';
import { createDiscordClient } from './discord/client.ts';
import { commands } from './discord/commands/index.ts';
import { forms } from './discord/forms.ts';
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

const client = createDiscordClient({ commands, buttons, forms, logger, db });

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down');
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
