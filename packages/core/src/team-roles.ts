import type { TeamRolesSettings } from './settings.ts';

// Who acts for a team (maintainer, 13 November 2026): one owner, answerable to the league, and the
// managers and coaches its settings allow. All of them act in matches.

/** The people who act for a team: one owner, managers and coaches, within the league's limits. */
export const TEAM_ROLES = ['owner', 'manager', 'coach'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

/** The roles a request may add someone to; the owner changes only by a handover. */
export const ADDABLE_TEAM_ROLES = ['manager', 'coach'] as const;
export type AddableTeamRole = (typeof ADDABLE_TEAM_ROLES)[number];

export type RoleCounts = Record<TeamRole, number>;

/** A change to a team, as it would apply now: checked when filed, and again when approved. */
export type TeamChange =
  | { kind: 'team_member_add'; role: AddableTeamRole; subjectRole: TeamRole | null }
  | { kind: 'team_owner' | 'team_member_remove'; subjectRole: TeamRole | null };

export type SubjectError =
  | { ok: false; error: 'already_on_team' | 'not_on_team' | 'owner_cannot_leave' }
  | { ok: false; error: 'role_full'; max: number };

/** Whether the change still makes sense for the team as it is, and fits the league's limits. */
export function checkTeamChange(
  change: TeamChange,
  counts: RoleCounts,
  limits: TeamRolesSettings,
): { ok: true } | SubjectError {
  if (change.kind === 'team_member_add') {
    if (change.subjectRole !== null) return { ok: false, error: 'already_on_team' };
    const max = change.role === 'manager' ? limits.managers_max : limits.coaches_max;
    return counts[change.role] >= max ? { ok: false, error: 'role_full', max } : { ok: true };
  }
  if (change.kind === 'team_owner') {
    // Anyone may take the team over, including one of its managers or its coach.
    return change.subjectRole === 'owner' ? { ok: false, error: 'already_on_team' } : { ok: true };
  }
  if (change.subjectRole === null) return { ok: false, error: 'not_on_team' };
  if (change.subjectRole === 'owner') return { ok: false, error: 'owner_cannot_leave' };
  return { ok: true };
}
