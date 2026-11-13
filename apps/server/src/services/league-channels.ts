import { schema, type Db, type GuildLeague, type LeagueMatch } from '@ligo/db';
import { eq } from 'drizzle-orm';
import type { DiscordGateway } from '../discord/gateway.ts';
import { requireStaff, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';

const { auditLog, division, leagueGuild } = schema;

/** The channels the bot posts in by itself, each stored by ID. */
export const LEAGUE_CHANNEL_KINDS = ['staff_queue', 'results'] as const;
export type LeagueChannelKind = (typeof LEAGUE_CHANNEL_KINDS)[number];

const COLUMN = {
  // Reports waiting for staff, and alerts meant for staff only.
  staff_queue: 'alertsChannelId',
  // Validated results, visible to everyone.
  results: 'resultsChannelId',
} as const satisfies Record<LeagueChannelKind, keyof typeof leagueGuild.$inferSelect>;

/**
 * Where a match's result is announced: its division's own channel, else the league's. Two
 * divisions may share a channel; a cup stage with no division uses the league's.
 */
export function resultsChannelFor(
  league: Pick<GuildLeague, 'guild'>,
  found: Pick<LeagueMatch, 'division'>,
): string | null {
  return found.division?.resultsChannelId ?? league.guild.resultsChannelId;
}

export interface SetLeagueChannelRequest {
  kind: LeagueChannelKind;
  /** Null removes a division's own channel; the league's then applies again. */
  channelId: string | null;
  /** A division of the current season, for its results only. */
  divisionId?: number | null;
  /** The message posted in the channel first, given the division's name when there is one. */
  notice: (divisionName: string | null) => string;
}

export type SetLeagueChannelError =
  | 'not_linked'
  | 'not_staff'
  | 'cannot_post'
  | 'channel_required'
  | 'division_not_found'
  | 'queue_per_division';

export type SetLeagueChannelReply =
  | {
      ok: true;
      kind: LeagueChannelKind;
      channelId: string | null;
      division: { id: number; name: string } | null;
    }
  | { ok: false; error: SetLeagueChannelError };

/**
 * Stores which channel the bot uses for one purpose, for the whole league or, for results, for
 * one division. The bot first posts a notice there: a channel it cannot write to is refused now,
 * not on the evening a result needs validating.
 */
export async function setLeagueChannel(
  db: Db,
  gateway: DiscordGateway,
  actor: Actor,
  request: SetLeagueChannelRequest,
  now: number,
): Promise<SetLeagueChannelReply> {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const { league } = staff;

  const divisionId = request.divisionId ?? null;
  // Staff validate every division's reports in one place.
  if (divisionId !== null && request.kind !== 'results') {
    return { ok: false, error: 'queue_per_division' };
  }
  const target =
    divisionId === null
      ? null
      : league.divisions.find((candidate) => candidate.division.id === divisionId)?.division;
  if (divisionId !== null && !target) return { ok: false, error: 'division_not_found' };
  // Only a division's channel can be removed: the league's is what everything falls back to.
  if (request.channelId === null && !target) return { ok: false, error: 'channel_required' };

  if (request.channelId !== null) {
    try {
      await gateway.postMessage(request.channelId, {
        content: request.notice(target?.name ?? null),
      });
    } catch {
      return { ok: false, error: 'cannot_post' };
    }
  }

  db.transaction((tx) => {
    const staffPlayer = ensurePlayer(
      tx,
      { orgId: league.org.id, discordUserId: actor.user.id, displayName: actor.user.displayName },
      now,
    );
    let before: string | null;
    if (target) {
      before = target.resultsChannelId;
      tx.update(division)
        .set({ resultsChannelId: request.channelId })
        .where(eq(division.id, target.id))
        .run();
    } else {
      const column = COLUMN[request.kind];
      before = league.guild[column];
      tx.update(leagueGuild)
        .set({ [column]: request.channelId })
        .where(eq(leagueGuild.guildId, league.guild.guildId))
        .run();
    }
    tx.insert(auditLog)
      .values({
        actorPlayerId: staffPlayer.id,
        actorKind: 'user',
        action: 'league.channel.set',
        entity: target ? 'division' : 'league_guild',
        entityId: target ? String(target.id) : league.guild.guildId,
        beforeJson: { kind: request.kind, channelId: before },
        afterJson: { kind: request.kind, channelId: request.channelId },
        at: now,
      })
      .run();
  });
  return {
    ok: true,
    kind: request.kind,
    channelId: request.channelId,
    division: target ? { id: target.id, name: target.name } : null,
  };
}

export type LeagueChannelsReply =
  | {
      ok: true;
      queueChannelId: string | null;
      resultsChannelId: string | null;
      /** The current season's divisions, top level first; null means the league's channel. */
      divisions: { name: string; resultsChannelId: string | null }[];
    }
  | { ok: false; error: 'not_linked' | 'not_staff' };

/** Every channel the bot posts in, for staff to check their setup. */
export function listLeagueChannels(
  db: Pick<Db, 'select'>,
  actor: Pick<Actor, 'guildId' | 'memberRoleIds'>,
): LeagueChannelsReply {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const { guild, divisions } = staff.league;
  return {
    ok: true,
    queueChannelId: guild.alertsChannelId,
    resultsChannelId: guild.resultsChannelId,
    divisions: divisions.map(({ division: row }) => ({
      name: row.name,
      resultsChannelId: row.resultsChannelId,
    })),
  };
}

/** The current season's divisions matching what staff typed: a name or a prefix such as "L2". */
export function searchDivisions(
  db: Pick<Db, 'select'>,
  actor: Pick<Actor, 'guildId' | 'memberRoleIds'>,
  query: string,
): { id: number; name: string; categoryPrefix: string }[] {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return [];
  const wanted = query.trim().toLowerCase();
  return staff.league.divisions
    .map(({ division: row }) => row)
    .filter(
      (row) =>
        row.name.toLowerCase().includes(wanted) ||
        row.categoryPrefix.toLowerCase().startsWith(wanted),
    )
    .map((row) => ({ id: row.id, name: row.name, categoryPrefix: row.categoryPrefix }));
}
