import { schema } from '@ligo/db';
import type { ParseOutcome, Parser } from '@ligo/parsers';
import { sha256Hex } from '@ligo/parsers';
import { fakeObjectStore } from '@ligo/storage';
import { normalizeR6 } from '@ligo/titles';
import { describe, expect, it } from 'vitest';
import round from '../../../../packages/titles/src/r6/golden/team-kill.round.json' with { type: 'json' };
import { workerDatabase } from '../testing.ts';
import { verifyReplay } from './verify-replay.ts';

// Raw verification (design doc section 8, trust model 3): the browser's JSON is untrusted until
// the server re-parses the raw file with the same build. Equal → verified; different → mismatch,
// and the server's own reading replaces the browser's, so stitching never uses a forged one.

const VERSION = 'r6-0123456789abcdef';
const RAW = new Uint8Array([0x64, 0x69, 0x73, 0x73, 0x65, 0x63, 0x74, 0x00, 1, 2, 3]);
const KEY = 'replays/1/raw.rec';

function fakeParser(outcome: ParseOutcome = { ok: true, json: JSON.stringify(round) }): Parser {
  return {
    title: 'r6',
    version: VERSION,
    accepts: () => true,
    parse: () => Promise.resolve(outcome),
    close: () => Promise.resolve(),
  };
}

async function setup(options: { parsed?: Record<string, unknown>; version?: string } = {}) {
  const { db, matchId, uploaderId } = workerDatabase();
  const sha256 = await sha256Hex(RAW);
  const unit = normalizeR6(round, { parser: VERSION, fileSha256: sha256, tradeWindowS: 10 });
  if (!unit.ok) throw new Error(unit.message);
  const objects = fakeObjectStore();
  await objects.put(KEY, RAW, 'application/octet-stream');
  const file = db
    .insert(schema.replayFile)
    .values({
      matchId,
      uploaderPlayerId: uploaderId,
      title: 'r6',
      fileName: 'Match-R04.rec',
      size: RAW.length,
      sha256,
      lobbyId: unit.unit.lobby_id,
      unitNumber: unit.unit.unit.number,
      parserVersion: options.version ?? VERSION,
      parsedJson: options.parsed ?? (unit.unit as unknown as Record<string, unknown>),
      rawStatus: 'stored',
      rawKey: KEY,
      createdAt: 0,
    })
    .returning()
    .get();
  const stored = () =>
    db.select().from(schema.replayFile).get() as typeof schema.replayFile.$inferSelect;
  const jobs = () => db.select().from(schema.job).all();
  return { db, objects, file, unit: unit.unit, stored, jobs };
}

describe('verifyReplay', () => {
  it('marks a file verified when the server reads the same round', async () => {
    const { db, objects, file, stored, jobs } = await setup();
    await verifyReplay({ db, objects, parser: fakeParser(), now: () => 5 }, { fileId: file.id });
    expect(stored().verified).toBe('verified');
    expect(jobs()).toEqual([]);
  });

  it('marks a forged reading a mismatch, keeps the server’s, and stitches again', async () => {
    const { db, objects, file, unit, stored, jobs } = await setup({
      parsed: { ...setupUnitWithMoreKills() },
    });
    await verifyReplay({ db, objects, parser: fakeParser(), now: () => 5 }, { fileId: file.id });
    expect(stored().verified).toBe('mismatch');
    expect(stored().parsedJson).toEqual(unit);
    expect(jobs()).toEqual([
      expect.objectContaining({ kind: 'stitch_game', payloadJson: { matchId: file.matchId } }),
    ]);
  });

  it('marks a mismatch without parsing when the raw file is not the one hashed', async () => {
    const { db, objects, file, stored } = await setup();
    await objects.put(KEY, new Uint8Array([9, 9, 9]), 'application/octet-stream');
    let parsed = false;
    const parser = {
      ...fakeParser(),
      parse: () => (
        (parsed = true),
        Promise.resolve({ ok: true, json: '{}' }) as Promise<ParseOutcome>
      ),
    };
    await verifyReplay({ db, objects, parser, now: () => 5 }, { fileId: file.id });
    expect(stored().verified).toBe('mismatch');
    expect(parsed).toBe(false);
  });

  it('takes the server’s reading as verified when the browser ran an older build', async () => {
    const { db, objects, file, unit, stored, jobs } = await setup({
      version: 'r6-ffffffffffffffff',
    });
    await verifyReplay({ db, objects, parser: fakeParser(), now: () => 5 }, { fileId: file.id });
    expect(stored()).toMatchObject({ verified: 'verified', parserVersion: VERSION });
    expect(stored().parsedJson).toEqual(unit);
    expect(jobs()).toHaveLength(1);
  });

  it('calls a file the parser refuses a mismatch: the browser said it read it', async () => {
    const { db, objects, file, stored } = await setup();
    const parser = fakeParser({ ok: false, error: 'parse_failed', message: 'bad header' });
    await verifyReplay({ db, objects, parser, now: () => 5 }, { fileId: file.id });
    expect(stored().verified).toBe('mismatch');
  });

  it('tries again later when the raw file is not there yet, or the parser was stopped', async () => {
    const { db, objects, file } = await setup();
    const stopped = fakeParser({ ok: false, error: 'timeout', message: 'Parse took too long' });
    await expect(
      verifyReplay({ db, objects, parser: stopped, now: () => 5 }, { fileId: file.id }),
    ).rejects.toThrow('timeout');
    db.update(schema.replayFile).set({ rawStatus: 'uploading', rawKey: null }).run();
    await expect(
      verifyReplay({ db, objects, parser: fakeParser(), now: () => 5 }, { fileId: file.id }),
    ).rejects.toThrow('not stored yet');
  });

  it('has nothing to do for a file that is gone, or a payload without one', async () => {
    const { db, objects } = await setup();
    const deps = { db, objects, parser: fakeParser(), now: () => 5 };
    await expect(verifyReplay(deps, { fileId: 999 })).resolves.toBeUndefined();
    await expect(verifyReplay(deps, {})).rejects.toThrow('fileId');
  });
});

/** The golden round's unit with one kill more for its first player: a forged upload. */
function setupUnitWithMoreKills(): Record<string, unknown> {
  const unit = normalizeR6(round, { parser: VERSION, fileSha256: '', tradeWindowS: 10 });
  if (!unit.ok) throw new Error(unit.message);
  const [first, ...rest] = unit.unit.players;
  if (!first) throw new Error('no player');
  return {
    ...unit.unit,
    players: [{ ...first, stats: { ...first.stats, kills: first.stats.kills + 1 } }, ...rest],
  };
}
