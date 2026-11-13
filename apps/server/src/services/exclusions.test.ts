import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { excludeTeam, reinstateTeam, setAutoExclusion } from './exclusions.ts';
import type { Actor } from './permissions.ts';
import { proposeTime } from './scheduling.ts';
import { getStandings } from './standings.ts';
import { setTeamOwner } from './team-staff.ts';

const { auditLog, sanction, slot } = schema;

const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const MEMBER: Actor = {
  ...STAFF,
  user: { id: '700000000000000001', displayName: 'M' },
  memberRoleIds: [],
};
// In leagueDatabase(), Ligue 1: Alpha 7-4 Bravo (match 1), Charlie forfeited against Alpha
// (match 2), Bravo v Charlie to play (match 3). Bravo is team 2.
const BRAVO = 2;
const rowsOf = (db: ReturnType<typeof leagueDatabase>) => {
  const standings = getStandings(db, { guildId: TEST_GUILD, division: 'L1' });
  if (!standings.ok) throw new Error(standings.error);
  return Object.fromEntries(
    (standings.tables[0]?.rows ?? []).map((row) => [
      row.team.tag,
      { rank: row.rank, points: row.points, excluded: row.excluded },
    ]),
  );
};
const bravoSlot = (db: ReturnType<typeof leagueDatabase>) =>
  db.select().from(slot).where(eq(slot.teamId, BRAVO)).get();

describe('excludeTeam', () => {
  it('excludes a team: status, sanction, audit, and the 50% rule in the standings', () => {
    const db = leagueDatabase();
    const reply = excludeTeam(db, STAFF, { teamId: BRAVO, reason: 'Triche' }, 5000);
    // Bravo played 1 of its 2 matches: exactly half, so its loss to Alpha stands and the match
    // to play becomes a forfeit win for Charlie.
    expect(reply).toMatchObject({
      ok: true,
      team: { name: 'Bravo' },
      reason: 'Triche',
      excluded: { summary: { played: 1, total: 2, resultsStand: true } },
    });
    expect(bravoSlot(db)).toMatchObject({ status: 'excluded', excludedAt: 5000 });
    expect(db.select().from(sanction).all()).toMatchObject([
      { kind: 'exclusion', reason: 'Triche', endsAt: null },
    ]);
    expect(rowsOf(db)).toEqual({
      ALP: { rank: 1, points: 6, excluded: false },
      CHA: { rank: 2, points: 3, excluded: false },
      BRV: { rank: 3, points: 0, excluded: true },
    });
  });

  it('refuses a member, a missing reason and a second exclusion', () => {
    const db = leagueDatabase();
    expect(excludeTeam(db, MEMBER, { teamId: BRAVO, reason: 'x' }, 1)).toEqual({
      ok: false,
      error: 'not_staff',
    });
    expect(excludeTeam(db, STAFF, { teamId: BRAVO, reason: '  ' }, 1)).toEqual({
      ok: false,
      error: 'reason_required',
    });
    excludeTeam(db, STAFF, { teamId: BRAVO, reason: 'x' }, 1);
    expect(excludeTeam(db, STAFF, { teamId: BRAVO, reason: 'x' }, 2)).toEqual({
      ok: false,
      error: 'already_excluded',
    });
  });

  it('stops the excluded team’s matches: no time can be proposed', () => {
    const db = leagueDatabase();
    setTeamOwner(db, STAFF, { teamId: BRAVO, member: MEMBER.user }, 100);
    excludeTeam(db, STAFF, { teamId: BRAVO, reason: 'x' }, 1);
    expect(
      proposeTime(
        db,
        MEMBER,
        { matchId: 3, at: Date.parse('2026-11-05T20:00:00Z') },
        Date.parse('2026-11-03T12:00:00Z'),
      ),
    ).toEqual({ ok: false, error: 'team_excluded' });
  });
});

describe('reinstateTeam', () => {
  it('reverses an exclusion on appeal: every match counts as it is again', () => {
    const db = leagueDatabase();
    const before = rowsOf(db);
    excludeTeam(db, STAFF, { teamId: BRAVO, reason: 'x' }, 1);
    expect(reinstateTeam(db, STAFF, { teamId: BRAVO, reason: 'Appel accepté' }, 2)).toMatchObject({
      ok: true,
      reason: 'Appel accepté',
    });
    expect(bravoSlot(db)).toMatchObject({ status: 'active', excludedAt: null });
    expect(db.select().from(sanction).all()).toMatchObject([{ kind: 'exclusion', endsAt: 2 }]);
    expect(rowsOf(db)).toEqual(before);
    const actions = db
      .select()
      .from(auditLog)
      .all()
      .map((entry) => entry.action);
    expect(actions).toContain('slot.exclude');
    expect(actions).toContain('slot.reinstate');
  });

  it('refuses a team that is not excluded', () => {
    expect(reinstateTeam(leagueDatabase(), STAFF, { teamId: BRAVO, reason: 'x' }, 1)).toEqual({
      ok: false,
      error: 'not_excluded',
    });
  });
});

describe('setAutoExclusion', () => {
  it('switches it off with a reason, and back on, staff only', () => {
    const db = leagueDatabase();
    expect(setAutoExclusion(db, MEMBER, { teamId: BRAVO, enabled: false, reason: 'x' }, 1)).toEqual(
      {
        ok: false,
        error: 'not_staff',
      },
    );
    expect(
      setAutoExclusion(db, STAFF, { teamId: BRAVO, enabled: false, reason: 'Absence prévue' }, 10),
    ).toMatchObject({ ok: true, enabled: false });
    expect(bravoSlot(db)).toMatchObject({
      autoExclusionOffReason: 'Absence prévue',
      autoExclusionOffAt: 10,
    });
    expect(setAutoExclusion(db, STAFF, { teamId: BRAVO, enabled: false, reason: 'x' }, 11)).toEqual(
      {
        ok: false,
        error: 'already_set',
      },
    );
    expect(
      setAutoExclusion(db, STAFF, { teamId: BRAVO, enabled: true, reason: 'Fin' }, 12),
    ).toMatchObject({ ok: true, enabled: true });
    expect(bravoSlot(db)).toMatchObject({
      autoExclusionOffReason: null,
      autoExclusionOffBy: null,
      autoExclusionOffAt: null,
    });
  });
});
