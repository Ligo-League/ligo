import type { PlayerGap, PlayerProfile } from './registration.ts';
import type { TeamRole } from './team-roles.ts';

// A roster's own players, before any competition (M-33, M-34, maintainer, 15 November 2026).
// Each joins through the roster's invitation link with their own account, as for a
// registration; the league's own conditions are checked when the roster registers for it.

/** What a player completes on `/me` before joining a roster: what every league asks. */
export function rosterGaps(profile: PlayerProfile): PlayerGap[] {
  const gaps: PlayerGap[] = [];
  if (!profile.gameAccount) gaps.push('game_account');
  if (profile.nationality === null) gaps.push('nationality');
  return gaps;
}

export type RosterJoinError =
  'already_on_roster' | 'roster_closed' | 'roster_full' | 'incomplete_profile';

/** A player opening a roster's invitation, as the server found them and the roster. */
export interface RosterJoiner {
  onRoster: boolean;
  gaps: readonly PlayerGap[];
  /** The roster's players now, and the group's maximum (M-34). */
  count: number;
  max: number;
  /** Whether the roster's players may change now (`rosterOpen`). */
  open: boolean;
}

export function mayJoinRoster(
  joiner: RosterJoiner,
): { ok: true } | { ok: false; error: RosterJoinError } {
  if (joiner.onRoster) return { ok: false, error: 'already_on_roster' };
  if (!joiner.open) return { ok: false, error: 'roster_closed' };
  if (joiner.count >= joiner.max) return { ok: false, error: 'roster_full' };
  if (joiner.gaps.length > 0) return { ok: false, error: 'incomplete_profile' };
  return { ok: true };
}

type SeasonStatus = 'registration' | 'active' | 'cup' | 'closed';

/**
 * Whether a roster's players may change: not while it plays in a season under way, whose
 * lineup changes only in a mercato window (M-29). `statuses` are those of the seasons it has a
 * place in.
 */
export function rosterOpen(statuses: readonly SeasonStatus[]): boolean {
  return !statuses.some((status) => status === 'active' || status === 'cup');
}

/** Who manages a roster's players and its invitation: the officials who may add officials. */
export function mayManagePlayers(role: TeamRole): boolean {
  return role !== 'coach';
}
