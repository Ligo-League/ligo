import { loadConfig } from './config.ts';
import { createDiscordClient } from './discord/client.ts';
import { commands } from './discord/commands/index.ts';
import { createLogger } from './logger.ts';

// Server entry point (`pnpm dev`). Phase 0: the Discord bot only.
const loaded = loadConfig(process.env);
if (!loaded.ok) {
  console.error(`Invalid configuration: ${loaded.errors.join('; ')}. See .env.example.`);
  process.exit(1);
}
const { config } = loaded;

const logger = createLogger(config.logLevel);
const client = createDiscordClient({ commands, logger });

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  void client.destroy().finally(() => process.exit(0));
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

const LOGIN_HINTS: Record<string, string> = {
  DisallowedIntents:
    'Discord refused the Guild Members intent. Enable "Server Members Intent" for the bot in the Developer Portal (docs/setup.md).',
  TokenInvalid: 'Discord refused DISCORD_TOKEN. Copy a fresh bot token into .env (docs/setup.md).',
};

try {
  await client.login(config.discordToken);
} catch (error) {
  const code = error instanceof Error && 'code' in error ? String(error.code) : '';
  logger.fatal({ err: error }, LOGIN_HINTS[code] ?? 'Could not connect to Discord');
  process.exit(1);
}
