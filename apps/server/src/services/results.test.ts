import {
  promotionSchema,
  mercatoSchema,
  registrationSchema,
  requestsSchema,
  vetoSchema,
} from '@ligo/core';
import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { fakeEvidenceStore } from '../assets/evidence-store.ts';
import {
  disputedReport,
  leagueDatabase,
  OPEN_REPORT_POSTS,
  TEST_GUILD,
  TEST_STAFF_ROLE,
} from '../testing.ts';
import type { Actor } from './permissions.ts';
import { requireStaff } from './permissions.ts';
import { ensurePlayer } from './players.ts';
import { enterResult, recordResult, SCREENSHOT_MAX_BYTES } from './results.ts';
import { getStandings } from './standings.ts';

const { auditLog, competition, evidence, game, match, player } = schema;

const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: ['333333333333333333', TEST_STAFF_ROLE],
};
const MEMBER: Actor = { ...STAFF, memberRoleIds: ['333333333333333333'] };
// In leagueDatabase(): match 3 is BRV v CHA (Ligue 1, week 3), still to play;
// match 1 is ALP 7-4 BRV, validated; match 2 is a forfeit; match 4 is in Ligue 2.
const OPEN_MATCH = 3;

const pointsOf = (db: ReturnType<typeof leagueDatabase>) => {
  const standings = getStandings(db, { guildId: TEST_GUILD, division: 'L1' });
  if (!standings.ok) throw new Error(standings.error);
  return Object.fromEntries(
    (standings.tables[0]?.rows ?? []).map((row) => [row.team.tag, [row.points, row.diff]]),
  );
};

describe('requireStaff', () => {
  it('accepts a member holding the stored staff role', () => {
    expect(requireStaff(leagueDatabase(), STAFF)).toMatchObject({
      ok: true,
      league: { competition: { slug: 'lfr' } },
    });
  });

  it.each([
    ['a member without the role', MEMBER, 'not_staff'],
    ['a member with no role', { ...STAFF, memberRoleIds: [] }, 'not_staff'],
    ['a server that is not linked', { ...STAFF, guildId: '999999999999999999' }, 'not_linked'],
    ['a direct message', { ...STAFF, guildId: null }, 'not_linked'],
  ] as const)('refuses %s', (_name, actor, error) => {
    expect(requireStaff(leagueDatabase(), actor)).toEqual({ ok: false, error });
  });

  it('follows the role stored in the database, not the one it held before', () => {
    const db = leagueDatabase();
    db.update(schema.leagueGuild).set({ staffRoleId: '444444444444444444' }).run();
    expect(requireStaff(db, STAFF)).toEqual({ ok: false, error: 'not_staff' });
  });
});

describe('ensurePlayer', () => {
  const input = { orgId: 1, discordUserId: '222222222222222222', displayName: 'Léa Staff' };

  it('creates the player once and returns the same row afterwards', () => {
    const db = leagueDatabase();
    const created = ensurePlayer(db, input, 5000);
    expect(created).toMatchObject({
      orgId: 1,
      slug: 'lea-staff',
      displayName: 'Léa Staff',
      discordUserId: '222222222222222222',
      createdAt: 5000,
      statsConsentAt: null,
    });
    expect(ensurePlayer(db, { ...input, displayName: 'Renamed' }, 6000)).toEqual(created);
    expect(db.select().from(player).all()).toHaveLength(1);
  });

  it('gives two users with the same name different slugs, and a nameless one "player"', () => {
    const db = leagueDatabase();
    const slugOf = (discordUserId: string, displayName: string) =>
      ensurePlayer(db, { orgId: 1, discordUserId, displayName }, 1).slug;
    expect(slugOf('1', 'Léa')).toBe('lea');
    expect(slugOf('2', 'Lea')).toBe('lea-2');
    expect(slugOf('3', 'LEA')).toBe('lea-3');
    expect(slugOf('4', '!!!')).toBe('player');
    expect(slugOf('5', '日本')).toBe('player-2');
  });
});

describe('recordResult', () => {
  const request = { matchId: OPEN_MATCH, scoreA: 7, scoreB: 5 };

  it('stores the score, validates the match and names who did it', () => {
    const db = leagueDatabase();
    const reply = recordResult(db, STAFF, request, 9000);

    expect(reply).toMatchObject({
      ok: true,
      scoreA: 7,
      scoreB: 5,
      previous: null,
      match: { id: OPEN_MATCH, week: 3, a: { tag: 'BRV' }, b: { tag: 'CHA' } },
    });
    const staffPlayer = db.select().from(player).get();
    expect(staffPlayer).toMatchObject({ discordUserId: STAFF.user.id, slug: 'lea-staff' });
    expect(db.select().from(match).all()[OPEN_MATCH - 1]).toMatchObject({
      status: 'validated',
      validatedBy: staffPlayer?.id,
      validatedAt: 9000,
    });
    expect(db.select().from(game).all().at(-1)).toMatchObject({
      matchId: OPEN_MATCH,
      n: 1,
      scoreA: 7,
      scoreB: 5,
      forfeitSide: null,
      status: 'final',
    });
  });

  it('counts in the standings at once', () => {
    const db = leagueDatabase();
    expect(pointsOf(db)).toEqual({ ALP: [6, 3], CHA: [0, 0], BRV: [0, -3] });
    recordResult(db, STAFF, request, 9000);
    expect(pointsOf(db)).toEqual({ ALP: [6, 3], BRV: [3, -1], CHA: [0, -2] });
  });

  it('writes one audit entry with the state before and after', () => {
    const db = leagueDatabase();
    recordResult(db, STAFF, request, 9000);
    const staffPlayer = db.select().from(player).get();
    expect(db.select().from(auditLog).all().at(-1)).toMatchObject({
      actorPlayerId: staffPlayer?.id,
      actorKind: 'user',
      action: 'match.result',
      entity: 'match',
      entityId: String(OPEN_MATCH),
      beforeJson: { status: 'scheduled' },
      afterJson: { status: 'validated', scoreA: 7, scoreB: 5, evidenceId: null },
      at: 9000,
    });
  });

  it('corrects a validated result and keeps the old one in the audit log', () => {
    const db = leagueDatabase();
    recordResult(db, STAFF, request, 9000);
    const games = db.select().from(game).all().length;

    const reply = recordResult(db, STAFF, { matchId: OPEN_MATCH, scoreA: 6, scoreB: 8 }, 9500);

    expect(reply).toMatchObject({ ok: true, previous: { scoreA: 7, scoreB: 5 } });
    expect(db.select().from(game).all()).toHaveLength(games);
    expect(db.select().from(game).all().at(-1)).toMatchObject({ scoreA: 6, scoreB: 8 });
    expect(db.select().from(match).all()[OPEN_MATCH - 1]).toMatchObject({ validatedAt: 9500 });
    expect(db.select().from(auditLog).all().at(-1)).toMatchObject({
      action: 'match.result',
      beforeJson: { status: 'validated', scoreA: 7, scoreB: 5 },
      afterJson: { status: 'validated', scoreA: 6, scoreB: 8 },
    });
    expect(pointsOf(db)).toEqual({ ALP: [6, 3], CHA: [3, 2], BRV: [0, -5] });
  });

  it('records a kept screenshot as staff-only evidence, by ID in the audit log', () => {
    const db = leagueDatabase();
    const objectKey = `evidence/3/${'a'.repeat(64)}.png`;
    recordResult(db, STAFF, { ...request, screenshot: { objectKey } }, 9000);

    const stored = db.select().from(evidence).all();
    expect(stored).toMatchObject([
      {
        matchId: OPEN_MATCH,
        kind: 'score_screenshot',
        url: null,
        objectKey,
        visibility: 'staff',
        at: 9000,
      },
    ]);
    const audit = db.select().from(auditLog).all().at(-1);
    expect(audit?.afterJson).toMatchObject({ evidenceId: stored[0]?.id });
    expect(JSON.stringify(audit)).not.toContain('evidence/');
  });

  it.each([
    [7, 0],
    [5, 7],
    [8, 6],
    [7, 8],
  ])('accepts every score a map can end on: %i-%i', (scoreA, scoreB) => {
    expect(recordResult(leagueDatabase(), STAFF, { ...request, scoreA, scoreB }, 9000).ok).toBe(
      true,
    );
  });

  it("follows the league's own rule, and checks nothing when it sets none", () => {
    const db = leagueDatabase();
    const setRule = (game_score: { win_at: number; overtime_rounds: number } | null) =>
      db
        .update(competition)
        .set({
          rulesetJson: {
            result_validation: 'staff',
            game_score,
            team_roles: { managers_max: 3, coaches_max: 1 },
            requests: requestsSchema.parse({}),
            dispute_reasons: [],
            veto: vetoSchema.parse({}),
            promotion: promotionSchema.parse({}),
            registration: registrationSchema.parse({}),
            mercato: mercatoSchema.parse({}),
          },
        })
        .run();
    const record = (scoreA: number, scoreB: number) =>
      recordResult(db, STAFF, { ...request, scoreA, scoreB }, 9000);

    setRule({ win_at: 13, overtime_rounds: 2 });
    expect(record(7, 5)).toMatchObject({ ok: false, error: 'impossible_score' });
    expect(record(15, 13).ok).toBe(true);

    setRule(null);
    expect(record(7, 6).ok).toBe(true);
    expect(record(3, 2).ok).toBe(true);
  });

  it('accepts a result without a screenshot: optional for staff', () => {
    const db = leagueDatabase();
    expect(recordResult(db, STAFF, { ...request, screenshot: null }, 9000).ok).toBe(true);
    expect(db.select().from(evidence).all()).toEqual([]);
  });

  describe('refusals change nothing', () => {
    const untouched = (
      name: string,
      actor: Actor,
      bad: Parameters<typeof recordResult>[2],
      error: string,
      prepare?: (db: ReturnType<typeof leagueDatabase>) => void,
    ) => {
      it(name, () => {
        const db = leagueDatabase();
        prepare?.(db);
        const before = db.$client.serialize().toString('base64');
        expect(recordResult(db, actor, bad, 9000)).toEqual({ ok: false, error });
        expect(db.$client.serialize().toString('base64')).toBe(before);
      });
    };

    untouched('a member who is not staff', MEMBER, request, 'not_staff');
    untouched('a server that is not linked', { ...STAFF, guildId: null }, request, 'not_linked');
    untouched('an unknown match', STAFF, { ...request, matchId: 99 }, 'match_not_found');
    untouched('a draw', STAFF, { ...request, scoreA: 6, scoreB: 6 }, 'invalid_score');
    untouched('a negative score', STAFF, { ...request, scoreA: -1 }, 'invalid_score');
    untouched('a fractional score', STAFF, { ...request, scoreA: 6.5 }, 'invalid_score');
    untouched('a forfeit', STAFF, { ...request, matchId: 2 }, 'match_closed');

    it.each([
      [7, 6],
      [6, 7],
      [9, 7],
      [6, 4],
      [12, 0],
    ])('a score a map cannot end on: %i-%i', (scoreA, scoreB) => {
      const db = leagueDatabase();
      const before = db.$client.serialize().toString('base64');
      expect(recordResult(db, STAFF, { ...request, scoreA, scoreB }, 9000)).toEqual({
        ok: false,
        error: 'impossible_score',
        rule: { win_at: 7, overtime_rounds: 3 },
      });
      expect(db.$client.serialize().toString('base64')).toBe(before);
    });
    untouched('an annulled match', STAFF, request, 'match_closed', (db) => {
      db.update(match).set({ status: 'void' }).run();
    });
    untouched('a series', STAFF, request, 'unsupported_series', (db) => {
      db.update(match).set({ bestOf: 3 }).run();
    });
    untouched("another league's match", STAFF, request, 'match_not_found', (db) => {
      // The server now belongs to a second competition; match 3 still belongs to the first.
      const first = db.select().from(competition).get();
      if (!first) throw new Error('No competition seeded');
      const other = db
        .insert(competition)
        .values({ ...first, id: undefined, slug: 'other' })
        .returning()
        .get();
      db.update(schema.leagueGuild).set({ competitionId: other.id }).run();
    });
  });

  it('rolls the result back when the audit entry cannot be written', () => {
    const db = leagueDatabase();
    db.$client.exec(
      "CREATE TRIGGER audit_fails BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END",
    );
    expect(() => recordResult(db, STAFF, request, 9000)).toThrow(/audit down/);
    expect(db.select().from(match).all()[OPEN_MATCH - 1]?.status).toBe('scheduled');
    expect(db.select().from(player).all()).toEqual([]);
  });
});

describe('recordResult over a report still open', () => {
  it('names the report’s posts and the disputes it settles, for Discord to close them', () => {
    const db = leagueDatabase();
    disputedReport(db);
    const reply = recordResult(db, STAFF, { matchId: OPEN_MATCH, scoreA: 7, scoreB: 4 }, 9000);
    expect(reply).toMatchObject({
      ok: true,
      posts: [OPEN_REPORT_POSTS.queue],
      post: OPEN_REPORT_POSTS.report,
      disputes: [
        {
          reason: 'wrong_score',
          details: 'Round 9 replayed',
          raisedBy: '700000000000000002',
          posts: [OPEN_REPORT_POSTS.dispute],
        },
      ],
    });
    expect(db.select().from(schema.dispute).get()?.resolution).toBe('result_entered');
  });

  it('names none on a match without a report', () => {
    const reply = recordResult(
      leagueDatabase(),
      STAFF,
      { matchId: OPEN_MATCH, scoreA: 7, scoreB: 5 },
      9000,
    );
    expect(reply).toMatchObject({ ok: true, posts: [], post: null, disputes: [] });
  });
});

// The staff panel on the match page uploads the screenshot (phase 3f): it is checked, then kept by
// the evidence store before the result is recorded; a refusal stores nothing.
describe('enterResult', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2]);
  const enter = (
    db: ReturnType<typeof leagueDatabase>,
    store: ReturnType<typeof fakeEvidenceStore>,
    change: Partial<Parameters<typeof enterResult>[3]> = {},
    actor: Actor = STAFF,
  ) =>
    enterResult(
      db,
      store,
      actor,
      { matchId: OPEN_MATCH, scoreA: 7, scoreB: 5, screenshot: PNG, ...change },
      9000,
    );

  it('keeps the uploaded screenshot, then records the result with it', async () => {
    const db = leagueDatabase();
    const store = fakeEvidenceStore();
    expect(await enter(db, store)).toMatchObject({ ok: true, scoreA: 7, scoreB: 5 });
    const [key] = [...store.files.keys()];
    expect(key).toMatch(/^evidence\/3\/[0-9a-f]{64}\.png$/);
    expect(db.select().from(evidence).get()).toMatchObject({ objectKey: key, visibility: 'staff' });
  });

  it('records a result without a screenshot: optional for staff', async () => {
    const db = leagueDatabase();
    const store = fakeEvidenceStore();
    expect((await enter(db, store, { screenshot: null })).ok).toBe(true);
    expect(store.files.size).toBe(0);
  });

  it.each([
    ['not an image', { screenshot: new Uint8Array([1, 2, 3]) }, 'invalid_screenshot'],
    ['too large', { screenshot: new Uint8Array(SCREENSHOT_MAX_BYTES + 1) }, 'invalid_screenshot'],
    ['an impossible score', { scoreA: 7, scoreB: 6 }, 'impossible_score'],
    ['a match of no one', { matchId: 999 }, 'match_not_found'],
    ['a forfeited match', { matchId: 2 }, 'match_closed'],
  ])('refuses %s, and stores nothing', async (_name, change, error) => {
    const db = leagueDatabase();
    const store = fakeEvidenceStore();
    expect(await enter(db, store, change)).toMatchObject({ ok: false, error });
    expect(store.files.size).toBe(0);
    expect(db.select().from(evidence).all()).toEqual([]);
  });

  it('refuses a member who is not staff, and stores nothing', async () => {
    const store = fakeEvidenceStore();
    expect(await enter(leagueDatabase(), store, {}, MEMBER)).toEqual({
      ok: false,
      error: 'not_staff',
    });
    expect(store.files.size).toBe(0);
  });

  it('records nothing when the screenshot cannot be kept', async () => {
    const db = leagueDatabase();
    const store = fakeEvidenceStore();
    store.failing = true;
    expect(await enter(db, store)).toEqual({ ok: false, error: 'screenshot_unstored' });
    expect(db.select().from(match).all()[OPEN_MATCH - 1]?.status).toBe('scheduled');
  });
});
