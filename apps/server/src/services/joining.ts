import {
  lineupLocked,
  mayJoin,
  mayLeave,
  playerGaps,
  zonedDate,
  type JoinError,
  type PlayerGap,
  type RegistrationRole,
} from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { and, asc, eq, ne } from 'drizzle-orm';
import { inviteTokenMatches } from './invites.ts';
import { lineupOf, profilesOf } from './registrations.ts';

// Joining a registration from its invitation link (design doc section 7; maintainer, 14 and 15
// November 2026). Each player joins with their own account: their profile complete, old enough on
// the season's first day, a member of the league's Discord server (M-30), in no other roster of
// the competition (O-29), while the lineup is not locked (M-29). A player leaves the same way,
// until the lock.

const { auditLog, club, competition, leagueGuild, player, registrationInvite, registrationPlayer } =
  schema;
const { request, season } = schema;

type Reader = Pick<Db, 'select'>;

/**
 * Whether a Discord user is a member of a server: null when Discord cannot say (down, or the bot
 * not connected yet). Asked on every visit, so a player who just joined the server gets in.
 */
export type MemberCheck = (guildId: string, discordUserId: string) => Promise<boolean | null>;

/** The parts of an invitation link: its row, its token, and the secret the token is made with. */
export interface InviteLink {
  inviteId: number;
  token: string;
  secret: string;
}

/** The logged-in player opening the link. */
export interface Joining {
  id: number;
  discordUserId: string | null;
}

export type JoinState =
  | { kind: 'joined'; role: RegistrationRole }
  | { kind: 'can_join' }
  | { kind: 'refused'; error: Exclude<JoinError, 'already_joined'> }
  | { kind: 'not_eligible'; gaps: PlayerGap[]; minAge: number | null; seasonStartsOn: string }
  | { kind: 'not_member'; inviteUrl: string | null }
  | { kind: 'discord_unavailable' };

export interface JoinRegistration {
  id: number;
  competition: string;
  season: string;
  club: string;
  roster: { name: string; tag: string };
  filer: string;
}

export type JoinViewReply =
  | { ok: true; registration: JoinRegistration; state: JoinState }
  | { ok: false; error: 'invalid_link' };

/**
 * The registration behind a link while the link may be used: the token its own, neither
 * replaced nor expired, and the registration still waiting. Anything else is the same "invalid
 * link", so a link says nothing about why it stopped working.
 */
function openInvite(db: Reader, link: InviteLink, now: number) {
  const row = db
    .select({ invite: registrationInvite, request, competition, season })
    .from(registrationInvite)
    .innerJoin(request, eq(registrationInvite.requestId, request.id))
    .innerJoin(competition, eq(request.competitionId, competition.id))
    .innerJoin(season, eq(request.seasonId, season.id))
    .where(eq(registrationInvite.id, link.inviteId))
    .get();
  if (!row || !inviteTokenMatches(link.secret, row.invite, link.token)) return null;
  const payload = row.request.payloadJson;
  if (
    row.invite.revokedAt !== null ||
    row.invite.expiresAt <= now ||
    row.request.kind !== 'registration' ||
    row.request.status !== 'pending' ||
    !('roster' in payload)
  ) {
    return null;
  }
  return { ...row, payload };
}

type Opened = NonNullable<ReturnType<typeof openInvite>>;

/** Whether the season's lineups are locked today, in the league's time zone. */
function lockedNow(found: Pick<Opened, 'competition' | 'season'>, now: number): boolean {
  const today = zonedDate(now, found.competition.schedulingJson.time_zone).date;
  return lineupLocked(
    today,
    found.season.startsOn,
    found.competition.rulesetJson.registration.lineup_lock_days,
  );
}

/**
 * Whether the player plays in another roster of the competition, every division together
 * (O-29): for now another waiting registration; approved rosters join this check in phase 3d-4b.
 */
function inOtherRegistration(db: Reader, playerId: number, opened: Opened): boolean {
  return (
    db
      .select({ requestId: registrationPlayer.requestId })
      .from(registrationPlayer)
      .innerJoin(request, eq(registrationPlayer.requestId, request.id))
      .where(
        and(
          eq(registrationPlayer.playerId, playerId),
          eq(request.competitionId, opened.competition.id),
          eq(request.kind, 'registration'),
          eq(request.status, 'pending'),
          ne(request.id, opened.request.id),
        ),
      )
      .get() !== undefined
  );
}

function summaryOf(db: Reader, opened: Opened): JoinRegistration {
  const { payload } = opened;
  const clubName =
    payload.club.kind === 'new'
      ? payload.club.name
      : (db.select({ name: club.name }).from(club).where(eq(club.id, payload.club.clubId)).get()
          ?.name ?? '?');
  const filer = db
    .select({ name: player.displayName })
    .from(player)
    .where(eq(player.id, opened.request.requestedBy))
    .get();
  return {
    id: opened.request.id,
    competition: opened.competition.name,
    season: opened.season.name,
    club: clubName,
    roster: { name: payload.roster.name, tag: payload.roster.tag },
    filer: filer?.name ?? '?',
  };
}

/** What the league's rules say of this player joining, from the database alone. */
function decide(
  db: Reader,
  opened: Opened,
  joining: Joining,
  now: number,
): JoinState | { kind: 'may_join'; role: RegistrationRole } {
  const settings = opened.competition.rulesetJson.registration;
  const { title } = opened.competition;
  const members = lineupOf(db, opened.request.id, title, settings, opened.season.startsOn);
  const mine = members.find((entry) => entry.playerId === joining.id);
  if (mine) return { kind: 'joined', role: mine.role };
  const profile = profilesOf(db, [joining.id], title).get(joining.id);
  const gaps = profile
    ? playerGaps(profile, settings, opened.season.startsOn)
    : ['game_account' as const];
  const verdict = mayJoin(
    members,
    {
      playerId: joining.id,
      gaps,
      inOtherRegistration: inOtherRegistration(db, joining.id, opened),
      locked: lockedNow(opened, now),
    },
    settings,
  );
  if (verdict.ok) return { kind: 'may_join', role: verdict.role };
  if (verdict.error === 'not_eligible') {
    return {
      kind: 'not_eligible',
      gaps: verdict.gaps,
      minAge: settings.min_age,
      seasonStartsOn: opened.season.startsOn,
    };
  }
  // Answered above, from the members.
  if (verdict.error === 'already_joined') return { kind: 'joined', role: 'player' };
  return { kind: 'refused', error: verdict.error };
}

/** The league's Discord server, asked whether the player is in it; no server, nothing to ask. */
async function membership(
  db: Reader,
  memberOf: MemberCheck,
  opened: Opened,
  joining: Joining,
): Promise<JoinState | null> {
  const guild = db
    .select({ guildId: leagueGuild.guildId, inviteUrl: leagueGuild.inviteUrl })
    .from(leagueGuild)
    .where(eq(leagueGuild.competitionId, opened.competition.id))
    .orderBy(asc(leagueGuild.guildId))
    .get();
  if (!guild) return null;
  const member =
    joining.discordUserId === null ? false : await memberOf(guild.guildId, joining.discordUserId);
  if (member === null) return { kind: 'discord_unavailable' };
  return member ? null : { kind: 'not_member', inviteUrl: guild.inviteUrl };
}

/** The invitation page: the registration, and whether this player may join it now. */
export async function joinView(
  db: Reader,
  memberOf: MemberCheck,
  joining: Joining,
  link: InviteLink,
  now: number,
): Promise<JoinViewReply> {
  const opened = openInvite(db, link, now);
  if (!opened) return { ok: false, error: 'invalid_link' };
  const registration = summaryOf(db, opened);
  const decided = decide(db, opened, joining, now);
  if (decided.kind !== 'may_join') return { ok: true, registration, state: decided };
  const refused = await membership(db, memberOf, opened, joining);
  return { ok: true, registration, state: refused ?? { kind: 'can_join' } };
}

export type JoinReply =
  | { ok: true; requestId: number; role: RegistrationRole }
  | { ok: false; error: 'invalid_link' }
  | { ok: false; error: 'refused'; state: JoinState };

/**
 * The player joins: everything is checked again, Discord first, then the database inside the
 * transaction, so two players taking the last place at once cannot both get it.
 */
export async function joinRegistration(
  db: Db,
  memberOf: MemberCheck,
  joining: Joining,
  link: InviteLink,
  now: number,
): Promise<JoinReply> {
  const before = openInvite(db, link, now);
  if (!before) return { ok: false, error: 'invalid_link' };
  const first = decide(db, before, joining, now);
  if (first.kind !== 'may_join') return { ok: false, error: 'refused', state: first };
  const refused = await membership(db, memberOf, before, joining);
  if (refused) return { ok: false, error: 'refused', state: refused };

  return db.transaction((tx): JoinReply => {
    const opened = openInvite(tx, link, now);
    if (!opened) return { ok: false, error: 'invalid_link' };
    const decided = decide(tx, opened, joining, now);
    if (decided.kind !== 'may_join') return { ok: false, error: 'refused', state: decided };
    tx.insert(registrationPlayer)
      .values({
        requestId: opened.request.id,
        playerId: joining.id,
        role: decided.role,
        captain: false,
        joinedAt: now,
      })
      .run();
    tx.insert(auditLog)
      .values({
        actorPlayerId: joining.id,
        actorKind: 'user',
        action: 'registration.join',
        entity: 'request',
        entityId: String(opened.request.id),
        afterJson: { playerId: joining.id, role: decided.role },
        at: now,
      })
      .run();
    return { ok: true, requestId: opened.request.id, role: decided.role };
  });
}

/** A waiting registration with its competition and season, or nothing. */
function waitingRegistration(db: Reader, requestId: number) {
  const row = db
    .select({ request, competition, season })
    .from(request)
    .innerJoin(competition, eq(request.competitionId, competition.id))
    .innerJoin(season, eq(request.seasonId, season.id))
    .where(
      and(
        eq(request.id, requestId),
        eq(request.kind, 'registration'),
        eq(request.status, 'pending'),
      ),
    )
    .get();
  const payload = row?.request.payloadJson;
  return row && payload && 'roster' in payload ? { ...row, payload } : null;
}

/** The player leaves a registration they joined, until its lineup locks. */
export function leaveRegistration(
  db: Db,
  playerId: number,
  requestId: number,
  now: number,
): { ok: true } | { ok: false; error: 'not_found' | 'lineup_locked' } {
  return db.transaction((tx) => {
    const found = waitingRegistration(tx, requestId);
    if (!found) return { ok: false, error: 'not_found' };
    const settings = found.competition.rulesetJson.registration;
    const members = lineupOf(
      tx,
      requestId,
      found.competition.title,
      settings,
      found.season.startsOn,
    );
    const verdict = mayLeave(members, playerId, lockedNow(found, now));
    if (!verdict.ok) {
      return { ok: false, error: verdict.error === 'not_joined' ? 'not_found' : verdict.error };
    }
    const mine = members.find((entry) => entry.playerId === playerId);
    tx.delete(registrationPlayer)
      .where(
        and(eq(registrationPlayer.requestId, requestId), eq(registrationPlayer.playerId, playerId)),
      )
      .run();
    tx.insert(auditLog)
      .values({
        actorPlayerId: playerId,
        actorKind: 'user',
        action: 'registration.leave',
        entity: 'request',
        entityId: String(requestId),
        beforeJson: { playerId, role: mine?.role ?? null, captain: mine?.captain ?? false },
        at: now,
      })
      .run();
    return { ok: true };
  });
}

export interface RegistrationEntry {
  requestId: number;
  roster: string;
  competition: string;
  season: string;
}

/** The waiting registrations a player filed, and those they joined, for their own page. */
export function registrationsOf(
  db: Reader,
  playerId: number,
  now: number,
): {
  filed: RegistrationEntry[];
  joined: (RegistrationEntry & { role: RegistrationRole; canLeave: boolean })[];
} {
  const waiting = and(eq(request.kind, 'registration'), eq(request.status, 'pending'));
  const entryOf = (row: {
    request: typeof request.$inferSelect;
    competition: typeof competition.$inferSelect;
    season: typeof season.$inferSelect;
  }): RegistrationEntry[] => {
    const payload = row.request.payloadJson;
    return 'roster' in payload
      ? [
          {
            requestId: row.request.id,
            roster: payload.roster.name,
            competition: row.competition.name,
            season: row.season.name,
          },
        ]
      : [];
  };
  const filed = db
    .select({ request, competition, season })
    .from(request)
    .innerJoin(competition, eq(request.competitionId, competition.id))
    .innerJoin(season, eq(request.seasonId, season.id))
    .where(and(waiting, eq(request.requestedBy, playerId)))
    .orderBy(asc(request.id))
    .all()
    .flatMap(entryOf);
  const joined = db
    .select({ entry: registrationPlayer, request, competition, season })
    .from(registrationPlayer)
    .innerJoin(request, eq(registrationPlayer.requestId, request.id))
    .innerJoin(competition, eq(request.competitionId, competition.id))
    .innerJoin(season, eq(request.seasonId, season.id))
    .where(and(waiting, eq(registrationPlayer.playerId, playerId)))
    .orderBy(asc(request.id))
    .all()
    .flatMap((row) =>
      entryOf(row).map((entry) => ({
        ...entry,
        role: row.entry.role,
        canLeave: !lockedNow(row, now),
      })),
    );
  return { filed, joined };
}
