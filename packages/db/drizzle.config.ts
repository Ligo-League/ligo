import { defineConfig } from 'drizzle-kit';

// Used by `pnpm db:generate` only. Migrations are applied by src/migrate.ts, not by drizzle-kit.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema/index.ts',
  out: './migrations',
});
