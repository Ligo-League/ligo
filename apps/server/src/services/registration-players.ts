import type { RegistrationRole, RequestStatus } from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { and, asc, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { managesPlayers, rostersManagedBy } from './rosters.ts';

// The checks a registration's players go through beyond their own profile (design doc section 7;
// maintainer, 14 and 15 November 2026): each is a member of the league's Discord server (M-30)
// and plays in no other roster of the competition (O-29). Also each player's own list of the
// registrations they filed or play in, for `/me`.

const {
  club,
  competition,
  leagueGuild,
  player,
  registrationPlayer,
  request,
  rosterEntry,
  season,
  team,
} = schema;

type Reader = Pick<Db, 'select'>;

/**
 * Whether a Discord user is a member of a server: null when Discord cannot say (down, or the bot
 * not connected yet). Asked on every visit, so a player who just joined the server counts at once.
 */
export type MemberCheck = (guildId: string, discordUserId: string) => Promise<boolean | null>;

/** The league's Discord server and its public invitation, when the league has linked one. */
export function leagueServer(
  db: Reader,
  competitionId: number,
): { guildId: string; inviteUrl: string | null } | null {
  return (
    db
      .select({ guildId: leagueGuild.guildId, inviteUrl: leagueGuild.inviteUrl })
      .from(leagueGuild)
      .where(eq(leagueGuild.competitionId, competitionId))
      .orderBy(asc(leagueGuild.guildId))
      .get() ?? null
  );
}

/**
 * The players who are not members of the league's Discord server now (M-30), or null when
 * Discord cannot say. A league without a server has nobody to check.
 */
export async function notOnServer(
  db: Reader,
  memberOf: MemberCheck,
  competitionId: number,
  playerIds: readonly number[],
): Promise<number[] | null> {
  const server = leagueServer(db, competitionId);
  if (!server || playerIds.length === 0) return [];
  const accounts = db
    .select({ id: player.id, discordUserId: player.discordUserId })
    .from(player)
    .where(inArray(player.id, [...playerIds]))
    .all();
  const missing: number[] = [];
  for (const account of accounts) {
    const member =
      account.discordUserId === null
        ? false
        : await memberOf(server.guildId, account.discordUserId);
    if (member === null) return null;
    if (!member) missing.push(account.id);
  }
  return playerIds.filter((id) => missing.includes(id));
}

/**
 * The players already in another roster of the competition this season, every division
 * together (O-29): another registration still waiting, or a roster staff approved.
 */
export function unavailablePlayers(
  db: Reader,
  registration: { requestId: number; competitionId: number; seasonId: number },
  playerIds: readonly number[],
): number[] {
  if (playerIds.length === 0) return [];
  const inOther = db
    .select({ playerId: registrationPlayer.playerId })
    .from(registrationPlayer)
    .innerJoin(request, eq(registrationPlayer.requestId, request.id))
    .where(
      and(
        inArray(registrationPlayer.playerId, [...playerIds]),
        eq(request.competitionId, registration.competitionId),
        eq(request.kind, 'registration'),
        eq(request.status, 'pending'),
        ne(request.id, registration.requestId),
      ),
    )
    .all();
  const approved = db
    .select({ playerId: rosterEntry.playerId })
    .from(rosterEntry)
    .where(
      and(
        eq(rosterEntry.seasonId, registration.seasonId),
        inArray(rosterEntry.playerId, [...playerIds]),
        isNull(rosterEntry.validTo),
      ),
    )
    .all();
  const taken = new Set([...inOther, ...approved].map((row) => row.playerId));
  return playerIds.filter((id) => taken.has(id));
}

/**
 * Whether the player leads a registration: its filer, or any official who may register the
 * roster (owner, club managers, managers; maintainer, 15 November 2026). A registration filed
 * with its club before M-33 stays its filer's only.
 */
export function leadsRegistration(
  db: Reader,
  playerId: number,
  row: Pick<typeof request.$inferSelect, 'requestedBy' | 'teamId' | 'payloadJson'>,
): boolean {
  if (row.requestedBy === playerId) return true;
  return !('roster' in row.payloadJson) && row.teamId !== null
    ? managesPlayers(db, playerId, row.teamId)
    : false;
}

export interface RegistrationEntry {
  requestId: number;
  roster: string;
  competition: string;
  season: string;
  status: RequestStatus;
}

/** The roster a registration names: its `team_id` since M-33, its payload before. */
export function rosterNameOf(
  db: Reader,
  row: { teamId: number | null; payloadJson: typeof request.$inferSelect.payloadJson },
): string | null {
  const payload = row.payloadJson;
  if ('roster' in payload) return payload.roster.name;
  if (row.teamId === null) return null;
  return (
    db.select({ name: team.name }).from(team).where(eq(team.id, row.teamId)).get()?.name ?? null
  );
}

/**
 * The registrations a player leads (`leadsRegistration`), and those whose lineup they are in,
 * for their own page, newest first. Answered ones stay listed: the filer finds staff's answer, and its reason, there.
 */
export function registrationsOf(
  db: Reader,
  playerId: number,
): {
  filed: RegistrationEntry[];
  joined: (RegistrationEntry & { role: RegistrationRole })[];
} {
  const registrations = eq(request.kind, 'registration');
  const teams = rostersManagedBy(db, playerId);
  const managed = teams.length === 0 ? undefined : inArray(request.teamId, teams);
  const entryOf = (row: {
    request: typeof request.$inferSelect;
    competition: typeof competition.$inferSelect;
    season: typeof season.$inferSelect;
  }): RegistrationEntry[] => {
    const roster = rosterNameOf(db, row.request);
    return roster === null
      ? []
      : [
          {
            requestId: row.request.id,
            roster,
            competition: row.competition.name,
            season: row.season.name,
            status: row.request.status,
          },
        ];
  };
  const filed = db
    .select({ request, competition, season })
    .from(request)
    .innerJoin(competition, eq(request.competitionId, competition.id))
    .innerJoin(season, eq(request.seasonId, season.id))
    .where(and(registrations, or(eq(request.requestedBy, playerId), managed)))
    .orderBy(desc(request.id))
    .all()
    .filter((row) => leadsRegistration(db, playerId, row.request))
    .flatMap(entryOf);
  const joined = db
    .select({ entry: registrationPlayer, request, competition, season })
    .from(registrationPlayer)
    .innerJoin(request, eq(registrationPlayer.requestId, request.id))
    .innerJoin(competition, eq(request.competitionId, competition.id))
    .innerJoin(season, eq(request.seasonId, season.id))
    .where(and(registrations, eq(registrationPlayer.playerId, playerId)))
    .orderBy(desc(request.id))
    .all()
    .flatMap((row) => entryOf(row).map((entry) => ({ ...entry, role: row.entry.role })));
  return { filed, joined };
}

/** The club of a registration's roster, for its pages. */
export function clubNameOf(
  db: Reader,
  row: { teamId: number | null; payloadJson: typeof request.$inferSelect.payloadJson },
): string {
  const payload = row.payloadJson;
  if ('club' in payload) {
    return payload.club.kind === 'new'
      ? payload.club.name
      : (db.select({ name: club.name }).from(club).where(eq(club.id, payload.club.clubId)).get()
          ?.name ?? '?');
  }
  if (row.teamId === null) return '?';
  return (
    db
      .select({ name: club.name })
      .from(team)
      .innerJoin(club, eq(team.clubId, club.id))
      .where(eq(team.id, row.teamId))
      .get()?.name ?? '?'
  );
}
