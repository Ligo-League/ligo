import { listLeagueMatches, schema, type Db, type LeagueMatch } from '@ligo/db';
import { addRosterPlayers } from '@ligo/db/testing';
import { fakeObjectStore } from '@ligo/storage';
import { rawRound } from '@ligo/titles/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Actor } from './permissions.ts';
import {
  leagueDatabase,
  playedMatch,
  requireMoss,
  TEST_GUILD,
  TEST_STAFF_ROLE,
} from '../testing.ts';
import {
  MOSS_MAX_BYTES,
  mossCheck,
  mossTargets,
  openMoss,
  setMossHold,
  signMossUpload,
  storeMoss,
} from './moss.ts';
import { submitReplays } from './replay-uploads.ts';
import { announceLineup, lineupChoices } from './match-lineup.ts';

// MOSS files (M-47, maintainer 20 and 24 November 2026): the players the replays show on each
// side send one each, themselves or through an official of their team; nobody else may.

const PARSER = 'r6-0123456789abcdef';
/** A zip file's first bytes, then zeros: what MOSS sends (M-47). */
const zip = (size: number) => {
  const bytes = new Uint8Array(size);
  bytes.set([0x50, 0x4b, 3, 4]);
  return bytes;
};
let hash = 0;

function matchWith(db: Db, status: 'scheduled'): LeagueMatch {
  const row = db.select().from(schema.match).where(eq(schema.match.status, status)).get();
  const [found] = row ? listLeagueMatches(db, { matchId: row.id }) : [];
  if (!found) throw new Error('no match');
  return found;
}

const playerOf = (db: Db, account: string) =>
  db
    .select({ id: schema.gameAccount.playerId })
    .from(schema.gameAccount)
    .where(eq(schema.gameAccount.externalId, account))
    .get()?.id ?? 0;

/** A match whose one lobby was placed in its game by the stitch, Bravo on file side 0. */
function setup(options: { segment?: 'ok' | 'ignored' } = {}) {
  const db = leagueDatabase();
  requireMoss(db);
  const found = matchWith(db, 'scheduled');
  const a = addRosterPlayers(db, found.seasonId, found.a.teamId, 'b');
  const b = addRosterPlayers(db, found.seasonId, found.b.teamId, 'c');
  const uploader = playerOf(db, a[0] ?? '');
  const reply = submitReplays(
    db,
    found,
    {
      parser: PARSER,
      files: [0, 1].map((number) => ({
        name: `Match-R0${String(number + 1)}.rec`,
        size: 10,
        sha256: (hash++).toString(16).padStart(64, '0'),
        round: rawRound({
          lobby: 'L1',
          number,
          winner: 0,
          attacker: 0,
          startedAt: 0,
          accounts: [a, b],
        }),
      })),
    },
    { playerId: uploader, parserVersion: PARSER, now: 1 },
  );
  if (!reply.ok) throw new Error(reply.error);
  const gameId = db
    .insert(schema.game)
    .values({ matchId: found.id, n: 1, map: 'Clubhouse', bansJson: [] })
    .returning()
    .get().id;
  const ok = (options.segment ?? 'ok') === 'ok';
  db.insert(schema.replaySegment)
    .values({
      matchId: found.id,
      lobbyId: 'L1',
      startedAt: 0,
      status: ok ? 'ok' : 'ignored',
      gameId: ok ? gameId : null,
      teamMapJson: ok ? ['a', 'b'] : null,
    })
    .run();
  const objects = fakeObjectStore();
  return { db, found, a, b, objects, player: (account: string) => playerOf(db, account) };
}

describe('mossCheck', () => {
  it('lists the players each side’s replays show, all missing until they send their file', () => {
    const { db, found } = setup();
    const check = mossCheck(db, found);
    expect(check.required).toBe(true);
    expect(check.sides.a.map((p) => p.name)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
    expect(check.sides.b.map((p) => p.name)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(check.gaps).toHaveLength(10);
    expect(check.gaps[0]).toMatchObject({ kind: 'missing', side: 'a', name: 'b1' });
  });

  it('counts no lobby staff ignored: its players are not shown to have played', () => {
    const { db, found } = setup({ segment: 'ignored' });
    expect(mossCheck(db, found).gaps).toEqual([
      { kind: 'too_few_players', side: 'a', seen: 0 },
      { kind: 'too_few_players', side: 'b', seen: 0 },
    ]);
  });
});

describe('mossTargets', () => {
  it('lets a player send their own file, an official their side’s, and staff anyone’s', () => {
    const { db, found, a, player } = setup();
    const self = player(a[1] ?? '');
    expect(mossTargets(db, self, found, false).map((t) => t.name)).toEqual(['b2']);
    expect(mossTargets(db, self, found, true)).toHaveLength(10);
    const org = db.select().from(schema.org).get();
    const official = db
      .insert(schema.player)
      .values({ orgId: org?.id ?? 0, slug: 'manager', displayName: 'Manager', createdAt: 0 })
      .returning()
      .get();
    db.insert(schema.teamStaff)
      .values({ teamId: found.a.teamId, playerId: official.id, role: 'manager', since: 0 })
      .run();
    expect(mossTargets(db, official.id, found, false).map((t) => t.side)).toEqual([
      'a',
      'a',
      'a',
      'a',
      'a',
    ]);
  });
});

describe('signMossUpload and storeMoss', () => {
  it('signs a file for a player who played, then keeps it for staff only', async () => {
    const { db, found, a, objects, player } = setup();
    const me = player(a[0] ?? '');
    const signed = await signMossUpload(db, objects, found, {
      uploaderId: me,
      staff: false,
      playerId: me,
      name: 'MOSS_2026-11-24.zip',
      size: 3000,
    });
    if (!signed.ok) throw new Error(signed.error);
    expect(signed.key).toMatch(
      new RegExp(`^evidence/${String(found.id)}/moss/${String(me)}-[0-9a-f]{32}\\.zip$`),
    );
    await objects.put(signed.key, zip(3000), 'application/zip');
    const stored = await storeMoss(
      db,
      objects,
      found,
      { uploaderId: me, staff: false, playerId: me, key: signed.key },
      7,
    );
    expect(stored.ok).toBe(true);
    const row = db.select().from(schema.evidence).where(eq(schema.evidence.kind, 'moss')).get();
    expect(row).toMatchObject({ playerId: me, uploadedBy: me, visibility: 'staff', at: 7 });
    expect(mossCheck(db, found).gaps).toHaveLength(9);
  });

  it('refuses a file for someone the replays do not show, or by a teammate, or too large', async () => {
    const { db, found, a, objects, player } = setup();
    const me = player(a[0] ?? '');
    const sign = (playerId: number, size = 10) =>
      signMossUpload(db, objects, found, {
        uploaderId: me,
        staff: false,
        playerId,
        name: 'm.zip',
        size,
      });
    expect(await sign(player(a[1] ?? ''))).toEqual({ ok: false, error: 'not_allowed' });
    expect(await sign(99_999)).toEqual({ ok: false, error: 'not_played' });
    expect(await sign(me, MOSS_MAX_BYTES + 1)).toEqual({ ok: false, error: 'too_large' });
    expect(objects.signed).toEqual([]);
  });

  it('takes only a key signed for that match and player, once the object is there', async () => {
    const { db, found, a, objects, player } = setup();
    const me = player(a[0] ?? '');
    const store = (key: string, playerId = me) =>
      storeMoss(db, objects, found, { uploaderId: me, staff: false, playerId, key }, 7);
    expect(await store(`evidence/${String(found.id)}/moss/${String(me)}-x.zip`)).toEqual({
      ok: false,
      error: 'bad_key',
    });
    expect(await store(`evidence/999/moss/${String(me)}-${'0'.repeat(32)}.zip`)).toEqual({
      ok: false,
      error: 'bad_key',
    });
    expect(
      await store(`evidence/${String(found.id)}/moss/${String(me)}-${'0'.repeat(32)}.zip`),
    ).toEqual({
      ok: false,
      error: 'missing',
    });
  });

  it('replaces a player’s earlier file, deleting it, unless staff hold the match’s files', async () => {
    const { db, found, a, objects, player } = setup();
    const me = player(a[0] ?? '');
    const send = async (fill: string) => {
      const key = `evidence/${String(found.id)}/moss/${String(me)}-${fill.repeat(32)}.zip`;
      await objects.put(key, zip(5), 'application/zip');
      await storeMoss(db, objects, found, { uploaderId: me, staff: false, playerId: me, key }, 9);
      return key;
    };
    const first = await send('1');
    const second = await send('2');
    expect(objects.objects.has(first)).toBe(false);
    const rows = db.select().from(schema.evidence).where(eq(schema.evidence.kind, 'moss')).all();
    expect(rows.map((r) => [r.objectKey, r.deletedAt])).toEqual([
      [first, 9],
      [second, null],
    ]);
    db.update(schema.match).set({ mossHeldAt: 1, mossHeldBy: me, mossHoldReason: 'enquête' }).run();
    await send('3');
    expect(objects.objects.has(second)).toBe(true);
  });
});

describe('staff and the files', () => {
  const STAFF: Actor = {
    guildId: TEST_GUILD,
    user: { id: '222222222222222222', displayName: 'Léa Staff' },
    memberRoleIds: [TEST_STAFF_ROLE],
  };
  const TEAM: Actor = {
    ...STAFF,
    user: { id: '700000000000000009', displayName: 'X' },
    memberRoleIds: [],
  };

  it('opens a file for the league’s staff only, under a plain name, and not once deleted', () => {
    const db = leagueDatabase();
    const players = playedMatch(db, 3, true);
    const row = db
      .select()
      .from(schema.evidence)
      .where(eq(schema.evidence.playerId, players.a[0] ?? 0))
      .get();
    const id = row?.id ?? 0;
    expect(openMoss(db, STAFF, id)).toMatchObject({
      ok: true,
      key: row?.objectKey,
      fileName: expect.stringMatching(/^moss-match-3-m3a1\.zip$/) as unknown,
    });
    expect(openMoss(db, TEAM, id)).toEqual({ ok: false, error: 'not_staff' });
    db.update(schema.evidence).set({ deletedAt: 5 }).where(eq(schema.evidence.id, id)).run();
    expect(openMoss(db, STAFF, id)).toEqual({ ok: false, error: 'not_found' });
  });

  it('holds the match’s files with a reason and releases them, both audited', () => {
    const db = leagueDatabase();
    const hold = (on: boolean, reason = '') =>
      setMossHold(db, STAFF, { matchId: 3, hold: on, reason }, 10);
    expect(hold(true)).toEqual({ ok: false, error: 'reason_required' });
    expect(hold(true, 'Soupçon de triche')).toEqual({ ok: true });
    expect(hold(true, 'encore')).toEqual({ ok: false, error: 'already_held' });
    expect(db.select().from(schema.match).where(eq(schema.match.id, 3)).get()).toMatchObject({
      mossHeldAt: 10,
      mossHoldReason: 'Soupçon de triche',
    });
    expect(hold(false)).toEqual({ ok: true });
    expect(hold(false)).toEqual({ ok: false, error: 'not_held' });
    expect(setMossHold(db, TEAM, { matchId: 3, hold: true, reason: 'x' }, 10)).toEqual({
      ok: false,
      error: 'not_staff',
    });
    const actions = db
      .select()
      .from(schema.auditLog)
      .all()
      .map((row) => row.action);
    expect(actions.filter((a) => a.startsWith('match.moss'))).toEqual([
      'match.moss_hold',
      'match.moss_release',
    ]);
  });
});

describe('MOSS files are zips', () => {
  it('refuses a name that is not a zip, and a stored file that is not one, deleting it', async () => {
    const { db, found, a, objects, player } = setup();
    const me = player(a[0] ?? '');
    const sign = (name: string) =>
      signMossUpload(db, objects, found, {
        uploaderId: me,
        staff: false,
        playerId: me,
        name,
        size: 10,
      });
    expect(await sign('capture.rar')).toEqual({ ok: false, error: 'not_zip' });
    const signed = await sign('MOSS.ZIP');
    if (!signed.ok) throw new Error(signed.error);
    expect(signed.key.endsWith('.zip')).toBe(true);
    expect(objects.signed[0]?.contentType).toBe('application/zip');
    await objects.put(signed.key, new Uint8Array(10), 'application/zip');
    expect(
      await storeMoss(
        db,
        objects,
        found,
        { uploaderId: me, staff: false, playerId: me, key: signed.key },
        7,
      ),
    ).toEqual({ ok: false, error: 'not_zip' });
    expect(objects.objects.has(signed.key)).toBe(false);
  });
});

describe('MOSS players from the announced lineup (the default)', () => {
  function lineupLeague() {
    const db = leagueDatabase();
    requireMoss(db);
    for (const row of db.select().from(schema.competition).all()) {
      db.update(schema.competition)
        .set({
          rulesetJson: {
            ...row.rulesetJson,
            moss: { ...row.rulesetJson.moss, players_from: 'lineup' },
          },
        })
        .where(eq(schema.competition.id, row.id))
        .run();
    }
    const found = matchWith(db, 'scheduled');
    addRosterPlayers(db, found.seasonId, found.a.teamId, 'b');
    addRosterPlayers(db, found.seasonId, found.b.teamId, 'c');
    const org = db.select().from(schema.org).get();
    const sub = db
      .insert(schema.player)
      .values({ orgId: org?.id ?? 0, slug: 'sub', displayName: 'Sub', createdAt: 0 })
      .returning()
      .get();
    db.insert(schema.rosterEntry)
      .values({
        seasonId: found.seasonId,
        teamId: found.a.teamId,
        playerId: sub.id,
        role: 'sub',
        validFrom: 0,
      })
      .run();
    return { db, found, sub };
  }

  it('asks each roster’s starters by default, with no replays needed', () => {
    const { db, found } = lineupLeague();
    const check = mossCheck(db, found);
    expect(check.from).toBe('lineup');
    expect(check.sides.a.map((p) => p.name)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
    expect(check.gaps).toHaveLength(10);
    expect(check.gaps.every((gap) => gap.kind === 'missing')).toBe(true);
  });

  it('asks the players the team announced for the match: a substitute in a starter’s place', () => {
    const { db, found, sub } = lineupLeague();
    const officialId = db
      .insert(schema.player)
      .values({ orgId: 1, slug: 'manager', displayName: 'Manager', createdAt: 0 })
      .returning()
      .get().id;
    db.insert(schema.teamStaff)
      .values({ teamId: found.a.teamId, playerId: officialId, role: 'manager', since: 0 })
      .run();
    const starters = lineupChoices(db, found, 'a').filter((c) => c.role === 'player');
    const chosen = [...starters.slice(0, 4).map((c) => c.playerId), sub.id];
    expect(
      announceLineup(db, found, 'a', { playerId: officialId, staff: false }, chosen, 5),
    ).toEqual({ ok: true });
    expect(mossCheck(db, found).sides.a.map((p) => p.name)).toEqual([
      'b1',
      'b2',
      'b3',
      'b4',
      'Sub',
    ]);
    expect(mossTargets(db, sub.id, found, false).map((t) => t.name)).toEqual(['Sub']);
  });

  it('refuses a lineup from a player, of fewer than a team, or once the result is reported', () => {
    const { db, found, sub } = lineupLeague();
    const ids = lineupChoices(db, found, 'a').map((c) => c.playerId);
    const staff = { playerId: sub.id, staff: true };
    expect(announceLineup(db, found, 'a', { playerId: sub.id, staff: false }, ids, 5)).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    expect(announceLineup(db, found, 'a', staff, ids.slice(0, 4), 5)).toEqual({
      ok: false,
      error: 'too_few',
    });
    expect(announceLineup(db, found, 'a', staff, [...ids.slice(0, 4), 99_999], 5)).toEqual({
      ok: false,
      error: 'not_on_roster',
    });
    const reported = { ...found, status: 'reported' as const };
    const captain = lineupChoices(db, found, 'a')[0]?.playerId ?? 0;
    db.update(schema.rosterEntry)
      .set({ captain: true })
      .where(eq(schema.rosterEntry.playerId, captain))
      .run();
    expect(announceLineup(db, reported, 'a', { playerId: captain, staff: false }, ids, 5)).toEqual({
      ok: false,
      error: 'locked',
    });
    expect(announceLineup(db, reported, 'a', staff, ids, 5)).toEqual({ ok: true });
  });
});
