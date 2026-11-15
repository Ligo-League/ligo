import type { RegistrationSettings } from './settings.ts';

// Registering a roster (design doc section 7, "Registration"; maintainer, 14 November 2026).
// The filer gives the roster's details and shares an invitation; players join with their own
// account, and keep their own Ubisoft name, profileID and rank on their profile, which Ligo never
// looks up elsewhere. Pure checks: the server stores the registration and its players.
// Joining (maintainer, 14 November 2026): one roster per competition (O-29), the captain a starter
// (O-30), a minimum age as a setting, counted on the season's first day (O-31, O-33), and lineups
// locked a set number of days before the season (M-29, O-32).

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
  | { gap: 'captain_not_starter' }
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
  const captains = members.filter((entry) => entry.captain);
  if (captains.length !== 1) gaps.push({ gap: 'captain', have: captains.length });
  else if (captains[0]?.role !== 'player') gaps.push({ gap: 'captain_not_starter' });
  const notReady = members.filter((entry) => !entry.ready).map((entry) => entry.playerId);
  if (notReady.length > 0) gaps.push({ gap: 'not_ready', playerIds: notReady });
  return { complete: gaps.length === 0, gaps };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date's parts; throws on anything else, which callers have checked before. */
function dateParts(date: string): [number, number, number] {
  const match = ISO_DATE.exec(date);
  if (!match) throw new RangeError(`Not a date: ${date}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Full years from a birth date to a date, both `YYYY-MM-DD`. */
export function ageOn(birthDate: string, on: string): number {
  const [birthYear, birthMonth, birthDay] = dateParts(birthDate);
  const [year, month, day] = dateParts(on);
  // Before the birthday's month and day, the year is not complete yet. Born on 29 February, a
  // player is a year older on 1 March of other years.
  const beforeBirthday = month < birthMonth || (month === birthMonth && day < birthDay);
  return year - birthYear - (beforeBirthday ? 1 : 0);
}

/** A birth date as a player types it: a real date, from 1900, not after today. */
export function checkBirthDate(
  input: string,
  today: string,
): { ok: true; value: string } | { ok: false; error: 'invalid_birth_date' } {
  const value = input.trim();
  const match = ISO_DATE.exec(value);
  const parsed = match ? new Date(`${value}T00:00:00Z`) : null;
  // `Date` rolls 30 February over to March: the date read back must be the one typed.
  const real =
    parsed !== null && !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  return real && value >= '1900-01-01' && value <= today
    ? { ok: true, value }
    : { ok: false, error: 'invalid_birth_date' };
}

/** Whether lineups are locked on `today`: from `lockDays` days before the season's first day. */
export function lineupLocked(today: string, seasonStartsOn: string, lockDays: number): boolean {
  const [year, month, day] = dateParts(seasonStartsOn);
  const lockOn = new Date(Date.UTC(year, month - 1, day - lockDays)).toISOString().slice(0, 10);
  return today >= lockOn;
}

/** What Ligo knows of a player, for whether they may play in a league. */
export interface PlayerProfile {
  /** Their account in the competition's title, with a rank. */
  gameAccount: boolean;
  nationality: string | null;
  statsConsent: boolean;
  birthDate: string | null;
}

export type PlayerGap =
  'game_account' | 'nationality' | 'stats_consent' | 'birth_date' | 'too_young';

/**
 * What keeps a player from playing in a league, all at once: their own details to complete, and
 * the league's minimum age on the season's first day.
 */
export function playerGaps(
  profile: PlayerProfile,
  settings: RegistrationSettings,
  seasonStartsOn: string,
): PlayerGap[] {
  const gaps: PlayerGap[] = [];
  if (!profile.gameAccount) gaps.push('game_account');
  if (profile.nationality === null) gaps.push('nationality');
  if (settings.stats_consent_required && !profile.statsConsent) gaps.push('stats_consent');
  if (settings.min_age !== null) {
    if (profile.birthDate === null) gaps.push('birth_date');
    else if (ageOn(profile.birthDate, seasonStartsOn) < settings.min_age) gaps.push('too_young');
  }
  return gaps;
}

export type JoinError =
  'already_joined' | 'lineup_locked' | 'roster_full' | 'in_other_registration';

/** A player opening an invitation, as the server found them. */
export interface Joiner {
  playerId: number;
  gaps: readonly PlayerGap[];
  /** They already play in another roster or registration of the same competition (O-29). */
  inOtherRegistration: boolean;
  locked: boolean;
}

/**
 * Whether a player may join, and as what: a starter while starters are missing, then a
 * substitute. The filer changes roles afterwards.
 */
export function mayJoin(
  members: readonly LineupMember[],
  joiner: Joiner,
  settings: RegistrationSettings,
):
  | { ok: true; role: RegistrationRole }
  | { ok: false; error: JoinError }
  | { ok: false; error: 'not_eligible'; gaps: PlayerGap[] } {
  if (members.some((entry) => entry.playerId === joiner.playerId)) {
    return { ok: false, error: 'already_joined' };
  }
  if (joiner.locked) return { ok: false, error: 'lineup_locked' };
  if (members.length >= settings.starters + settings.subs_max) {
    return { ok: false, error: 'roster_full' };
  }
  if (joiner.inOtherRegistration) return { ok: false, error: 'in_other_registration' };
  if (joiner.gaps.length > 0) return { ok: false, error: 'not_eligible', gaps: [...joiner.gaps] };
  const starters = members.filter((entry) => entry.role === 'player').length;
  return { ok: true, role: starters < settings.starters ? 'player' : 'sub' };
}

/** Whether a player may leave a registration: theirs, until the lineup locks. */
export function mayLeave(
  members: readonly LineupMember[],
  playerId: number,
  locked: boolean,
): { ok: true } | { ok: false; error: 'not_joined' | 'lineup_locked' } {
  if (!members.some((entry) => entry.playerId === playerId))
    return { ok: false, error: 'not_joined' };
  if (locked) return { ok: false, error: 'lineup_locked' };
  return { ok: true };
}

export type LineupChangeError =
  'unknown_player' | 'captain_not_starter' | 'too_many_starters' | 'too_many_subs';

/**
 * The filer sets roles and the captain: each role given is applied, the others stay. The captain
 * is a starter (O-30), or nobody while the lineup is built; the starters and substitutes stay
 * within the league's numbers.
 */
export function changeLineup<M extends LineupMember>(
  members: readonly M[],
  change: { roles: ReadonlyMap<number, RegistrationRole>; captainId: number | null },
  settings: RegistrationSettings,
): { ok: true; members: M[] } | { ok: false; error: LineupChangeError } {
  const known = (playerId: number) => members.some((entry) => entry.playerId === playerId);
  if ([...change.roles.keys()].some((playerId) => !known(playerId))) {
    return { ok: false, error: 'unknown_player' };
  }
  if (change.captainId !== null && !known(change.captainId)) {
    return { ok: false, error: 'unknown_player' };
  }
  const next = members.map((entry) => ({
    ...entry,
    role: change.roles.get(entry.playerId) ?? entry.role,
    captain: entry.playerId === change.captainId,
  }));
  if (next.some((entry) => entry.captain && entry.role !== 'player')) {
    return { ok: false, error: 'captain_not_starter' };
  }
  const starters = next.filter((entry) => entry.role === 'player').length;
  if (starters > settings.starters) return { ok: false, error: 'too_many_starters' };
  if (next.length - starters > settings.subs_max) return { ok: false, error: 'too_many_subs' };
  return { ok: true, members: next };
}
