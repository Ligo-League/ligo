import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadNodeParser } from './index.ts';

// The real parser in a Node worker thread, on a real round. It needs `pnpm parsers:build` and
// `pnpm fixtures:replays`; without them these tests are skipped, never failed.

const ROOT = resolve(import.meta.dirname, '../../../..');
const DIST = join(ROOT, 'parsers/dist');
const SLC = join(ROOT, 'fixtures/replays/slc');
const built = existsSync(join(DIST, 'r6.json'));

/** The first round of the first lobby of the Salt Lake City set, if it is there. */
function firstRound(): Uint8Array | null {
  if (!existsSync(SLC)) return null;
  const file = readdirSync(SLC, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('-R01.rec'))
    .sort()[0];
  return file ? new Uint8Array(readFileSync(join(SLC, file))) : null;
}

describe('loadNodeParser', () => {
  it('says when the folder holds no build', async () => {
    expect(await loadNodeParser({ distDir: mkdtempSync(join(tmpdir(), 'ligo-')) })).toEqual({
      ok: false,
      error: 'no_build',
    });
  });

  it.skipIf(!built)('refuses a round the parser cannot read, in a worker thread', async () => {
    const loaded = await loadNodeParser({ distDir: DIST });
    if (!loaded.ok) throw new Error(loaded.error);
    const header = [0x64, 0x69, 0x73, 0x73, 0x65, 0x63, 0x74, 0x00];
    const outcome = await loaded.parser.parse(new Uint8Array([...header, 1, 2, 3, 4]));
    await loaded.parser.close();
    expect(outcome).toMatchObject({ ok: false, error: 'parse_failed' });
  });

  const bytes = built ? firstRound() : null;
  it.skipIf(bytes === null)(
    'parses a real round, stops one past its time, then parses again',
    async () => {
      if (!bytes) return;
      const loaded = await loadNodeParser({ distDir: DIST });
      if (!loaded.ok) throw new Error(loaded.error);
      const { parser } = loaded;
      const outcome = await parser.parse(bytes);
      if (!outcome.ok) throw new Error(outcome.message);
      const round = JSON.parse(outcome.json) as { roundNumber: number; matchFeedback: unknown[] };
      expect(round.roundNumber).toBe(0);
      expect(round.matchFeedback.length).toBeGreaterThan(0);
      await parser.close();

      const hurried = await loadNodeParser({ distDir: DIST, timeoutMs: 1 });
      if (!hurried.ok) throw new Error(hurried.error);
      expect(await hurried.parser.parse(bytes)).toMatchObject({ ok: false, error: 'timeout' });
      await hurried.parser.close();
    },
    60_000,
  );
});
