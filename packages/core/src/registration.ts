import type { RegistrationSettings } from './settings.ts';

// Registering a roster (design doc section 7, "Registration"; maintainer, 14 November 2026).
// The filer gives the roster's details and shares an invitation; players join with their own
// account, and keep their own Ubisoft name, profileID and rank on their profile, which Ligo never
// looks up elsewhere. Pure checks: the server stores the registration and its players.

export type FieldErrors<E extends string> = { field: string; error: E }[];

export type RosterDetailsError = 'invalid_roster_name' | 'invalid_tag' | 'invalid_colors';

export interface RosterDetails {
  rosterName: string;
  tag: string;
  /** `#RRGGBB`, the first one the main colour. */
  colors: string[];
}

/** A roster shows 2 to 5 colours (maintainer, 14 November 2026); the first is the main one. */
export const ROSTER_COLORS_MIN = 2;
export const ROSTER_COLORS_MAX = 5;

const TAG = /^[A-Z0-9]{2,12}$/;
const COLOR = /^#[0-9A-F]{6}$/;

/** A roster's name, tag and colours, tidied: name trimmed, tag and colours in capitals. */
export function checkRosterDetails(
  input: Omit<RosterDetails, 'colors'> & { colors: readonly string[] },
): { ok: true; value: RosterDetails } | { ok: false; errors: FieldErrors<RosterDetailsError> } {
  const errors: FieldErrors<RosterDetailsError> = [];
  const rosterName = input.rosterName.trim();
  if (rosterName.length < 2 || rosterName.length > 40) {
    errors.push({ field: 'rosterName', error: 'invalid_roster_name' });
  }
  const tag = input.tag.trim().toUpperCase();
  if (!TAG.test(tag)) errors.push({ field: 'tag', error: 'invalid_tag' });
  const colors = input.colors.map((color) => color.trim().toUpperCase());
  if (
    colors.length < ROSTER_COLORS_MIN ||
    colors.length > ROSTER_COLORS_MAX ||
    !colors.every((color) => COLOR.test(color))
  ) {
    errors.push({ field: 'colors', error: 'invalid_colors' });
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: { rosterName, tag, colors } };
}

export type GameProfileError = 'invalid_name' | 'invalid_profile_id' | 'invalid_rank';

/** A player's account in a title, as they declare it; a replay confirms it later (M-23). */
export interface GameProfile {
  ubisoftName: string;
  /** The account's profileID, when the player has it (Ubisoft Connect shows it). */
  profileId: string | null;
  rank: string;
}

// Ubisoft names: letters, digits, dots, dashes and underscores, without spaces. The bounds are
// loose on purpose: a name Ligo refuses is a player who cannot register.
const UBISOFT_NAME = /^[A-Za-z0-9._-]{3,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A player's declared profile, tidied: name trimmed, profileID in lower case, or none. */
export function checkGameProfile(
  input: GameProfile,
  ranks: readonly string[],
): { ok: true; value: GameProfile } | { ok: false; errors: FieldErrors<GameProfileError> } {
  const errors: FieldErrors<GameProfileError> = [];
  const ubisoftName = input.ubisoftName.trim();
  if (!UBISOFT_NAME.test(ubisoftName)) errors.push({ field: 'ubisoftName', error: 'invalid_name' });
  const profileId = input.profileId?.trim().toLowerCase() || null;
  if (profileId !== null && !UUID.test(profileId)) {
    errors.push({ field: 'profileId', error: 'invalid_profile_id' });
  }
  if (!ranks.includes(input.rank)) errors.push({ field: 'rank', error: 'invalid_rank' });
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: { ubisoftName, profileId, rank: input.rank } };
}

export type RegistrationRole = 'player' | 'sub';

/** A player who joined a registration. */
export interface LineupMember {
  playerId: number;
  role: RegistrationRole;
  captain: boolean;
  /** Their profile is complete, and they gave stats consent where the league requires it. */
  ready: boolean;
}

export type LineupGap =
  | { gap: 'starters'; have: number; want: number }
  | { gap: 'subs'; have: number; max: number }
  | { gap: 'captain'; have: number }
  | { gap: 'not_ready'; playerIds: number[] };

/**
 * Whether a registration's players make a roster staff can approve: the league's number of
 * starters, no more substitutes than it allows, one captain, and every player ready.
 */
export function lineupStatus(
  members: readonly LineupMember[],
  settings: RegistrationSettings,
): { complete: boolean; gaps: LineupGap[] } {
  const gaps: LineupGap[] = [];
  const starters = members.filter((entry) => entry.role === 'player').length;
  if (starters !== settings.starters) {
    gaps.push({ gap: 'starters', have: starters, want: settings.starters });
  }
  const subs = members.length - starters;
  if (subs > settings.subs_max) gaps.push({ gap: 'subs', have: subs, max: settings.subs_max });
  const captains = members.filter((entry) => entry.captain).length;
  if (captains !== 1) gaps.push({ gap: 'captain', have: captains });
  const notReady = members.filter((entry) => !entry.ready).map((entry) => entry.playerId);
  if (notReady.length > 0) gaps.push({ gap: 'not_ready', playerIds: notReady });
  return { complete: gaps.length === 0, gaps };
}

/** Whether a player may join: once, and while the roster has room for starters and subs. */
export function mayJoin(
  members: readonly LineupMember[],
  playerId: number,
  settings: RegistrationSettings,
): { ok: true } | { ok: false; error: 'already_joined' | 'roster_full' } {
  if (members.some((entry) => entry.playerId === playerId)) {
    return { ok: false, error: 'already_joined' };
  }
  if (members.length >= settings.starters + settings.subs_max) {
    return { ok: false, error: 'roster_full' };
  }
  return { ok: true };
}
