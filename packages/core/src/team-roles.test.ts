import { describe, expect, it } from 'vitest';
import { teamRolesSchema } from './settings.ts';
import {
  actsForSide,
  mayNameMatchCaptain,
  checkTeamChange,
  roleLevel,
  type MatchRoleHeld,
  type RoleCounts,
  type RoleHeld,
} from './team-roles.ts';

// Who acts for a team (maintainer, 13 and 14 November 2026): the club's owner and managers, who act
// for every roster of the club, and each roster's managers and coaches, within the limits the
// group and the league allow. A change is checked when asked for, and again when staff approve it.

const LIMITS = { ...teamRolesSchema.parse({}), club_managers_max: 2 };
const counts = (manager: number, coach: number, clubManager = 0): RoleCounts => ({
  owner: 1,
  club_manager: clubManager,
  manager,
  coach,
});

describe('checkTeamChange', () => {
  it('adds within the limits of the league', () => {
    const add = { kind: 'team_member_add', role: 'manager', subjectRole: null } as const;
    expect(checkTeamChange(add, counts(2, 0), LIMITS)).toEqual({ ok: true });
    expect(checkTeamChange(add, counts(3, 0), LIMITS)).toEqual({
      ok: false,
      error: 'role_full',
      max: 3,
    });
    expect(checkTeamChange({ ...add, role: 'coach' }, counts(0, 1), LIMITS)).toEqual({
      ok: false,
      error: 'role_full',
      max: 1,
    });
  });

  it('adds club managers within the group’s own limit', () => {
    const add = { kind: 'team_member_add', role: 'club_manager', subjectRole: null } as const;
    expect(checkTeamChange(add, counts(3, 1, 1), LIMITS)).toEqual({ ok: true });
    expect(checkTeamChange(add, counts(0, 0, 2), LIMITS)).toEqual({
      ok: false,
      error: 'role_full',
      max: 2,
    });
  });

  it('refuses to add someone already on the team, whatever their role', () => {
    expect(
      checkTeamChange(
        { kind: 'team_member_add', role: 'coach', subjectRole: 'manager' },
        counts(1, 0),
        LIMITS,
      ),
    ).toEqual({ ok: false, error: 'already_on_team' });
  });

  it('hands the team to anyone but its owner, a member of the team or not', () => {
    const owner = { kind: 'team_owner', subjectRole: null } as const;
    expect(checkTeamChange(owner, counts(3, 1), LIMITS)).toEqual({ ok: true });
    expect(checkTeamChange({ ...owner, subjectRole: 'manager' }, counts(3, 1), LIMITS)).toEqual({
      ok: true,
    });
    expect(checkTeamChange({ ...owner, subjectRole: 'owner' }, counts(3, 1), LIMITS)).toEqual({
      ok: false,
      error: 'already_on_team',
    });
  });

  it('removes only a member of the team, never its owner', () => {
    const remove = { kind: 'team_member_remove', subjectRole: 'coach' } as const;
    expect(checkTeamChange(remove, counts(0, 1), LIMITS)).toEqual({ ok: true });
    expect(checkTeamChange({ ...remove, subjectRole: null }, counts(0, 1), LIMITS)).toEqual({
      ok: false,
      error: 'not_on_team',
    });
    expect(checkTeamChange({ ...remove, subjectRole: 'owner' }, counts(0, 1), LIMITS)).toEqual({
      ok: false,
      error: 'owner_cannot_leave',
    });
  });
});

describe('roleLevel', () => {
  it('puts the owner and club managers at the club, managers and coaches on one roster', () => {
    expect(roleLevel('owner')).toBe('club');
    expect(roleLevel('club_manager')).toBe('club');
    expect(roleLevel('manager')).toBe('roster');
    expect(roleLevel('coach')).toBe('roster');
  });

  it('puts the captain on their roster (M-19)', () => {
    expect(roleLevel('captain')).toBe('roster');
  });
});

describe('actsForSide', () => {
  // Greed's rosters are teams 1 and 2 (club 10); Nova's is team 3 (club 20).
  const GREED_V_NOVA = { a: { teamId: 1 }, b: { teamId: 3 } };
  const GREED_V_GREED = { a: { teamId: 1 }, b: { teamId: 2 } };
  const greedOwner: RoleHeld[] = [
    { teamId: 1, clubId: 10, role: 'owner' },
    { teamId: 2, clubId: 10, role: 'owner' },
  ];

  it('lets club officials act for any roster of their club', () => {
    expect(actsForSide(greedOwner, GREED_V_NOVA, 'a')).toBe(true);
    expect(actsForSide(greedOwner, GREED_V_NOVA, 'b')).toBe(false);
  });

  it('lets club officials act for neither side when two of their rosters meet', () => {
    expect(actsForSide(greedOwner, GREED_V_GREED, 'a')).toBe(false);
    expect(actsForSide(greedOwner, GREED_V_GREED, 'b')).toBe(false);
  });

  it('still lets a roster’s own officials act for it, in a match between two of the club', () => {
    const coach: RoleHeld[] = [...greedOwner, { teamId: 2, clubId: 10, role: 'coach' }];
    expect(actsForSide(coach, GREED_V_GREED, 'a')).toBe(false);
    expect(actsForSide(coach, GREED_V_GREED, 'b')).toBe(true);
  });

  it('counts officials of two different clubs for both sides, as before', () => {
    const both: RoleHeld[] = [
      { teamId: 1, clubId: 10, role: 'manager' },
      { teamId: 3, clubId: 20, role: 'owner' },
    ];
    expect(actsForSide(both, GREED_V_NOVA, 'a')).toBe(true);
    expect(actsForSide(both, GREED_V_NOVA, 'b')).toBe(true);
  });

  // The captain acts in matches for their roster like its officials (M-19, maintainer,
  // 14 November 2026).
  it('lets a captain act for their roster only', () => {
    const captain: MatchRoleHeld[] = [{ teamId: 1, clubId: 10, role: 'captain' }];
    expect(actsForSide(captain, GREED_V_NOVA, 'a')).toBe(true);
    expect(actsForSide(captain, GREED_V_NOVA, 'b')).toBe(false);
    expect(actsForSide(captain, GREED_V_GREED, 'a')).toBe(true);
    expect(actsForSide(captain, GREED_V_GREED, 'b')).toBe(false);
  });

  it('lets the club’s owner, captain of one roster, act for that roster when two of the club meet', () => {
    const ownerCaptain: MatchRoleHeld[] = [
      ...greedOwner,
      { teamId: 2, clubId: 10, role: 'captain' },
    ];
    expect(actsForSide(ownerCaptain, GREED_V_GREED, 'a')).toBe(false);
    expect(actsForSide(ownerCaptain, GREED_V_GREED, 'b')).toBe(true);
  });

  // The captain for one match (O-30, O-30b, maintainer, 14 and 15 November 2026).
  it('counts a captaincy held for one match in that match only', () => {
    const standIn: MatchRoleHeld[] = [{ teamId: 1, clubId: 10, role: 'captain', matchId: 7 }];
    expect(actsForSide(standIn, { id: 7, ...GREED_V_NOVA }, 'a')).toBe(true);
    expect(actsForSide(standIn, { id: 7, ...GREED_V_NOVA }, 'b')).toBe(false);
    expect(actsForSide(standIn, { id: 8, ...GREED_V_NOVA }, 'a')).toBe(false);
    // Without its ID, the match is not that one.
    expect(actsForSide(standIn, GREED_V_NOVA, 'a')).toBe(false);
  });
});

// The captain for one match (O-30b): the side's officials or its usual captain name a starter or
// a substitute of the season's lineup, until the result is reported; the usual captain keeps
// acting, and a stand-in names nobody.
describe('mayNameMatchCaptain', () => {
  const MATCH = { id: 7, status: 'scheduled', a: { teamId: 1 }, b: { teamId: 3 } };
  const manager: MatchRoleHeld[] = [{ teamId: 1, clubId: 10, role: 'manager' }];
  const captain: MatchRoleHeld[] = [{ teamId: 1, clubId: 10, role: 'captain' }];
  const standIn: MatchRoleHeld[] = [{ teamId: 1, clubId: 10, role: 'captain', matchId: 7 }];
  const sub = { inLineup: true, usualCaptain: false };

  it('lets the side’s officials and its usual captain name a player of the lineup, or nobody', () => {
    expect(mayNameMatchCaptain(manager, MATCH, 'a', sub)).toEqual({ ok: true });
    expect(mayNameMatchCaptain(captain, MATCH, 'a', sub)).toEqual({ ok: true });
    expect(mayNameMatchCaptain(manager, MATCH, 'a', null)).toEqual({ ok: true });
  });

  it('refuses a stand-in, the other side and anyone else', () => {
    for (const held of [standIn, [], manager]) {
      const side = held === manager ? 'b' : 'a';
      expect(mayNameMatchCaptain(held, MATCH, side, sub)).toEqual({
        ok: false,
        error: 'not_allowed',
      });
    }
  });

  it('takes a player of the lineup who is not the usual captain already', () => {
    expect(
      mayNameMatchCaptain(manager, MATCH, 'a', { inLineup: false, usualCaptain: false }),
    ).toEqual({ ok: false, error: 'not_in_lineup' });
    expect(
      mayNameMatchCaptain(manager, MATCH, 'a', { inLineup: true, usualCaptain: true }),
    ).toEqual({ ok: false, error: 'usual_captain' });
  });

  it('closes once the result is reported', () => {
    for (const status of ['reported', 'validated', 'forfeit', 'void']) {
      expect(mayNameMatchCaptain(manager, { ...MATCH, status }, 'a', sub)).toEqual({
        ok: false,
        error: 'match_closed',
      });
    }
  });
});

describe('settings', () => {
  it('limits a team to 3 managers and 1 coach by default; a league can change both', () => {
    expect(teamRolesSchema.parse({})).toEqual({ managers_max: 3, coaches_max: 1 });
    expect(teamRolesSchema.parse({ coaches_max: 2 })).toEqual({ managers_max: 3, coaches_max: 2 });
    expect(teamRolesSchema.safeParse({ managers_max: -1 }).success).toBe(false);
  });
});
