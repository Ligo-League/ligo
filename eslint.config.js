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
  { ignores: ['**/node_modules/', '**/dist/', 'coverage/', 'packages/db/migrations/'] },

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
    files: ['packages/db/**', 'packages/parsers/**', 'packages/render/**'],
    rules: restrictImports({ patterns: [APPS, DISCORD] }),
  },
  { files: ['apps/worker/**'], rules: restrictImports({ patterns: [DISCORD] }) },
);
