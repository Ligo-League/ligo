import type { RegistrationRole } from '@ligo/core';
import { schema } from '@ligo/db';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  kairosRoster,
  LFR_KEY,
  registrationDatabase,
  TEST_GUILD,
  TEST_STAFF_ROLE,
} from '../testing.ts';
import type { Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';
import {
  approveRegistration,
  registrationsToApprove,
  rejectRegistration,
} from './registration-approval.ts';
import { setLineup } from './registration-lineup.ts';
import type { MemberCheck } from './registration-players.ts';
import { fileRegistration } from './registrations.ts';

// Staff approve a registration (design doc section 7; maintainer, 14 and 15 November 2026): its
// lineup complete, into a division with room (O-16, O-26), none of its players on another roster
// of the competition (O-29), each on the league's Discord server (M-30), the roster's officials
// within the league's limits. The roster exists already (M-33): approval gives it its place and
// the season's lineup. Staff may refuse with a reason.

const NOW = 10_000;
const LATER = 20_000;
const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const MEMBER: Actor = { ...STAFF, memberRoleIds: [] };
const always = () => Promise.resolve(true);

async function setup(starters = 5) {
  const db = registrationDatabase();
  const kairos = await kairosRoster(db, 6);
  const filed = fileRegistration(
    db,
    kairos.owner,
    LFR_KEY,
    { teamId: kairos.teamId, rulesVersionId: 1, rulesAccepted: true },
    NOW,
  );
  if (!filed.ok) throw new Error('not filed');
  const [captain = 0] = kairos.playerIds;
  setLineup(
    db,
    kairos.owner,
    filed.id,
    {
      roles: new Map<number, RegistrationRole>([
        ...kairos.playerIds.slice(0, starters).map((id) => [id, 'player'] as const),
        [kairos.playerIds[5] ?? 0, 'sub'],
      ]),
      captainId: captain,
    },
    NOW,
  );
  const season4 = db.select().from(schema.season).where(eq(schema.season.name, 'Saison 4')).get();
  const divisions = db
    .select()
    .from(schema.division)
    .where(eq(schema.division.seasonId, season4?.id ?? 0))
    .all();
  const ligue2 = divisions.find((entry) => entry.name === 'Ligue 2')?.id ?? 0;
  const approve = (memberOf: MemberCheck = always, divisionId = ligue2, actor = STAFF) =>
    approveRegistration(db, memberOf, actor, { requestId: filed.id, divisionId }, LATER);
  const discordOf = (playerId: number) =>
    db.select().from(schema.player).where(eq(schema.player.id, playerId)).get()?.discordUserId;
  return {
    db,
    ...kairos,
    requestId: filed.id,
    ligue2,
    season4Id: season4?.id ?? 0,
    approve,
    discordOf,
  };
}

describe('registrationsToApprove', () => {
  it('shows each registration with its roster, players and the divisions’ room', async () => {
    const { db, requestId, playerIds } = await setup();
    const [entry] = await registrationsToApprove(db, always, 1);
    expect(entry).toMatchObject({
      id: requestId,
      roster: { name: 'Kairos', tag: 'KRS', slug: 'kairos', colors: ['#112233', '#FFFFFF'] },
      club: 'Kairos Esport',
      filer: 'Ana',
      lineup: { complete: true },
      onOtherRoster: [],
      notOnServer: [],
    });
    expect(entry?.divisions.map((row) => [row.name, row.teams, row.max])).toEqual([
      ['Ligue 1', 0, 12],
      ['Ligue 2', 0, 12],
    ]);
    expect(entry?.players.map((player) => player.playerId).sort()).toEqual([...playerIds].sort());
    expect(entry?.players.find((player) => player.captain)).toMatchObject({
      playerId: playerIds[0],
      ubisoftName: 'Player1',
      rank: 'gold',
      nationality: 'FR',
      ready: true,
    });
  });

  it('says which players are not on the league’s Discord server, or that Discord cannot say', async () => {
    const { db, playerIds, discordOf } = await setup();
    const [first = 0] = playerIds;
    const notFirst = (_guild: string, user: string) => Promise.resolve(user !== discordOf(first));
    expect((await registrationsToApprove(db, notFirst, 1))[0]?.notOnServer).toEqual([first]);
    const down = () => Promise.resolve(null);
    expect((await registrationsToApprove(db, down, 1))[0]?.notOnServer).toBeNull();
  });
});

describe('approveRegistration', () => {
  it('gives the roster its place in the division and the season’s lineup, audited', async () => {
    const { db, teamId, playerIds, requestId, ligue2, season4Id, approve } = await setup();
    const teamsBefore = db.select().from(schema.team).all().length;
    expect(await approve()).toEqual({ ok: true, teamId });
    expect(db.select().from(schema.team).all()).toHaveLength(teamsBefore);
    expect(db.select().from(schema.slot).where(eq(schema.slot.teamId, teamId)).all()).toMatchObject(
      [{ divisionId: ligue2, status: 'active' }],
    );
    const entries = db
      .select()
      .from(schema.rosterEntry)
      .where(and(eq(schema.rosterEntry.teamId, teamId), eq(schema.rosterEntry.seasonId, season4Id)))
      .all();
    expect(entries.map((row) => [row.playerId, row.role, row.captain]).sort()).toEqual(
      [
        ...playerIds.slice(0, 5).map((id, index) => [id, 'player', index === 0]),
        [playerIds[5], 'sub', false],
      ].sort(),
    );
    expect(
      db.select().from(schema.request).where(eq(schema.request.id, requestId)).get(),
    ).toMatchObject({
      status: 'approved',
      teamId,
    });
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      action: 'registration.approve',
      afterJson: { status: 'approved', teamId, divisionId: ligue2 },
    });
    expect(await approve()).toEqual({ ok: false, error: 'not_found' });
  });

  it('waits for a complete lineup and every player on the league’s server', async () => {
    const { db, playerIds, approve, discordOf, season4Id } = await setup(4);
    const [first = 0] = playerIds;
    const notFirst = (_guild: string, user: string) => Promise.resolve(user !== discordOf(first));
    expect(await approve(notFirst)).toEqual({
      ok: false,
      error: 'not_approvable',
      reasons: [{ error: 'lineup_incomplete' }, { error: 'player_not_member', playerIds: [first] }],
    });
    expect(await approve(() => Promise.resolve(null))).toEqual({
      ok: false,
      error: 'discord_unavailable',
    });
    const season4Entries = db
      .select()
      .from(schema.rosterEntry)
      .where(eq(schema.rosterEntry.seasonId, season4Id))
      .all();
    expect(season4Entries).toEqual([]);
  });

  it('keeps the roster’s officials within the league’s limits', async () => {
    const { db, teamId, approve } = await setup();
    for (const n of [1, 2]) {
      const coach = ensurePlayer(
        db,
        {
          orgId: 1,
          discordUserId: `72000000000000000${String(n)}`,
          displayName: `Coach ${String(n)}`,
        },
        1,
      ).id;
      db.insert(schema.teamStaff)
        .values({ teamId, playerId: coach, role: 'coach', since: 1 })
        .run();
    }
    expect(await approve()).toEqual({
      ok: false,
      error: 'not_approvable',
      reasons: [{ error: 'too_many_officials', role: 'coach', have: 2, max: 1 }],
    });
  });

  it('is for the league’s staff only, into a division of the season', async () => {
    const { approve } = await setup();
    expect(await approve(always, 999)).toEqual({ ok: false, error: 'invalid_division' });
    expect(await approve(always, undefined, MEMBER)).toEqual({ ok: false, error: 'not_staff' });
  });
});

describe('rejectRegistration', () => {
  it('needs a reason, which the filer reads; staff only', async () => {
    const { db, requestId } = await setup();
    expect(rejectRegistration(db, STAFF, { requestId, reason: '  ' }, LATER)).toEqual({
      ok: false,
      error: 'reason_required',
    });
    expect(rejectRegistration(db, MEMBER, { requestId, reason: 'Non' }, LATER)).toEqual({
      ok: false,
      error: 'not_staff',
    });
    expect(
      rejectRegistration(db, STAFF, { requestId, reason: 'Logo non conforme' }, LATER),
    ).toEqual({
      ok: true,
    });
    expect(
      db.select().from(schema.request).where(eq(schema.request.id, requestId)).get(),
    ).toMatchObject({
      status: 'rejected',
      reason: 'Logo non conforme',
    });
  });
});
