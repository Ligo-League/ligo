import type { TeamRolesSettings } from './settings.ts';

// Who acts for a team (maintainer, 13 and 14 November 2026), at two levels. The club's owner,
// answerable to the league, and its managers act for every roster of the club; a roster's own
// managers and coaches act for that roster. All of them act in matches.

/** Every role, highest first: the club's two, then a roster's two. */
export const TEAM_ROLES = ['owner', 'club_manager', 'manager', 'coach'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/** The roles a request may add someone to; the owner changes only by a handover. */
export const ADDABLE_TEAM_ROLES = ['club_manager', 'manager', 'coach'] as const;
export type AddableTeamRole = (typeof ADDABLE_TEAM_ROLES)[number];

export type RoleLevel = 'club' | 'roster';

/** Where a role is held: at the club, for all its rosters, or on one roster. */
export function roleLevel(role: TeamRole): RoleLevel {
  return role === 'owner' || role === 'club_manager' ? 'club' : 'roster';
}

export type RoleCounts = Record<TeamRole, number>;

/** The league's limits for a roster, and the group's for a club's managers. */
export type RoleLimits = TeamRolesSettings & { club_managers_max: number };

/** A change to a team, as it would apply now: checked when filed, and again when approved. */
export type TeamChange =
  | { kind: 'team_member_add'; role: AddableTeamRole; subjectRole: TeamRole | null }
  | { kind: 'team_owner' | 'team_member_remove'; subjectRole: TeamRole | null };

export type SubjectError =
  | { ok: false; error: 'already_on_team' | 'not_on_team' | 'owner_cannot_leave' }
  | { ok: false; error: 'role_full'; max: number };

const MAX_OF: Record<AddableTeamRole, keyof RoleLimits> = {
  club_manager: 'club_managers_max',
  manager: 'managers_max',
  coach: 'coaches_max',
};

/**
 * Whether the change still makes sense for the team as it is, and fits the limits. `counts` are
 * the club's for its roles and the roster's for its own.
 */
export function checkTeamChange(
  change: TeamChange,
  counts: RoleCounts,
  limits: RoleLimits,
): { ok: true } | SubjectError {
  if (change.kind === 'team_member_add') {
    if (change.subjectRole !== null) return { ok: false, error: 'already_on_team' };
    const max = limits[MAX_OF[change.role]];
    return counts[change.role] >= max ? { ok: false, error: 'role_full', max } : { ok: true };
  }
  if (change.kind === 'team_owner') {
    // Anyone may take the club over, including one of its officials.
    return change.subjectRole === 'owner' ? { ok: false, error: 'already_on_team' } : { ok: true };
  }
  if (change.subjectRole === null) return { ok: false, error: 'not_on_team' };
  if (change.subjectRole === 'owner') return { ok: false, error: 'owner_cannot_leave' };
  return { ok: true };
}

/** A role someone holds for a roster; a club role is held for each roster of the club. */
export interface RoleHeld {
  teamId: number;
  clubId: number;
  role: TeamRole;
}

type Side = 'a' | 'b';

/**
 * Whether these roles let someone act for `side` of a match. A club official acts for neither
 * side of a match between two rosters of their club: each roster's own officials do (M-22).
 */
export function actsForSide(
  held: readonly RoleHeld[],
  match: { a: { teamId: number }; b: { teamId: number } },
  side: Side,
): boolean {
  const opponent = match[side === 'a' ? 'b' : 'a'].teamId;
  return held.some(
    (mine) =>
      mine.teamId === match[side].teamId &&
      (roleLevel(mine.role) === 'roster' ||
        !held.some(
          (theirs) =>
            theirs.teamId === opponent &&
            theirs.clubId === mine.clubId &&
            roleLevel(theirs.role) === 'club',
        )),
  );
}
