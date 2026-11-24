import { builtinModules } from 'node:module';
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Dependency rules from CLAUDE.md ("Dependency rules (enforced in review)").
// `no-restricted-imports` options replace each other between config blocks instead of merging,
// so every folder gets its complete list from the helpers below.

const APPS = {
  regex: '^@ligo/(server|worker)(/|$)|(^|/)apps/',
  message: 'Apps depend on packages; packages never import apps.',
};

const DISCORD = {
  regex: '^(discord\\.js|@discordjs/.+|discord-api-types)(/|$)',
  message: 'Only apps/server talks to Discord.',
};

const IO_MESSAGE =
  'packages/core and packages/titles are pure: no database, Discord, network or filesystem.';

const IO = [
  { regex: '^node:', message: IO_MESSAGE },
  { regex: '^(better-sqlite3|drizzle-orm|hono|pino|@aws-sdk/.+)(/|$)', message: IO_MESSAGE },
  // By package name, or by a relative path climbing into a sibling package.
  {
    regex: '^@ligo/(db|parsers|render)(/|$)|(^|/)(packages|\\.\\.)/(db|parsers|render)/',
    message: IO_MESSAGE,
  },
];

// Bare built-in names ("fs", "fs/promises"), matched exactly so a local "./events.ts" stays legal.
const NODE_BUILTIN_PATHS = builtinModules.map((name) => ({ name, message: IO_MESSAGE }));

// Code the replay uploader bundles for the browser (titles, parsers, uploader): zod's named `z`
// export keeps every locale in the bundle (about 300 KB); the namespace import lets esbuild drop
// them.
const ZOD_NAMESPACE = {
  selector: "ImportDeclaration[source.value='zod'] > ImportSpecifier[imported.name='z']",
  message: "Bundled for the browser: use `import * as z from 'zod'`.",
};

const restrictImports = ({ patterns, paths = [] }) => ({
  'no-restricted-imports': ['error', { paths, patterns }],
});

const PURE_RULES = {
  ...restrictImports({ patterns: [...IO, APPS, DISCORD], paths: NODE_BUILTIN_PATHS }),
  'no-restricted-globals': [
    'error',
    { name: 'fetch', message: IO_MESSAGE },
    { name: 'process', message: IO_MESSAGE },
  ],
  'no-restricted-properties': [
    'error',
    { object: 'Date', property: 'now', message: 'Pass the current time in as a parameter.' },
    {
      object: 'Math',
      property: 'random',
      message: 'Take a seed or a random source as a parameter; results must be reproducible.',
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message: 'Pass the current time in as a parameter.',
    },
  ],
};

export default defineConfig(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      'coverage/',
      'packages/db/migrations/',
      // Claude Code's worktrees: other checkouts of this repository.
      '.claude/',
      // Static design mockups with their own tooling (design-proposals/README.md), not app code.
      'design-proposals/',
      // The r6-dissect fork (a submodule, Go) and the real replays the golden tests read.
      'parsers/r6/',
      'fixtures/replays/',
    ],
  },

  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  // Plain JS config files are not part of any tsconfig project.
  { files: ['**/*.js'], extends: [tseslint.configs.disableTypeChecked] },

  { files: ['packages/core/**', 'packages/titles/**'], rules: PURE_RULES },
  {
    files: ['packages/titles/**'],
    rules: {
      'no-restricted-syntax': [...PURE_RULES['no-restricted-syntax'], ZOD_NAMESPACE],
    },
  },
  {
    files: ['packages/db/**', 'packages/render/**'],
    rules: restrictImports({ patterns: [APPS, DISCORD] }),
  },
  {
    files: ['packages/parsers/**', 'packages/uploader/**'],
    rules: {
      ...restrictImports({ patterns: [APPS, DISCORD] }),
      'no-restricted-syntax': ['error', ZOD_NAMESPACE],
    },
  },
  { files: ['apps/worker/**'], rules: restrictImports({ patterns: [DISCORD] }) },
);
