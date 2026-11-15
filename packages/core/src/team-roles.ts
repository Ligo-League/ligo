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

/**
 * The roles that act in matches: the officials', and the roster's captain, a starter who acts
 * like its officials in matches only (M-19) and has no say over the team's officials.
 */
export type MatchRole = TeamRole | 'captain';

export type RoleLevel = 'club' | 'roster';

/** Where a role is held: at the club, for all its rosters, or on one roster. */
export function roleLevel(role: MatchRole): RoleLevel {
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

/** A role someone holds for a roster in matches: an official's, or the captain's. */
export interface MatchRoleHeld {
  teamId: number;
  clubId: number;
  role: MatchRole;
  /** Set for the captain of one match only (O-30b): the role counts in that match alone. */
  matchId?: number;
}

type Side = 'a' | 'b';

/**
 * Whether these roles let someone act for `side` of a match. A club official acts for neither
 * side of a match between two rosters of their club: each roster's own officials do (M-22). A
 * role held for one match counts in that match only.
 */
export function actsForSide(
  held: readonly MatchRoleHeld[],
  match: { id?: number; a: { teamId: number }; b: { teamId: number } },
  side: Side,
): boolean {
  const opponent = match[side === 'a' ? 'b' : 'a'].teamId;
  const here = held.filter((mine) => mine.matchId === undefined || mine.matchId === match.id);
  return here.some(
    (mine) =>
      mine.teamId === match[side].teamId &&
      (roleLevel(mine.role) === 'roster' ||
        !here.some(
          (theirs) =>
            theirs.teamId === opponent &&
            theirs.clubId === mine.clubId &&
            roleLevel(theirs.role) === 'club',
        )),
  );
}

export type MatchCaptainError = 'not_allowed' | 'match_closed' | 'not_in_lineup' | 'usual_captain';

/**
 * Whether someone may name the captain of one match for `side` (O-30, O-30b): the side's
 * officials or its usual captain, never a stand-in, until the result is reported. The player is
 * a starter or a substitute of the side's season lineup, other than its usual captain, who acts
 * anyway; `null` names nobody, back to the usual captain alone.
 */
export function mayNameMatchCaptain(
  held: readonly MatchRoleHeld[],
  match: { id: number; status: string; a: { teamId: number }; b: { teamId: number } },
  side: Side,
  candidate: { inLineup: boolean; usualCaptain: boolean } | null,
): { ok: true } | { ok: false; error: MatchCaptainError } {
  const lasting = held.filter((mine) => mine.matchId === undefined);
  if (!actsForSide(lasting, match, side)) return { ok: false, error: 'not_allowed' };
  if (match.status !== 'scheduled') return { ok: false, error: 'match_closed' };
  if (candidate === null) return { ok: true };
  if (!candidate.inLineup) return { ok: false, error: 'not_in_lineup' };
  if (candidate.usualCaptain) return { ok: false, error: 'usual_captain' };
  return { ok: true };
}
