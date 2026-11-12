import { pino, type Logger } from 'pino';
import type { Config } from './config.ts';

/** Structured JSON logs. Secrets are redacted in case an object holding one is ever logged. */
export function createLogger(level: Config['logLevel']): Logger {
  return pino({
    level,
    redact: {
      paths: [
        'token',
        'discordToken',
        'DISCORD_TOKEN',
        '*.token',
        '*.discordToken',
        '*.DISCORD_TOKEN',
      ],
      censor: '[redacted]',
    },
  });
}
