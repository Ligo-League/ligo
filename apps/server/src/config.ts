import { z } from 'zod';

const snowflake = z.string().regex(/^\d{17,20}$/);
// A variable left empty in .env is not set.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
const httpUrl = z.url({ protocol: /^https?$/ });

const envSchema = z
  .object({
    DISCORD_TOKEN: z.string().min(1),
    DISCORD_CLIENT_ID: snowflake,
    DISCORD_GUILD_ID: snowflake,
    DATABASE_PATH: z.string().min(1).default('./data/ligo.db'),
    ASSETS_DIR: z.string().min(1).default('./data/assets/render'),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),
    // Localhost only until the VPS: a container sets 0.0.0.0 behind Caddy.
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    // Website login (phase 3b). Both secrets, or neither: without them the site has no login.
    DISCORD_CLIENT_SECRET: optional(z.string().min(16)),
    SESSION_SECRET: optional(z.string().min(32)),
    // The address people type; Discord sends them back to its /auth/callback.
    PUBLIC_URL: httpUrl.default('http://localhost:3000'),
  })
  .superRefine((env, context) => {
    if ((env.DISCORD_CLIENT_SECRET === undefined) === (env.SESSION_SECRET === undefined)) return;
    const missing =
      env.DISCORD_CLIENT_SECRET === undefined ? 'DISCORD_CLIENT_SECRET' : 'SESSION_SECRET';
    context.addIssue({ code: 'custom', path: [missing], message: 'needed for login' });
  });

export interface Config {
  discordToken: string;
  discordClientId: string;
  /** The staging server: slash commands are registered to this guild only. */
  discordGuildId: string;
  /** SQLite file, relative to the directory the server is started from. */
  databasePath: string;
  /** Prepared images such as team logos (`pnpm assets:logos`), until they move to R2. */
  assetsDir: string;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  /** Where the website listens, and its login when both secrets are set. */
  web: {
    host: string;
    port: number;
    publicUrl: string;
    login: { clientSecret: string; sessionSecret: string } | null;
  };
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
      assetsDir: parsed.data.ASSETS_DIR,
      logLevel: parsed.data.LOG_LEVEL,
      web: {
        host: parsed.data.HOST,
        port: parsed.data.PORT,
        publicUrl: parsed.data.PUBLIC_URL,
        login:
          parsed.data.DISCORD_CLIENT_SECRET && parsed.data.SESSION_SECRET
            ? {
                clientSecret: parsed.data.DISCORD_CLIENT_SECRET,
                sessionSecret: parsed.data.SESSION_SECRET,
              }
            : null,
      },
    },
  };
}
