import { promotionSchema, vetoSchema } from '@ligo/core';
import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { teamsActedFor, type Actor } from './permissions.ts';
import {
  addTeamMember,
  listTeamStaff,
  removeTeamMember,
  searchTeams,
  setTeamOwner,
  showTeamStaff,
} from './team-staff.ts';

const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const member = (n: number) => ({ id: `70000000000000000${n}`, displayName: `Member ${n}` });
const asUser = (n: number): Pick<Actor, 'user'> => ({ user: member(n) });
// In leagueDatabase(): team 1 is Alpha Esport (ALP), team 2 Bravo, team 3 Charlie (Ligue 1);
// teams 4 and 5 are in Ligue 2.
const ALPHA = 1;
const BRAVO = 2;
const roles = (db: ReturnType<typeof leagueDatabase>, teamId: number) =>
  listTeamStaff(db, teamId).map((entry) => [entry.displayName, entry.role]);

describe('setTeamOwner', () => {
  it('makes the member owner and creates their player row', () => {
    const db = leagueDatabase();
    const reply = setTeamOwner(db, STAFF, { teamId: ALPHA, member: member(1) }, 5000);
    expect(reply).toMatchObject({
      ok: true,
      team: { teamId: ALPHA, tag: 'ALP', name: 'Alpha Esport' },
      members: [{ displayName: 'Member 1', role: 'owner', discordUserId: member(1).id }],
    });
    expect(teamsActedFor(db, asUser(1)).teams).toEqual([{ teamId: ALPHA, role: 'owner' }]);
  });

  it('replaces the previous owner, whose row keeps its end date', () => {
    const db = leagueDatabase();
    setTeamOwner(db, STAFF, { teamId: ALPHA, member: member(1) }, 5000);
    setTeamOwner(db, STAFF, { teamId: ALPHA, member: member(2) }, 6000);

    expect(roles(db, ALPHA)).toEqual([['Member 2', 'owner']]);
    expect(teamsActedFor(db, asUser(1)).teams).toEqual([]);
    expect(db.select().from(schema.teamStaff).all()).toMatchObject([
      { role: 'owner', since: 5000, until: 6000 },
      { role: 'owner', since: 6000, until: null },
    ]);
  });

  it('promotes a manager, who then leaves the managers', () => {
    const db = leagueDatabase();
    addTeamMember(db, STAFF, { teamId: ALPHA, member: member(1), role: 'manager' }, 5000);
    setTeamOwner(db, STAFF, { teamId: ALPHA, member: member(1) }, 6000);
    expect(roles(db, ALPHA)).toEqual([['Member 1', 'owner']]);
  });

  it('lets one person own two teams', () => {
    const db = leagueDatabase();
    setTeamOwner(db, STAFF, { teamId: ALPHA, member: member(1) }, 5000);
    setTeamOwner(db, STAFF, { teamId: BRAVO, member: member(1) }, 5000);
    expect(teamsActedFor(db, asUser(1)).teams).toEqual([
      { teamId: ALPHA, role: 'owner' },
      { teamId: BRAVO, role: 'owner' },
    ]);
  });

  it('refuses to set the current owner again', () => {
    const db = leagueDatabase();
    setTeamOwner(db, STAFF, { teamId: ALPHA, member: member(1) }, 5000);
    expect(setTeamOwner(db, STAFF, { teamId: ALPHA, member: member(1) }, 6000)).toEqual({
      ok: false,
      error: 'already_on_team',
    });
  });
});

describe('addTeamMember and removeTeamMember', () => {
  it('lists the owner, then managers, then the coach, oldest first', () => {
    const db = leagueDatabase();
    addTeamMember(db, STAFF, { teamId: ALPHA, member: member(4), role: 'coach' }, 4000);
    addTeamMember(db, STAFF, { teamId: ALPHA, member: member(2), role: 'manager' }, 5000);
    setTeamOwner(db, STAFF, { teamId: ALPHA, member: member(1) }, 6000);
    addTeamMember(db, STAFF, { teamId: ALPHA, member: member(3), role: 'manager' }, 7000);
    expect(roles(db, ALPHA)).toEqual([
      ['Member 1', 'owner'],
      ['Member 2', 'manager'],
      ['Member 3', 'manager'],
      ['Member 4', 'coach'],
    ]);
  });

  it("stops at the league's limit, which is a setting", () => {
    const db = leagueDatabase();
    for (const n of [1, 2, 3])
      addTeamMember(db, STAFF, { teamId: ALPHA, member: member(n), role: 'manager' }, n);
    expect(
      addTeamMember(db, STAFF, { teamId: ALPHA, member: member(4), role: 'manager' }, 9),
    ).toEqual({
      ok: false,
      error: 'role_full',
      max: 3,
    });
    // The owner and the coach have their own places.
    expect(setTeamOwner(db, STAFF, { teamId: ALPHA, member: member(4) }, 9).ok).toBe(true);
    const coach = { teamId: ALPHA, role: 'coach' } as const;
    expect(addTeamMember(db, STAFF, { ...coach, member: member(6) }, 9).ok).toBe(true);
    expect(addTeamMember(db, STAFF, { ...coach, member: member(7) }, 9)).toEqual({
      ok: false,
      error: 'role_full',
      max: 1,
    });

    db.update(schema.competition)
      .set({
        rulesetJson: {
          result_validation: 'staff',
          game_score: null,
          team_roles: { managers_max: 4, coaches_max: 1 },
          dispute_reasons: [],
          veto: vetoSchema.parse({}),
          promotion: promotionSchema.parse({}),
        },
      })
      .run();
    expect(
      addTeamMember(db, STAFF, { teamId: ALPHA, member: member(5), role: 'manager' }, 10).ok,
    ).toBe(true);
  });

  it('refuses someone already on the team, as owner or as manager', () => {
    const db = leagueDatabase();
    setTeamOwner(db, STAFF, { teamId: ALPHA, member: member(1) }, 5000);
    addTeamMember(db, STAFF, { teamId: ALPHA, member: member(2), role: 'manager' }, 5000);
    for (const n of [1, 2]) {
      expect(
        addTeamMember(db, STAFF, { teamId: ALPHA, member: member(n), role: 'manager' }, 6000),
      ).toEqual({
        ok: false,
        error: 'already_on_team',
      });
    }
  });

  it('removes a manager or even the owner, and they can come back later', () => {
    const db = leagueDatabase();
    setTeamOwner(db, STAFF, { teamId: ALPHA, member: member(1) }, 5000);
    addTeamMember(db, STAFF, { teamId: ALPHA, member: member(2), role: 'manager' }, 5000);

    expect(removeTeamMember(db, STAFF, { teamId: ALPHA, member: member(2) }, 6000)).toMatchObject({
      ok: true,
      members: [{ displayName: 'Member 1' }],
    });
    removeTeamMember(db, STAFF, { teamId: ALPHA, member: member(1) }, 6000);
    expect(roles(db, ALPHA)).toEqual([]);
    expect(teamsActedFor(db, asUser(1)).teams).toEqual([]);

    expect(
      addTeamMember(db, STAFF, { teamId: ALPHA, member: member(2), role: 'manager' }, 7000).ok,
    ).toBe(true);
  });

  it('refuses to remove someone who is not on the team', () => {
    const db = leagueDatabase();
    expect(removeTeamMember(db, STAFF, { teamId: ALPHA, member: member(9) }, 6000)).toEqual({
      ok: false,
      error: 'not_on_team',
    });
  });
});

describe('every change to team staff', () => {
  const change = [
    ['setTeamOwner', setTeamOwner],
    ['addTeamMember', addTeamMember],
    ['removeTeamMember', removeTeamMember],
  ] as const;

  it.each(change)('%s is refused for non-staff, unlinked servers and unknown teams', (_n, run) => {
    const db = leagueDatabase();
    const before = db.$client.serialize().toString('base64');
    const request = { teamId: ALPHA, member: member(1), role: 'manager' as const };
    expect(run(db, { ...STAFF, memberRoleIds: [] }, request, 1)).toEqual({
      ok: false,
      error: 'not_staff',
    });
    expect(run(db, { ...STAFF, guildId: null }, request, 1)).toEqual({
      ok: false,
      error: 'not_linked',
    });
    expect(run(db, STAFF, { ...request, teamId: 99 }, 1)).toEqual({
      ok: false,
      error: 'team_not_found',
    });
    expect(db.$client.serialize().toString('base64')).toBe(before);
  });

  it('writes an audit entry naming the staff member, with the staff before and after', () => {
    const db = leagueDatabase();
    setTeamOwner(db, STAFF, { teamId: ALPHA, member: member(1) }, 5000);
    addTeamMember(db, STAFF, { teamId: ALPHA, member: member(2), role: 'manager' }, 6000);
    removeTeamMember(db, STAFF, { teamId: ALPHA, member: member(1) }, 7000);

    const staffPlayer = db
      .select()
      .from(schema.player)
      .all()
      .find((row) => row.discordUserId === STAFF.user.id);
    const entries = db
      .select()
      .from(schema.auditLog)
      .all()
      .filter((row) => row.entity === 'team');
    expect(entries).toMatchObject([
      { action: 'team.owner.set', entityId: '1', at: 5000, beforeJson: { staff: [] } },
      { action: 'team.member.add', at: 6000 },
      {
        action: 'team.member.remove',
        at: 7000,
        actorKind: 'user',
        actorPlayerId: staffPlayer?.id,
        afterJson: { staff: [{ role: 'manager' }] },
      },
    ]);
  });

  it('rolls back when the audit entry cannot be written', () => {
    const db = leagueDatabase();
    db.$client.exec(
      "CREATE TRIGGER audit_fails BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END",
    );
    expect(() => setTeamOwner(db, STAFF, { teamId: ALPHA, member: member(1) }, 1)).toThrow(
      /audit down/,
    );
    expect(db.select().from(schema.teamStaff).all()).toEqual([]);
  });
});

describe('showTeamStaff and searchTeams', () => {
  it('shows a team to league staff only', () => {
    const db = leagueDatabase();
    setTeamOwner(db, STAFF, { teamId: ALPHA, member: member(1) }, 5000);
    expect(showTeamStaff(db, STAFF, ALPHA)).toMatchObject({
      ok: true,
      members: [{ displayName: 'Member 1', role: 'owner' }],
    });
    expect(showTeamStaff(db, { ...STAFF, memberRoleIds: [] }, ALPHA)).toEqual({
      ok: false,
      error: 'not_staff',
    });
  });

  it.each([
    ['', ['ALP', 'BRV', 'CHA', 'XRA', 'YAN']],
    ['al', ['ALP']],
    ['esport', ['ALP']],
    ['ligue 2', ['XRA', 'YAN']],
    ['zzz', []],
  ])('finds teams by %j', (query, tags) => {
    expect(searchTeams(leagueDatabase(), STAFF, query, 25).map((team) => team.tag)).toEqual(tags);
  });

  it('offers no team to a member who is not league staff', () => {
    expect(searchTeams(leagueDatabase(), { ...STAFF, memberRoleIds: [] }, '', 25)).toEqual([]);
  });
});

describe('teamsActedFor', () => {
  it('knows no team for a user the platform has never seen', () => {
    expect(teamsActedFor(leagueDatabase(), asUser(8))).toEqual({ playerId: null, teams: [] });
  });
});
