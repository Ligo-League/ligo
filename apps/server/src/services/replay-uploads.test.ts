import { listLeagueMatches, schema, type Db, type LeagueMatch } from '@ligo/db';
import { addRosterPlayers } from '@ligo/db/testing';
import { fakeObjectStore } from '@ligo/storage';
import { rawRound } from '@ligo/titles/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase } from '../testing.ts';
import {
  markReplaysStored,
  rawReplayKey,
  replayMatch,
  replaySides,
  signReplayUploads,
  submitReplays,
} from './replay-uploads.ts';

// Replay uploads (design doc section 8, upload flow 4 and 5): the server reads each round with
// its own normaliser, keeps the ones of this match, and queues the stitch; raw files follow
// through signed uploads, and each one stored is queued for verification.

const PARSER = 'r6-0123456789abcdef';
const NOW = 5_000;
let hash = 0;
const nextSha = () => (hash++).toString(16).padStart(64, '0');

/** The test league's match with that status. */
function matchWith(db: Db, status: 'scheduled' | 'validated'): LeagueMatch {
  const row = db.select().from(schema.match).where(eq(schema.match.status, status)).get();
  const [found] = row ? listLeagueMatches(db, { matchId: row.id }) : [];
  if (!found) throw new Error(`no ${status} match`);
  return found;
}

function setup() {
  const db = leagueDatabase();
  // Bravo against Charlie, still to play.
  const found = matchWith(db, 'scheduled');
  const bravo = addRosterPlayers(db, found.seasonId, found.a.teamId, 'b');
  const charlie = addRosterPlayers(db, found.seasonId, found.b.teamId, 'c');
  const playerOf = (account: string) =>
    db
      .select({ id: schema.gameAccount.playerId })
      .from(schema.gameAccount)
      .where(eq(schema.gameAccount.externalId, account))
      .get()?.id ?? 0;
  const uploader = playerOf(bravo[0] ?? '');
  const file = (
    number: number,
    accounts: [string[], string[]] = [bravo, charlie],
    extra: Partial<{ name: string; round: unknown }> = {},
  ) => ({
    name: `Match-2026-11-24_21-00-00-R${String(number + 1).padStart(2, '0')}.rec`,
    size: 1000 + number,
    sha256: nextSha(),
    round: rawRound({ lobby: 'L1', number, winner: 0, attacker: 0, startedAt: 0, accounts }),
    ...extra,
  });
  const submit = (files: ReturnType<typeof file>[], parser = PARSER, by = uploader) =>
    submitReplays(db, found, { parser, files }, { playerId: by, parserVersion: PARSER, now: NOW });
  return { db, found, bravo, charlie, uploader, playerOf, file, submit };
}

const jobs = (db: Db) =>
  db.select({ kind: schema.job.kind, payload: schema.job.payloadJson }).from(schema.job).all();

describe('submitReplays', () => {
  it('stores each round, unverified, with the side that recorded it, and queues the stitch once', () => {
    const { db, found, file, submit, uploader } = setup();
    const reply = submit([file(0), file(1)]);
    expect(reply).toEqual({
      ok: true,
      files: [
        expect.objectContaining({ status: 'stored' }),
        expect.objectContaining({ status: 'stored' }),
      ],
    });
    const rows = db.select().from(schema.replayFile).all();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      matchId: found.id,
      uploaderPlayerId: uploader,
      lobbyId: 'L1',
      unitNumber: 0,
      // The recorder is Bravo's first player: Bravo is side A of this match.
      recordedSide: 'a',
      parserVersion: PARSER,
      rawStatus: 'none',
      verified: 'unverified',
    });
    expect(rows[0]?.parsedJson).toMatchObject({ parser: PARSER, params: { trade_window_s: 10 } });
    expect(jobs(db)).toEqual([{ kind: 'stitch_game', payload: { matchId: found.id } }]);
  });

  it('asks a browser on another parser build to reload it, and stores nothing', () => {
    const { db, file, submit } = setup();
    expect(submit([file(0)], 'r6-ffffffffffffffff')).toEqual({
      ok: false,
      error: 'parser_version',
      current: PARSER,
    });
    expect(db.select().from(schema.replayFile).all()).toEqual([]);
  });

  it('refuses a file of another folder, another mode or another match, and keeps the rest', () => {
    const { db, file, submit } = setup();
    const strangers = ['x1', 'x2', 'x3', 'x4', 'x5'].map((x) => `${x}000000-0000-4000-8000-0`);
    const ranked = file(3);
    const reply = submit([
      file(0, undefined, { name: 'notes.txt' }),
      file(1, undefined, { round: { matchID: 'L1' } }),
      file(2, [strangers, strangers.map((s) => s.replace('x', 'y'))]),
      { ...ranked, round: { ...(ranked.round as object), gamemode: { name: 'Hostage', id: 2 } } },
      file(4),
    ]);
    if (!reply.ok) throw new Error(reply.error);
    expect(reply.files.map((f) => (f.status === 'refused' ? f.error : f.status))).toEqual([
      'not_a_replay',
      'invalid',
      'not_this_match',
      'not_bomb',
      'stored',
    ]);
    expect(db.select().from(schema.replayFile).all()).toHaveLength(1);
  });

  it('accepts a recording where only one team is known, as a team without its accounts set', () => {
    const { file, submit, bravo } = setup();
    const unknown = ['u1', 'u2', 'u3', 'u4', 'u5'].map((x) => `${x}000000-0000-4000-8000-0`);
    const reply = submit([file(0, [bravo, unknown])]);
    expect(reply.ok && reply.files[0]?.status).toBe('stored');
  });

  it('answers a file sent again with the stored one, and refuses one stored for another match', () => {
    const { db, file, submit } = setup();
    const first = file(0);
    const stored = submit([first]);
    if (!stored.ok || stored.files[0]?.status !== 'stored') throw new Error('not stored');
    const id = stored.files[0].id;
    expect(submit([first, first])).toEqual({
      ok: true,
      files: [
        { sha256: first.sha256, status: 'duplicate', id, raw: 'none' },
        { sha256: first.sha256, status: 'duplicate', id, raw: 'none' },
      ],
    });
    const other = matchWith(db, 'validated');
    db.update(schema.replayFile).set({ matchId: other.id }).run();
    const again = submit([first]);
    expect(again.ok && again.files[0]).toMatchObject({ status: 'refused', error: 'other_match' });
    // Nothing new was stored: the stitch is queued once.
    expect(jobs(db)).toHaveLength(1);
  });
});

describe('replayMatch and replaySides', () => {
  it('refuses a match forfeited or annulled', () => {
    const { db, found } = setup();
    expect(replayMatch(db, 999)).toEqual({ ok: false, error: 'not_found' });
    expect(replayMatch(db, found.id)).toMatchObject({ ok: true });
    db.update(schema.match).set({ status: 'void' }).where(eq(schema.match.id, found.id)).run();
    expect(replayMatch(db, found.id)).toEqual({ ok: false, error: 'closed' });
  });

  it('lets each team’s players send theirs, and nobody else', () => {
    const { db, found, bravo, charlie, playerOf } = setup();
    expect(replaySides(db, playerOf(bravo[2] ?? ''), found)).toEqual(['a']);
    expect(replaySides(db, playerOf(charlie[0] ?? ''), found)).toEqual(['b']);
    const org = db.select().from(schema.org).get();
    if (!org) throw new Error('no organisation');
    const stranger = db
      .insert(schema.player)
      .values({ orgId: org.id, slug: 'stranger', displayName: 'Stranger', createdAt: 0 })
      .returning()
      .get();
    expect(replaySides(db, stranger.id, found)).toEqual([]);
    // A player who left the roster no longer sends for it.
    db.update(schema.rosterEntry)
      .set({ validTo: 1 })
      .where(eq(schema.rosterEntry.playerId, playerOf(bravo[2] ?? '')))
      .run();
    expect(replaySides(db, playerOf(bravo[2] ?? ''), found)).toEqual([]);
  });
});

describe('raw uploads', () => {
  function stored() {
    const context = setup();
    const reply = context.submit([context.file(0), context.file(1)]);
    if (!reply.ok) throw new Error(reply.error);
    const ids = reply.files.flatMap((f) => (f.status === 'stored' ? [f.id] : []));
    const objects = fakeObjectStore();
    return { ...context, ids, objects };
  }
  const rowOf = (db: Db, id: number) =>
    db.select().from(schema.replayFile).where(eq(schema.replayFile.id, id)).get();

  it('signs one upload per file of the match, with its exact key and size', async () => {
    const { db, found, ids, objects } = stored();
    const signed = await signReplayUploads(db, objects, found, [...ids, 999]);
    expect(signed).toEqual([
      expect.objectContaining({ id: ids[0], method: 'PUT' }),
      expect.objectContaining({ id: ids[1], method: 'PUT' }),
      { id: 999, error: 'not_found' },
    ]);
    const row = rowOf(db, ids[0] ?? 0);
    expect(row?.rawStatus).toBe('uploading');
    expect(objects.signed.at(0)).toMatchObject({
      key: rawReplayKey(found.id, row?.sha256 ?? ''),
      size: row?.size,
      contentType: 'application/octet-stream',
      expiresInS: 600,
    });
  });

  it('marks a file stored once its object is there, and queues its verification once', async () => {
    const { db, found, ids, objects } = stored();
    const [id = 0, missing = 0] = ids;
    const row = rowOf(db, id);
    if (!row) throw new Error('no row');
    await objects.put(rawReplayKey(found.id, row.sha256), new Uint8Array(row.size), 'x');
    expect(await markReplaysStored(db, objects, found, [id, missing], NOW)).toEqual([
      { id, status: 'stored' },
      { id: missing, status: 'missing' },
    ]);
    expect(rowOf(db, id)).toMatchObject({
      rawStatus: 'stored',
      rawKey: rawReplayKey(found.id, row.sha256),
    });
    expect(await markReplaysStored(db, objects, found, [id], NOW)).toEqual([
      { id, status: 'stored' },
    ]);
    expect(jobs(db).filter((job) => job.kind === 'verify_replay')).toEqual([
      { kind: 'verify_replay', payload: { fileId: id } },
    ]);
    expect(await signReplayUploads(db, objects, found, [id])).toEqual([{ id, error: 'stored' }]);
  });

  it('does not take an object of another size', async () => {
    const { db, found, ids, objects } = stored();
    const [id = 0] = ids;
    const row = rowOf(db, id);
    await objects.put(rawReplayKey(found.id, row?.sha256 ?? ''), new Uint8Array(3), 'x');
    expect(await markReplaysStored(db, objects, found, [id], NOW)).toEqual([
      { id, status: 'missing' },
    ]);
  });

  it('knows only the files of the match it is asked about', async () => {
    const { db, ids, objects } = stored();
    const other = matchWith(db, 'validated');
    expect(await signReplayUploads(db, objects, other, ids)).toEqual(
      ids.map((id) => ({ id, error: 'not_found' })),
    );
  });
});
