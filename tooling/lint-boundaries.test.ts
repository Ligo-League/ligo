import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

// Proves the dependency rules of CLAUDE.md are still wired into eslint.config.js.
// The probe files do not exist on disk, so type-aware rules are switched off here;
// the boundary rules themselves are purely syntactic.
const root = resolve(import.meta.dirname, '..');
const eslint = new ESLint({ cwd: root, overrideConfig: [tseslint.configs.disableTypeChecked] });

async function rulesFiredFor(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: resolve(root, filePath) });
  if (!result) throw new Error(`ESLint returned no result for ${filePath}`);
  const fatal = result.messages.find((message) => message.fatal);
  if (fatal) throw new Error(`ESLint could not parse the probe: ${fatal.message}`);
  return result.messages.map((message) => message.ruleId ?? 'unknown');
}

const IMPORTS = 'no-restricted-imports';

describe.each(['packages/core/src/probe.ts', 'packages/titles/src/r6/probe.ts'])(
  'pure package file %s',
  (file) => {
    it.each([
      [
        'a prefixed Node built-in',
        "import { readFileSync } from 'node:fs';\nexport { readFileSync };",
      ],
      ['a bare Node built-in', "import { join } from 'path';\nexport { join };"],
      [
        'a bare Node built-in subpath',
        "import { readFile } from 'fs/promises';\nexport { readFile };",
      ],
      ['the SQLite driver', "import Database from 'better-sqlite3';\nexport { Database };"],
      [
        'Drizzle',
        "import { sqliteTable } from 'drizzle-orm/sqlite-core';\nexport { sqliteTable };",
      ],
      ['Discord', "import { Client } from 'discord.js';\nexport { Client };"],
      ['the database package', "import { schema } from '@ligo/db';\nexport { schema };"],
      [
        'the database package by path',
        "import { schema } from '../../db/src/index.ts';\nexport { schema };",
      ],
      ['an app', "import { main } from '@ligo/server';\nexport { main };"],
      [
        'an app by path',
        "import { main } from '../../../apps/server/src/main.ts';\nexport { main };",
      ],
    ])('cannot import %s', async (_label, code) => {
      expect(await rulesFiredFor(file, code)).toContain(IMPORTS);
    });

    it.each([
      ['Date.now()', 'export const now = Date.now();', 'no-restricted-properties'],
      ['new Date()', 'export const now = new Date();', 'no-restricted-syntax'],
      ['Math.random()', 'export const roll = Math.random();', 'no-restricted-properties'],
      ['fetch', "export const page = fetch('https://example.com');", 'no-restricted-globals'],
      ['process', 'export const token = process.env.DISCORD_TOKEN;', 'no-restricted-globals'],
    ])('cannot use %s', async (_label, code, rule) => {
      expect(await rulesFiredFor(file, code)).toContain(rule);
    });

    it('can import zod, sibling files and a time passed in', async () => {
      const code = [
        "import { z } from 'zod';",
        "import { helper } from './events/helper.ts';",
        'export const at = (now: number) => new Date(now);',
        'export { helper, z };',
      ].join('\n');
      expect(await rulesFiredFor(file, code)).toEqual([]);
    });
  },
);

describe('other packages', () => {
  it.each([
    'packages/db/src/probe.ts',
    'packages/render/src/probe.ts',
    'packages/parsers/src/probe.ts',
  ])('%s cannot import an app or Discord', async (file) => {
    expect(
      await rulesFiredFor(file, "import { main } from '@ligo/server';\nexport { main };"),
    ).toContain(IMPORTS);
    expect(
      await rulesFiredFor(file, "import { Client } from 'discord.js';\nexport { Client };"),
    ).toContain(IMPORTS);
  });

  it('packages/db can use Node and the SQLite driver', async () => {
    const code =
      "import { readFileSync } from 'node:fs';\nimport Database from 'better-sqlite3';\nexport { Database, readFileSync };";
    expect(await rulesFiredFor('packages/db/src/probe.ts', code)).toEqual([]);
  });
});

describe('apps', () => {
  it('apps/worker cannot talk to Discord', async () => {
    const code = "import { Client } from 'discord.js';\nexport { Client };";
    expect(await rulesFiredFor('apps/worker/src/probe.ts', code)).toContain(IMPORTS);
  });

  it('apps/server can talk to Discord', async () => {
    const code = "import { Client } from 'discord.js';\nexport { Client };";
    expect(await rulesFiredFor('apps/server/src/probe.ts', code)).toEqual([]);
  });
});
