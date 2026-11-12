import { z } from 'zod';

const snowflake = z.string().regex(/^\d{17,20}$/);

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: snowflake,
  DISCORD_GUILD_ID: snowflake,
  DATABASE_PATH: z.string().min(1).default('./data/ligo.db'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
});

export interface Config {
  discordToken: string;
  discordClientId: string;
  /** The staging server: slash commands are registered to this guild only. */
  discordGuildId: string;
  /** SQLite file, relative to the directory the server is started from. */
  databasePath: string;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
}

export type ConfigResult = { ok: true; config: Config } | { ok: false; errors: string[] };

/**
 * Reads the configuration from environment variables (see `.env.example`).
 * Errors name the variable and never repeat its value, so a mistyped token cannot end up in logs.
 */
export function loadConfig(env: Record<string, string | undefined>): ConfigResult {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const names = new Set(parsed.error.issues.map((issue) => String(issue.path[0])));
    const errors = [...names].map((name) =>
      env[name] === undefined || env[name] === '' ? `${name} is missing` : `${name} is not valid`,
    );
    return { ok: false, errors };
  }
  return {
    ok: true,
    config: {
      discordToken: parsed.data.DISCORD_TOKEN,
      discordClientId: parsed.data.DISCORD_CLIENT_ID,
      discordGuildId: parsed.data.DISCORD_GUILD_ID,
      databasePath: parsed.data.DATABASE_PATH,
      logLevel: parsed.data.LOG_LEVEL,
    },
  };
}
