import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import type { Actor } from './permissions.ts';
import { requireStaff } from './permissions.ts';
import { ensurePlayer } from './players.ts';
import { recordResult, searchMatches } from './results.ts';
import { getStandings } from './standings.ts';

const { auditLog, competition, division, evidence, game, match, player, season, stage } = schema;

const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: ['333333333333333333', TEST_STAFF_ROLE],
};
const MEMBER: Actor = { ...STAFF, memberRoleIds: ['333333333333333333'] };
const SCREENSHOT = {
  url: 'https://cdn.discordapp.com/attachments/1/2/score.png?ex=abc&is=def&hm=123',
  contentType: 'image/png',
  size: 250_000,
};
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

  it('stores an attached screenshot as staff-only evidence, by ID in the audit log', () => {
    const db = leagueDatabase();
    recordResult(db, STAFF, { ...request, screenshot: SCREENSHOT }, 9000);

    const stored = db.select().from(evidence).all();
    expect(stored).toMatchObject([
      {
        matchId: OPEN_MATCH,
        kind: 'score_screenshot',
        url: SCREENSHOT.url,
        objectKey: null,
        visibility: 'staff',
        at: 9000,
      },
    ]);
    const audit = db.select().from(auditLog).all().at(-1);
    expect(audit?.afterJson).toMatchObject({ evidenceId: stored[0]?.id });
    expect(JSON.stringify(audit)).not.toContain('discordapp');
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
            team_staff_max: 3,
            dispute_reasons: [],
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

    it.each([
      ['hosted elsewhere', { ...SCREENSHOT, url: 'https://example.com/score.png' }],
      ['not https', { ...SCREENSHOT, url: SCREENSHOT.url.replace('https', 'http') }],
      ['not an address', { ...SCREENSHOT, url: 'score.png' }],
      ['not an image', { ...SCREENSHOT, contentType: 'application/pdf' }],
      ['of unknown type', { ...SCREENSHOT, contentType: null }],
      ['too large', { ...SCREENSHOT, size: 21 * 1024 * 1024 }],
      ['empty', { ...SCREENSHOT, size: 0 }],
    ])('a screenshot %s', (_name, screenshot) => {
      const db = leagueDatabase();
      expect(recordResult(db, STAFF, { ...request, screenshot }, 9000)).toEqual({
        ok: false,
        error: 'invalid_screenshot',
      });
      expect(db.select().from(evidence).all()).toEqual([]);
      expect(db.select().from(match).all()[OPEN_MATCH - 1]?.status).toBe('scheduled');
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

describe('searchMatches', () => {
  const ids = (db: ReturnType<typeof leagueDatabase>, query: string, actor: Actor = STAFF) =>
    searchMatches(db, actor, query, 25).map((found) => found.id);

  it('lists the matches that can take a result, those still to play first', () => {
    // Match 2 is a forfeit: it is not offered.
    expect(ids(leagueDatabase(), '')).toEqual([3, 1, 4]);
  });

  it.each([
    ['brv', [3, 1]],
    ['BRV cha', [3]],
    ['l2', [4]],
    ['ligue 1', [3, 1]],
    ['s3', [3]],
    ['alpha esport', [1]],
    ['1', [3, 1]],
    ['s1 ligue', [1, 4]],
    ['nobody', []],
  ])('narrows by %j', (query, expected) => {
    expect(ids(leagueDatabase(), query)).toEqual(expected);
  });

  it('respects the limit', () => {
    expect(searchMatches(leagueDatabase(), STAFF, '', 2)).toHaveLength(2);
  });

  it('offers nothing to a member who is not staff, or outside a linked server', () => {
    expect(ids(leagueDatabase(), '', MEMBER)).toEqual([]);
    expect(ids(leagueDatabase(), '', { ...STAFF, guildId: null })).toEqual([]);
  });

  it('offers nothing while no season has left registration', () => {
    const db = leagueDatabase();
    db.update(season).set({ status: 'registration' }).run();
    expect(ids(db, '')).toEqual([]);
    expect(db.select().from(division).all()).toHaveLength(2);
    expect(db.select().from(stage).all()).toHaveLength(2);
  });
});
