import { defineConfig } from 'vitest/config';

// One project per workspace package, so `pnpm test:core` can run the pure league logic alone.
const project = (name: string, dir: string) => ({
  test: { name, include: [`${dir}/**/*.test.ts`] },
});

export default defineConfig({
  test: {
    projects: [
      project('tooling', 'tooling'),
      project('core', 'packages/core/src'),
      project('titles', 'packages/titles/src'),
      project('db', 'packages/db/src'),
      project('render', 'packages/render/src'),
      project('server', 'apps/server/src'),
    ],
  },
});
