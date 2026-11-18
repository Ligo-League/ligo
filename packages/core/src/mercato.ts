import type { RegistrationRole } from './registration.ts';
import type { MercatoSettings, RegistrationSettings } from './settings.ts';

// The mercato (design doc section 7; O-35 and M-22, maintainer, 16 and 19 November 2026): how a
// season's lineup changes once it is locked. A move is one player out, one in, or a swap, which
// counts once. Whether a move needs a window, counts against a limit and how long the incoming
// player waits are the league's settings; staff may make an exception at any time.

const HOUR_MS = 3_600_000;

/** A window staff opened for one season; `closedEarlyAt` when they closed it before its end. */
export interface MercatoWindow {
  opensAt: number;
  closesAt: number;
  closedEarlyAt: number | null;
  /** Null: no limit. */
  maxMovesPerTeam: number | null;
  lockHours: number;
}

/** Whether moves can be filed in the window at `at`: from its opening to its (early) close. */
export function windowOpenAt(window: MercatoWindow, at: number): boolean {
  return window.opensAt <= at && at < (window.closedEarlyAt ?? window.closesAt);
}

/** One place in a season's lineup. */
export interface LineupPlace {
  playerId: number;
  role: RegistrationRole;
  captain: boolean;
}

/** A move a roster asks for: who leaves, who arrives and in which role. At least one of the two. */
export interface MoveRequest {
  outId: number | null;
  in: { playerId: number; role: RegistrationRole } | null;
}

/** What the server found around a move, for the rules to decide. */
export interface MoveContext {
  settings: MercatoSettings;
  registration: Pick<RegistrationSettings, 'starters' | 'subs_max'>;
  /** Before `lineup_lock_days` ahead of the season, lineups change freely (M-29). */
  lineupLocked: boolean;
  /** The season's window open when the move was filed, if any. */
  window: MercatoWindow | null;
  /** When the move was filed: staff may answer after its window closed. */
  filedAt: number;
  /** The roster's counted moves pending or approved, in the window or (always open) the season. */
  movesCounted: number;
  /** The roster's lineup now, blocked incoming players included. */
  lineup: readonly LineupPlace[];
  /** The roster's own players (M-33): joining it was the incoming player's consent. */
  rosterPlayerIds: readonly number[];
  /** Another roster of the competition whose lineup the incoming player leaves, if any. */
  from: { teamId: number; sameClub: boolean } | null;
  /** A staff exception (O-35): no window, not counted. */
  byStaff: boolean;
}

export type MoveError =
  | 'empty_move'
  | 'not_in_lineup'
  | 'captain_leaving'
  | 'not_on_roster'
  | 'already_in_lineup'
  | 'intra_club_closed'
  | 'window_closed'
  | 'limit_reached'
  | 'too_many_starters'
  | 'too_many_subs';

export type MoveCheck =
  | {
      ok: true;
      /** Whether it counts against the team's limit. */
      counted: boolean;
      /** How long the incoming player waits after approval. */
      lockHours: number;
      /** The roster the incoming player leaves, told when the move is approved. */
      transferFrom: number | null;
    }
  | { ok: false; error: MoveError };

/**
 * Whether a roster may make a move, checked when it is filed and again when it is approved. The
 * lineup's own rules (who is in it, the captain, the numbers) hold for staff too; the window, the
 * limit and closed moves inside a club do not bind a staff exception.
 */
export function checkMove(move: MoveRequest, context: MoveContext): MoveCheck {
  const fail = (error: MoveError): MoveCheck => ({ ok: false, error });
  if (move.outId === null && move.in === null) return fail('empty_move');
  const { lineup, settings } = context;
  const inLineup = (playerId: number) => lineup.some((place) => place.playerId === playerId);

  if (move.outId !== null) {
    const leaving = lineup.find((place) => place.playerId === move.outId);
    if (!leaving) return fail('not_in_lineup');
    // The team names another captain first, a change that is no move.
    if (leaving.captain) return fail('captain_leaving');
  }
  if (move.in) {
    if (!context.rosterPlayerIds.includes(move.in.playerId)) return fail('not_on_roster');
    if (inLineup(move.in.playerId)) return fail('already_in_lineup');
  }

  const after = [
    ...lineup.filter((place) => place.playerId !== move.outId),
    ...(move.in ? [{ ...move.in, captain: false }] : []),
  ];
  const starters = after.filter((place) => place.role === 'player').length;
  if (starters > context.registration.starters) return fail('too_many_starters');
  if (after.length - starters > context.registration.subs_max) return fail('too_many_subs');

  const transferFrom = move.in ? (context.from?.teamId ?? null) : null;
  if (!context.lineupLocked) return { ok: true, counted: false, lockHours: 0, transferFrom };

  const intraClub = move.in !== null && context.from?.sameClub === true;
  const windowed = settings.mode === 'windows';
  const lockHours = windowed && context.window ? context.window.lockHours : settings.lock_hours;
  if (context.byStaff) return { ok: true, counted: false, lockHours, transferFrom };
  if (intraClub && settings.intra_club_moves === 'closed') return fail('intra_club_closed');
  if (intraClub && settings.intra_club_moves === 'free') {
    return { ok: true, counted: false, lockHours, transferFrom };
  }

  if (windowed && !(context.window && windowOpenAt(context.window, context.filedAt))) {
    return fail('window_closed');
  }
  const max = windowed ? (context.window?.maxMovesPerTeam ?? null) : settings.max_moves_per_team;
  if (max !== null && context.movesCounted >= max) return fail('limit_reached');
  return { ok: true, counted: true, lockHours, transferFrom };
}

/** When an incoming player may play: `lockHours` full hours after the move's approval. */
export function moveStart(approvedAt: number, lockHours: number): number {
  return approvedAt + lockHours * HOUR_MS;
}

/** Whether a roster entry counts at `at`: from its start (after any block) until its end. */
export function entryActiveAt(
  entry: { validFrom: number; validTo: number | null },
  at: number,
): boolean {
  return entry.validFrom <= at && (entry.validTo === null || at < entry.validTo);
}

export type RoleChange = { playerId: number; role: RegistrationRole } | { captainId: number };
export type RoleChangeError =
  'not_in_lineup' | 'captain_not_starter' | 'too_many_starters' | 'too_many_subs';

/**
 * A starter becoming a substitute or back, or a new captain: no move, allowed at any time
 * (O-35), within the lineup's rules. The captain stays a starter (O-30) and is the only one.
 */
export function changeLineupRole(
  lineup: readonly LineupPlace[],
  change: RoleChange,
  settings: Pick<RegistrationSettings, 'starters' | 'subs_max'>,
): { ok: true; lineup: LineupPlace[] } | { ok: false; error: RoleChangeError } {
  const playerId = 'captainId' in change ? change.captainId : change.playerId;
  const place = lineup.find((entry) => entry.playerId === playerId);
  if (!place) return { ok: false, error: 'not_in_lineup' };
  if ('captainId' in change) {
    if (place.role !== 'player') return { ok: false, error: 'captain_not_starter' };
    return {
      ok: true,
      lineup: lineup.map((entry) => ({ ...entry, captain: entry.playerId === playerId })),
    };
  }
  if (place.captain && change.role !== 'player') {
    return { ok: false, error: 'captain_not_starter' };
  }
  const after = lineup.map((entry) =>
    entry.playerId === playerId ? { ...entry, role: change.role } : { ...entry },
  );
  const starters = after.filter((entry) => entry.role === 'player').length;
  if (starters > settings.starters) return { ok: false, error: 'too_many_starters' };
  if (after.length - starters > settings.subs_max) return { ok: false, error: 'too_many_subs' };
  return { ok: true, lineup: after };
}
