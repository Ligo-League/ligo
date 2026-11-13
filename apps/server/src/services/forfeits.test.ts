import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { setAutoExclusion } from './exclusions.ts';
import { recordForfeit, searchForfeitableMatches } from './forfeits.ts';
import type { Actor } from './permissions.ts';
import { voidMatch } from './reports.ts';
import { getStandings } from './standings.ts';

const { auditLog, game, leagueGuild, match, sanction, season } = schema;

const QUEUE = '800000000000000001';
const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const MEMBER: Actor = { ...STAFF, memberRoleIds: [] };
const warningReason = (count: number) => `warning after ${count} forfeits`;
const exclusionReason = (count: number) => `excluded after ${count} forfeits`;
// In leagueDatabase(): match 1 is Alpha 7-4 Bravo (validated); match 2 is Charlie v Alpha, which
// Charlie (side A) forfeited; match 3 is Bravo v Charlie, to play.
const forfeit = (
  db: ReturnType<typeof leagueDatabase>,
  matchId: number,
  side: 'a' | 'b',
  actor: Actor = STAFF,
  now = 9000,
) => recordForfeit(db, actor, { matchId, side, warningReason, exclusionReason }, now);
const table = (db: ReturnType<typeof leagueDatabase>) => {
  const standings = getStandings(db, { guildId: TEST_GUILD, division: 'L1' });
  if (!standings.ok) throw new Error(standings.error);
  return Object.fromEntries(
    (standings.tables[0]?.rows ?? []).map((row) => [row.team.tag, [row.played, row.points]]),
  );
};

describe('recordForfeit', () => {
  it('records the forfeit and gives the opponent the win at once', () => {
    const db = leagueDatabase();
    expect(table(db)).toEqual({ ALP: [2, 6], CHA: [1, 0], BRV: [1, 0] });

    const reply = forfeit(db, 3, 'a');

    expect(reply).toMatchObject({ ok: true, side: 'a', count: 1, consequence: 'none' });
    expect(db.select().from(match).all()[2]).toMatchObject({
      status: 'forfeit',
      validatedAt: 9000,
    });
    expect(db.select().from(game).all().at(-1)).toMatchObject({
      matchId: 3,
      scoreA: 0,
      scoreB: 0,
      forfeitSide: 'a',
      status: 'final',
    });
    expect(table(db)).toEqual({ ALP: [2, 6], CHA: [2, 3], BRV: [2, 0] });
  });

  it('adds a warning sanction when the team reaches the warning threshold', () => {
    const db = leagueDatabase();
    // Charlie already forfeited match 2: this is its second forfeit.
    const reply = forfeit(db, 3, 'b');

    expect(reply).toMatchObject({ ok: true, count: 2, consequence: 'warning' });
    const staffPlayer = db.select().from(schema.player).get();
    expect(db.select().from(sanction).all()).toMatchObject([
      {
        seasonId: 1,
        targetKind: 'slot',
        targetId: 3,
        kind: 'warning',
        pointsDelta: null,
        matchId: 3,
        startsAt: 9000,
        reason: 'warning after 2 forfeits',
        decidedBy: staffPlayer?.id,
      },
    ]);
  });

  const exclusionAtTwo = (db: ReturnType<typeof leagueDatabase>) => {
    db.update(leagueGuild).set({ alertsChannelId: QUEUE }).run();
    db.update(season)
      .set({
        settingsJson: {
          forfeit_score: [0, 0],
          map_pool: [],
          forfeits: { warning_at: null, exclusion_at: 2 },
        },
      })
      .run();
  };
  const charlieSlot = (db: ReturnType<typeof leagueDatabase>) =>
    db.select().from(schema.slot).where(eq(schema.slot.teamId, 3)).get();

  it('excludes the team at the exclusion threshold, in the same transaction (O-05)', () => {
    const db = leagueDatabase();
    exclusionAtTwo(db);
    // Charlie's second forfeit. It played 0 of its 2 matches: every one becomes a forfeit win.
    expect(forfeit(db, 3, 'b')).toMatchObject({
      ok: true,
      count: 2,
      consequence: 'exclusion',
      queueChannelId: QUEUE,
      excluded: { teamId: 3, summary: { played: 0, total: 2, resultsStand: false } },
      autoExclusionOffReason: null,
    });
    expect(charlieSlot(db)).toMatchObject({ status: 'excluded', excludedAt: 9000 });
    expect(db.select().from(sanction).all()).toMatchObject([
      { kind: 'exclusion', reason: 'excluded after 2 forfeits', matchId: 3, endsAt: null },
    ]);
  });

  it('leaves a team alone when staff switched its automatic exclusion off, and says why', () => {
    const db = leagueDatabase();
    exclusionAtTwo(db);
    setAutoExclusion(db, STAFF, { teamId: 3, enabled: false, reason: 'Accord du staff' }, 100);
    expect(forfeit(db, 3, 'b')).toMatchObject({
      consequence: 'exclusion',
      excluded: null,
      autoExclusionOffReason: 'Accord du staff',
    });
    expect(charlieSlot(db)?.status).toBe('active');
    expect(db.select().from(sanction).all()).toEqual([]);
  });

  it('turns a validated result into a forfeit, and counts again after an annulment', () => {
    const db = leagueDatabase();
    // Alpha beat Bravo 7-4 in match 1; staff rule that Alpha forfeits it.
    expect(forfeit(db, 1, 'a')).toMatchObject({ ok: true, count: 1 });
    expect(db.select().from(game).all()[0]).toMatchObject({
      scoreA: 0,
      scoreB: 0,
      forfeitSide: 'a',
    });
    expect(table(db)).toEqual({ BRV: [1, 3], ALP: [2, 3], CHA: [1, 0] });

    // Annulling Charlie's earlier forfeit takes it out of the count.
    voidMatch(db, STAFF, { matchId: 2, reason: 'erreur' }, 9100);
    expect(forfeit(db, 3, 'b')).toMatchObject({ ok: true, count: 1, consequence: 'none' });
  });

  it('audits the forfeit with the count and what it called for', () => {
    const db = leagueDatabase();
    forfeit(db, 3, 'b');
    expect(db.select().from(auditLog).all().at(-1)).toMatchObject({
      actorKind: 'user',
      action: 'match.forfeit',
      entity: 'match',
      entityId: '3',
      beforeJson: { status: 'scheduled' },
      afterJson: { status: 'forfeit', forfeitedBy: 3, forfeits: 2, consequence: 'warning' },
      at: 9000,
    });
  });

  it.each([
    ['a member who is not staff', MEMBER, 3, 'not_staff'],
    ['a server that is not linked', { ...STAFF, guildId: null }, 3, 'not_linked'],
    ['an unknown match', STAFF, 99, 'match_not_found'],
    ['a match that is already a forfeit', STAFF, 2, 'wrong_status'],
  ] as const)('refuses %s and changes nothing', (_name, actor, matchId, error) => {
    const db = leagueDatabase();
    const before = db.$client.serialize().toString('base64');
    expect(forfeit(db, matchId, 'a', actor)).toEqual({ ok: false, error });
    expect(db.$client.serialize().toString('base64')).toBe(before);
  });

  it('refuses an annulled match and a series', () => {
    const db = leagueDatabase();
    voidMatch(db, STAFF, { matchId: 3, reason: 'x' }, 9000);
    expect(forfeit(db, 3, 'a')).toEqual({ ok: false, error: 'wrong_status' });
    db.update(match).set({ bestOf: 3 }).where(eq(match.id, 1)).run();
    expect(forfeit(db, 1, 'a')).toEqual({ ok: false, error: 'unsupported_series' });
  });

  it('rolls everything back when the audit entry cannot be written', () => {
    const db = leagueDatabase();
    db.$client.exec(
      "CREATE TRIGGER audit_fails BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END",
    );
    expect(() => forfeit(db, 3, 'b')).toThrow(/audit down/);
    expect(db.select().from(match).all()[2]?.status).toBe('scheduled');
    expect(db.select().from(sanction).all()).toEqual([]);
  });
});

describe('searchForfeitableMatches', () => {
  it('offers staff every match that is neither a forfeit nor annulled, those to play first', () => {
    const db = leagueDatabase();
    const ids = (query = '', actor: Actor = STAFF) =>
      searchForfeitableMatches(db, actor, query, 25).map((found) => found.id);
    expect(ids()).toEqual([3, 1, 4]);
    expect(ids('cha')).toEqual([3]);
    expect(ids('', MEMBER)).toEqual([]);
  });
});
