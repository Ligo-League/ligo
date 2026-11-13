import { schema, type Db } from '@ligo/db';
import { eq } from 'drizzle-orm';
import type { DiscordGateway } from '../discord/gateway.ts';
import { requireStaff, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';

const { auditLog, leagueGuild } = schema;

/** The channels the bot posts in by itself, each stored by ID on the server's league. */
export const LEAGUE_CHANNEL_KINDS = ['staff_queue', 'results'] as const;
export type LeagueChannelKind = (typeof LEAGUE_CHANNEL_KINDS)[number];

const COLUMN = {
  // Reports waiting for staff, and alerts meant for staff only.
  staff_queue: 'alertsChannelId',
  // Validated results, visible to everyone.
  results: 'resultsChannelId',
} as const satisfies Record<LeagueChannelKind, keyof typeof leagueGuild.$inferSelect>;

export type SetLeagueChannelReply =
  | { ok: true; kind: LeagueChannelKind; channelId: string }
  | { ok: false; error: 'not_linked' | 'not_staff' | 'cannot_post' };

/**
 * Stores which channel the bot uses for one purpose. The bot first posts `notice` there: a
 * channel it cannot write to is refused now, not on the evening a result needs validating.
 */
export async function setLeagueChannel(
  db: Db,
  gateway: DiscordGateway,
  actor: Actor,
  request: { kind: LeagueChannelKind; channelId: string; notice: string },
  now: number,
): Promise<SetLeagueChannelReply> {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const { league } = staff;

  try {
    await gateway.postMessage(request.channelId, { content: request.notice });
  } catch {
    return { ok: false, error: 'cannot_post' };
  }

  const column = COLUMN[request.kind];
  db.transaction((tx) => {
    const staffPlayer = ensurePlayer(
      tx,
      { orgId: league.org.id, discordUserId: actor.user.id, displayName: actor.user.displayName },
      now,
    );
    tx.update(leagueGuild)
      .set({ [column]: request.channelId })
      .where(eq(leagueGuild.guildId, league.guild.guildId))
      .run();
    tx.insert(auditLog)
      .values({
        actorPlayerId: staffPlayer.id,
        actorKind: 'user',
        action: 'league.channel.set',
        entity: 'league_guild',
        entityId: league.guild.guildId,
        beforeJson: { kind: request.kind, channelId: league.guild[column] },
        afterJson: { kind: request.kind, channelId: request.channelId },
        at: now,
      })
      .run();
  });
  return { ok: true, kind: request.kind, channelId: request.channelId };
}
