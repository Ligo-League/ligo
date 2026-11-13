import { describe, expect, it } from 'vitest';
import { teamRolesSchema } from './settings.ts';
import { checkTeamChange, type RoleCounts } from './team-roles.ts';

// Who acts for a team (maintainer, 13 November 2026): one owner, and the managers and coaches the
// league allows. A change is checked when asked for, and again when staff approve it.

const LIMITS = teamRolesSchema.parse({});
const counts = (manager: number, coach: number): RoleCounts => ({ owner: 1, manager, coach });

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

describe('settings', () => {
  it('limits a team to 3 managers and 1 coach by default; a league can change both', () => {
    expect(LIMITS).toEqual({ managers_max: 3, coaches_max: 1 });
    expect(teamRolesSchema.parse({ coaches_max: 2 })).toEqual({ managers_max: 3, coaches_max: 2 });
    expect(teamRolesSchema.safeParse({ managers_max: -1 }).success).toBe(false);
  });
});
