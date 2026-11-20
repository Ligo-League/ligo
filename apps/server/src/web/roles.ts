import { schema, type Db } from '@ligo/db';
import { asc, eq, inArray } from 'drizzle-orm';
import type { DiscordGateway } from '../discord/gateway.ts';
import type { MemberCheck } from '../services/registration-players.ts';
import { divisionStaffOf, type Actor } from '../services/permissions.ts';

// Who is league staff on the website: the members holding the staff role in the league's Discord
// server, asked of the bot, so Discord stays the only staff list (maintainer, 14 November 2026).
// Answers are kept a minute: a role removed in Discord stops counting within that minute.

export const ROLE_CACHE_MS = 60_000;
const MAX_CACHED = 1000;

/** The role IDs a user holds in a server; none when not a member or Discord cannot be asked. */
export type RoleReader = (
  guildId: string,
  userId: string,
  now: number,
) => Promise<readonly string[]>;

export function createRoleReader(
  gateway: Pick<DiscordGateway, 'memberRoleIds'>,
  ttlMs = ROLE_CACHE_MS,
): RoleReader {
  const cache = new Map<string, { at: number; roles: readonly string[] }>();
  return async (guildId, userId, now) => {
    const key = `${guildId}:${userId}`;
    const hit = cache.get(key);
    if (hit && now - hit.at < ttlMs) return hit.roles;
    let roles: readonly string[];
    try {
      roles = (await gateway.memberRoleIds(guildId, userId)) ?? [];
    } catch {
      // Discord unreachable, or the bot not connected yet: no role, and nothing kept, so the
      // next request asks again. Staff pages refuse rather than guess.
      return [];
    }
    cache.delete(key);
    cache.set(key, { at: now, roles });
    // A Map keeps insertion order: the first key is the oldest answer.
    if (cache.size > MAX_CACHED) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return roles;
  };
}

/**
 * Whether a user is a member of a server, asked of the bot each time: a player who has just
 * joined the server is let in at once (M-30). Null when Discord cannot be asked.
 */
export function createMemberCheck(gateway: Pick<DiscordGateway, 'memberRoleIds'>): MemberCheck {
  return async (guildId, userId) => {
    try {
      return (await gateway.memberRoleIds(guildId, userId)) !== null;
    } catch {
      return null;
    }
  };
}

export interface WebUser {
  playerId: number;
  name: string;
  /** Null for a player the website knows without a Discord account, who cannot be staff. */
  discordUserId: string | null;
}

/** The competitions whose league staff the user is, through each league's Discord server. */
export async function staffCompetitions(
  db: Pick<Db, 'select'>,
  roles: RoleReader,
  user: WebUser,
  now: number,
): Promise<{ id: number; name: string }[]> {
  const { discordUserId } = user;
  if (discordUserId === null) return [];
  const guilds = db
    .select({
      guildId: schema.leagueGuild.guildId,
      staffRoleId: schema.leagueGuild.staffRoleId,
      id: schema.competition.id,
      name: schema.competition.name,
    })
    .from(schema.leagueGuild)
    .innerJoin(schema.competition, eq(schema.leagueGuild.competitionId, schema.competition.id))
    .orderBy(asc(schema.competition.name))
    .all();
  const staff: { id: number; name: string }[] = [];
  for (const guild of guilds) {
    const held = await roles(guild.guildId, discordUserId, now);
    if (held.includes(guild.staffRoleId)) staff.push({ id: guild.id, name: guild.name });
  }
  return staff;
}

export interface StaffScope {
  id: number;
  name: string;
  /**
   * Null for league staff, who see the whole competition; else the divisions whose staff role
   * the user holds (M-05), by ID, with their names, who see those divisions' matches and teams.
   */
  divisions: { id: number; name: string }[] | null;
}

/**
 * Where the user is staff: each competition whose staff role they hold, and each where they hold
 * only some divisions' staff roles, with those divisions. One question to Discord per server.
 */
export async function staffScopes(
  db: Pick<Db, 'select'>,
  roles: RoleReader,
  user: WebUser,
  now: number,
): Promise<StaffScope[]> {
  const { discordUserId } = user;
  if (discordUserId === null) return [];
  const guilds = db
    .select({
      guildId: schema.leagueGuild.guildId,
      staffRoleId: schema.leagueGuild.staffRoleId,
      id: schema.competition.id,
      name: schema.competition.name,
    })
    .from(schema.leagueGuild)
    .innerJoin(schema.competition, eq(schema.leagueGuild.competitionId, schema.competition.id))
    .orderBy(asc(schema.competition.name))
    .all();
  const scopes: StaffScope[] = [];
  for (const guild of guilds) {
    const held = await roles(guild.guildId, discordUserId, now);
    if (held.includes(guild.staffRoleId)) {
      scopes.push({ id: guild.id, name: guild.name, divisions: null });
      continue;
    }
    const ids = divisionStaffOf(db, guild.id, held);
    if (ids.length === 0) continue;
    const divisions = db
      .select({ id: schema.division.id, name: schema.division.name })
      .from(schema.division)
      .where(inArray(schema.division.id, ids))
      .orderBy(asc(schema.division.level), asc(schema.division.name))
      .all();
    scopes.push({ id: guild.id, name: guild.name, divisions });
  }
  return scopes;
}

/**
 * The website's user as the services know an actor: in the competition's Discord server, with the
 * roles Discord gives them there. The services then check staff and teams as they do for the bot.
 */
export async function webActor(
  db: Pick<Db, 'select'>,
  roles: RoleReader,
  user: WebUser,
  competitionId: number,
  now: number,
): Promise<Actor | null> {
  const guild = db
    .select({ guildId: schema.leagueGuild.guildId })
    .from(schema.leagueGuild)
    .where(eq(schema.leagueGuild.competitionId, competitionId))
    .orderBy(asc(schema.leagueGuild.guildId))
    .get();
  if (!guild || user.discordUserId === null) return null;
  return {
    guildId: guild.guildId,
    user: { id: user.discordUserId, displayName: user.name },
    memberRoleIds: [...(await roles(guild.guildId, user.discordUserId, now))],
  };
}
