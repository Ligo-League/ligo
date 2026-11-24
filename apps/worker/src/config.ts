import type { R2Settings } from '@ligo/storage';
import { z } from 'zod';

// The worker's settings, from environment variables (design doc section 13). Errors name the
// variable and never repeat its value, so a secret cannot end up in the logs.

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const R2_NAMES = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
] as const;

const envSchema = z
  .object({
    DATABASE_PATH: z.string().min(1).default('./data/ligo.db'),
    STORAGE_DIR: z.string().min(1).default('./data/storage'),
    // The R6 parser build (parsers/build-r6.sh); /app/parsers/dist in the image.
    PARSERS_DIR: z.string().min(1).default('./parsers/dist'),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),
    R2_ACCOUNT_ID: optional(z.string().regex(/^[0-9a-zA-Z]+$/)),
    R2_ACCESS_KEY_ID: optional(z.string().min(1)),
    R2_SECRET_ACCESS_KEY: optional(z.string().min(1)),
    R2_BUCKET: optional(z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/)),
    R2_ENDPOINT: optional(z.url({ protocol: /^https$/ })),
  })
  .superRefine((env, context) => {
    const set = R2_NAMES.filter((name) => env[name] !== undefined);
    if (set.length === 0 || set.length === R2_NAMES.length) return;
    for (const name of R2_NAMES.filter((name) => env[name] === undefined)) {
      context.addIssue({ code: 'custom', path: [name], message: 'needed for R2' });
    }
  });

export interface WorkerConfig {
  databasePath: string;
  storageDir: string;
  parsersDir: string;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  r2: R2Settings | null;
}

export function loadWorkerConfig(
  env: Record<string, string | undefined>,
): { ok: true; config: WorkerConfig } | { ok: false; errors: string[] } {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const names = new Set(parsed.error.issues.map((issue) => String(issue.path[0])));
    const errors = [...names].map((name) =>
      env[name] === undefined || env[name] === '' ? `${name} is missing` : `${name} is not valid`,
    );
    return { ok: false, errors };
  }
  const d = parsed.data;
  return {
    ok: true,
    config: {
      databasePath: d.DATABASE_PATH,
      storageDir: d.STORAGE_DIR,
      parsersDir: d.PARSERS_DIR,
      logLevel: d.LOG_LEVEL,
      r2:
        d.R2_ACCOUNT_ID && d.R2_ACCESS_KEY_ID && d.R2_SECRET_ACCESS_KEY && d.R2_BUCKET
          ? {
              accountId: d.R2_ACCOUNT_ID,
              accessKeyId: d.R2_ACCESS_KEY_ID,
              secretAccessKey: d.R2_SECRET_ACCESS_KEY,
              bucket: d.R2_BUCKET,
              endpoint: d.R2_ENDPOINT ?? null,
            }
          : null,
    },
  };
}
