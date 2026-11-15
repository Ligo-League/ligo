import { schema, type Db } from '@ligo/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { DiscordGateway } from '../discord/gateway.ts';

// A league's Discord server, set on the website (design doc section 7; maintainer, 15 November
// 2026). Every league has its own server. Rights come from Discord: whoever may manage the
// league's current server (its owner, or Manage Server) changes the staff role and the server's
// invitation link, or moves the league to another server they also manage, where the bot is.
// A competition created on the website (phase 3h) is linked by its creator first; until then,
// `pnpm seed` links the staging server.

const { auditLog, competition, division, leagueGuild, season } = schema;

type Gateway = Pick<DiscordGateway, 'manageableGuilds' | 'guildRoles' | 'resolveInvite'>;

/** The logged-in user, by their Discord account. */
export interface DiscordAdmin {
  playerId: number;
  discordUserId: string | null;
}

const INVITE_HOSTS = new Set(['discord.gg', 'discord.com', 'www.discord.com']);

/** A Discord server invitation, as people share it: `https://discord.gg/…`. */
export function isDiscordInvite(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && INVITE_HOSTS.has(url.hostname) && url.pathname.length > 1;
  } catch {
    return false;
  }
}

type Reader = Pick<Db, 'select'>;

function linked(db: Reader, competitionSlug: string) {
  const found = db.select().from(competition).where(eq(competition.slug, competitionSlug)).get();
  if (!found) return null;
  const guild = db
    .select()
    .from(leagueGuild)
    .where(eq(leagueGuild.competitionId, found.id))
    .orderBy(asc(leagueGuild.guildId))
    .get();
  return { competition: found, guild: guild ?? null };
}

type Access =
  | {
      ok: true;
      found: NonNullable<ReturnType<typeof linked>>;
      guild: typeof leagueGuild.$inferSelect;
      servers: { id: string; name: string }[];
    }
  | { ok: false; error: 'not_found' | 'not_admin' | 'discord_unavailable' };

/** The competition, if the user may manage its server, with every server they manage. */
async function access(
  db: Reader,
  gateway: Gateway,
  user: DiscordAdmin,
  competitionSlug: string,
): Promise<Access> {
  const found = linked(db, competitionSlug);
  if (!found) return { ok: false, error: 'not_found' };
  if (!found.guild || user.discordUserId === null) return { ok: false, error: 'not_admin' };
  let servers: { id: string; name: string }[];
  try {
    servers = await gateway.manageableGuilds(user.discordUserId);
  } catch {
    return { ok: false, error: 'discord_unavailable' };
  }
  const { guild } = found;
  if (!servers.some((server) => server.id === guild.guildId)) {
    return { ok: false, error: 'not_admin' };
  }
  return { ok: true, found, guild, servers };
}

export type DiscordSettingsView =
  | {
      ok: true;
      competition: { id: number; name: string; slug: string };
      current: { guildId: string; staffRoleId: string; inviteUrl: string | null };
      /** The servers the user manages where the bot is: the league may move to one of them. */
      servers: { id: string; name: string }[];
      /** The server shown in the form, with the roles it offers as the staff role. */
      chosen: { id: string; name: string; roles: { id: string; name: string }[] };
    }
  | { ok: false; error: 'not_found' | 'not_admin' | 'discord_unavailable' };

/** The settings page: `chosenGuildId` shows another of the user's servers, to move to it. */
export async function discordSettings(
  db: Reader,
  gateway: Gateway,
  user: DiscordAdmin,
  competitionSlug: string,
  chosenGuildId: string | null,
): Promise<DiscordSettingsView> {
  const allowed = await access(db, gateway, user, competitionSlug);
  if (!allowed.ok) return allowed;
  const { found, guild, servers } = allowed;
  const chosen =
    servers.find((server) => server.id === chosenGuildId) ??
    servers.find((server) => server.id === guild.guildId);
  let roles: { id: string; name: string }[] | null;
  try {
    roles = chosen ? await gateway.guildRoles(chosen.id) : null;
  } catch {
    return { ok: false, error: 'discord_unavailable' };
  }
  if (!chosen || !roles) return { ok: false, error: 'discord_unavailable' };
  return {
    ok: true,
    competition: {
      id: found.competition.id,
      name: found.competition.name,
      slug: found.competition.slug,
    },
    current: { guildId: guild.guildId, staffRoleId: guild.staffRoleId, inviteUrl: guild.inviteUrl },
    servers,
    chosen: { ...chosen, roles },
  };
}

export interface DiscordSettingsChange {
  guildId: string;
  staffRoleId: string;
  inviteUrl: string;
}

export type SaveDiscordError =
  | 'not_found'
  | 'not_admin'
  | 'discord_unavailable'
  | 'server_not_managed'
  | 'server_taken'
  | 'invalid_role'
  | 'invite_required'
  | 'invalid_invite'
  | 'invite_other_server'
  | 'invite_expires';

/**
 * The league's server, staff role and invitation, checked against Discord: the server one the
 * user manages and no other competition uses, the role one of its own, and the invitation one to
 * that server that never expires, since players follow it for the whole season. Moving to
 * another server forgets the channels of the old one.
 */
export async function saveDiscordSettings(
  db: Db,
  gateway: Gateway,
  user: DiscordAdmin,
  competitionSlug: string,
  change: DiscordSettingsChange,
  now: number,
): Promise<{ ok: true } | { ok: false; error: SaveDiscordError }> {
  const allowed = await access(db, gateway, user, competitionSlug);
  if (!allowed.ok) return allowed;
  const { found, guild, servers } = allowed;
  const fail = (error: SaveDiscordError) => ({ ok: false as const, error });
  if (!servers.some((server) => server.id === change.guildId)) return fail('server_not_managed');
  const usedBy = (reader: Reader) =>
    reader
      .select({ competitionId: leagueGuild.competitionId })
      .from(leagueGuild)
      .where(eq(leagueGuild.guildId, change.guildId))
      .get();
  const taken = (reader: Reader) => {
    const other = usedBy(reader);
    return other !== undefined && other.competitionId !== found.competition.id;
  };
  if (taken(db)) return fail('server_taken');
  const inviteUrl = change.inviteUrl.trim();
  if (inviteUrl === '') return fail('invite_required');
  if (!isDiscordInvite(inviteUrl)) return fail('invalid_invite');
  try {
    const roles = await gateway.guildRoles(change.guildId);
    if (!roles?.some((role) => role.id === change.staffRoleId)) return fail('invalid_role');
    const invite = await gateway.resolveInvite(inviteUrl);
    if (!invite) return fail('invalid_invite');
    if (invite.guildId !== change.guildId) return fail('invite_other_server');
    if (invite.expiresAt !== null) return fail('invite_expires');
  } catch {
    return fail('discord_unavailable');
  }

  return db.transaction((tx) => {
    // Discord took a moment: another competition may have taken the server meanwhile.
    if (taken(tx)) return fail('server_taken');
    const moved = change.guildId !== guild.guildId;
    tx.update(leagueGuild)
      .set({
        guildId: change.guildId,
        staffRoleId: change.staffRoleId,
        inviteUrl,
        // Channel IDs belong to a server: on another one, staff choose them again.
        ...(moved
          ? {
              alertsChannelId: null,
              resultsChannelId: null,
              mercatoChannelId: null,
              scheduleChannelId: null,
            }
          : {}),
      })
      .where(eq(leagueGuild.guildId, guild.guildId))
      .run();
    if (moved) {
      const seasons = tx
        .select({ id: season.id })
        .from(season)
        .where(eq(season.competitionId, found.competition.id))
        .all()
        .map((row) => row.id);
      if (seasons.length > 0) {
        tx.update(division)
          .set({ resultsChannelId: null })
          .where(inArray(division.seasonId, seasons))
          .run();
      }
    }
    tx.insert(auditLog)
      .values({
        actorPlayerId: user.playerId,
        actorKind: 'user',
        action: 'league.discord',
        entity: 'competition',
        entityId: String(found.competition.id),
        beforeJson: {
          guildId: guild.guildId,
          staffRoleId: guild.staffRoleId,
          inviteUrl: guild.inviteUrl,
        },
        afterJson: { guildId: change.guildId, staffRoleId: change.staffRoleId, inviteUrl },
        at: now,
      })
      .run();
    return { ok: true as const };
  });
}

/** The competitions whose server the user may manage, for links on their own page. */
export async function adminCompetitions(
  db: Reader,
  gateway: Pick<DiscordGateway, 'manageableGuilds'>,
  discordUserId: string | null,
): Promise<{ name: string; slug: string }[]> {
  if (discordUserId === null) return [];
  let servers: { id: string }[];
  try {
    servers = await gateway.manageableGuilds(discordUserId);
  } catch {
    return [];
  }
  const ids = servers.map((server) => server.id);
  if (ids.length === 0) return [];
  return db
    .select({ name: competition.name, slug: competition.slug })
    .from(leagueGuild)
    .innerJoin(competition, eq(leagueGuild.competitionId, competition.id))
    .where(and(inArray(leagueGuild.guildId, ids)))
    .orderBy(asc(competition.name))
    .all();
}
