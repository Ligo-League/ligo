import { loadConfig } from './config.ts';
import { createDiscordClient } from './discord/client.ts';
import { commands } from './discord/commands/index.ts';
import { loginHint } from './discord/login-hint.ts';
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

try {
  await client.login(config.discordToken);
} catch (error) {
  logger.fatal({ err: error }, loginHint(error) ?? 'Could not connect to Discord');
  process.exit(1);
}
