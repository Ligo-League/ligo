import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { recordForfeit } from './forfeits.ts';
import { divisionStaffOf, requireStaff, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';
import { recordResult } from './results.ts';
import { addSanction } from './sanctions.ts';
import { setMatchTime } from './scheduling.ts';

// A division's staff (phase 4; design doc section 7; M-05): the holders of the role staff picked
// on the division's page act for that division's matches, results, forfeits, times, sanctions
// and team requests, and for nothing of another division or of the whole league.

const NOW = 1_800_000_000_000;
const STAFF_L1 = '800000000000000020';
const LIGUE_1_MATCH = 3;
const LIGUE_2_MATCH = 4;
const BRAVO = 2;
const XRAY = 4;

const actor = (roles: string[]): Actor => ({
  guildId: TEST_GUILD,
  user: { id: '730000000000000001', displayName: 'Lina' },
  memberRoleIds: roles,
});
const DIVISION_STAFF = actor([STAFF_L1]);
const PLAYER = actor([]);

function setUp() {
  const db = leagueDatabase();
  db.update(schema.division)
    .set({ staffRoleId: STAFF_L1 })
    .where(eq(schema.division.name, 'Ligue 1'))
    .run();
  return db;
}

describe('requireStaff with a division', () => {
  it('lets league staff in everywhere, with or without what the action is about', () => {
    const db = setUp();
    const staff = actor([TEST_STAFF_ROLE]);
    expect(requireStaff(db, staff)).toMatchObject({ ok: true, divisionOnly: false });
    expect(requireStaff(db, staff, { matchId: LIGUE_2_MATCH })).toMatchObject({ ok: true });
  });

  it('lets a division’s staff in for its matches and teams only, never for the whole league', () => {
    const db = setUp();
    expect(requireStaff(db, DIVISION_STAFF)).toEqual({ ok: false, error: 'not_staff' });
    expect(requireStaff(db, DIVISION_STAFF, { matchId: LIGUE_1_MATCH })).toMatchObject({
      ok: true,
      divisionOnly: true,
    });
    expect(requireStaff(db, DIVISION_STAFF, { teamId: BRAVO })).toMatchObject({ ok: true });
    expect(requireStaff(db, DIVISION_STAFF, { matchId: LIGUE_2_MATCH })).toEqual({
      ok: false,
      error: 'not_staff',
    });
    expect(requireStaff(db, DIVISION_STAFF, { teamId: XRAY })).toMatchObject({ ok: false });
    expect(requireStaff(db, DIVISION_STAFF, { matchId: 999 })).toMatchObject({ ok: false });
    expect(requireStaff(db, PLAYER, { matchId: LIGUE_1_MATCH })).toMatchObject({ ok: false });
  });

  it('follows a team’s request to the team’s division', () => {
    const db = setUp();
    const by = ensurePlayer(
      db,
      { orgId: 1, discordUserId: '730000000000000002', displayName: 'M' },
      1,
    ).id;
    const filed = (teamId: number) =>
      db
        .insert(schema.request)
        .values({
          competitionId: 1,
          teamId,
          kind: 'team_member_remove',
          payloadJson: { playerId: by },
          approval: 'staff',
          requestedBy: by,
          requestedAt: 1,
        })
        .returning()
        .get().id;
    expect(requireStaff(db, DIVISION_STAFF, { requestId: filed(BRAVO) })).toMatchObject({
      ok: true,
    });
    expect(requireStaff(db, DIVISION_STAFF, { requestId: filed(XRAY) })).toMatchObject({
      ok: false,
    });
  });

  it('lists the divisions whose role the member holds', () => {
    const db = setUp();
    const ligue1 = db
      .select()
      .from(schema.division)
      .where(eq(schema.division.name, 'Ligue 1'))
      .get();
    expect(divisionStaffOf(db, 1, [STAFF_L1])).toEqual([ligue1?.id]);
    expect(divisionStaffOf(db, 1, [])).toEqual([]);
  });
});

describe('what a division’s staff do', () => {
  it('set a time and enter a result in their division, and are refused in another', () => {
    const db = setUp();
    expect(
      setMatchTime(db, DIVISION_STAFF, { matchId: LIGUE_1_MATCH, at: NOW }, NOW),
    ).toMatchObject({ ok: true });
    expect(
      setMatchTime(db, DIVISION_STAFF, { matchId: LIGUE_2_MATCH, at: NOW }, NOW),
    ).toMatchObject({ ok: false, error: 'not_staff' });
    expect(
      recordResult(db, DIVISION_STAFF, { matchId: LIGUE_1_MATCH, scoreA: 7, scoreB: 3 }, NOW),
    ).toMatchObject({ ok: true });
    expect(
      recordResult(db, DIVISION_STAFF, { matchId: LIGUE_2_MATCH, scoreA: 7, scoreB: 3 }, NOW),
    ).toMatchObject({ ok: false, error: 'not_staff' });
  });

  it('record a forfeit and give a sanction in their division only', () => {
    const db = setUp();
    const reasons = { warningReason: () => 'w', exclusionReason: () => 'e' };
    expect(
      recordForfeit(db, DIVISION_STAFF, { matchId: LIGUE_2_MATCH, side: 'a', ...reasons }, NOW),
    ).toMatchObject({ ok: false, error: 'not_staff' });
    expect(
      recordForfeit(db, DIVISION_STAFF, { matchId: LIGUE_1_MATCH, side: 'a', ...reasons }, NOW),
    ).toMatchObject({ ok: true });
    const sanction = (teamId: number) =>
      addSanction(
        db,
        DIVISION_STAFF,
        { teamId, kind: 'warning', points: null, reason: 'Retard' },
        NOW,
      );
    expect(sanction(BRAVO)).toMatchObject({ ok: true });
    expect(sanction(XRAY)).toMatchObject({ ok: false, error: 'not_staff' });
  });
});
