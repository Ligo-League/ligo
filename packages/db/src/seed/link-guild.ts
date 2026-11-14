import { eq } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { auditLog, leagueGuild } from '../schema/index.ts';
import { findLfrSeason } from './seed-lfr.ts';

export type LinkGuildResult = 'created' | 'updated' | 'unchanged';

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

/**
 * Maps a Discord server to the seeded LFR competition, with the role that marks its staff and
 * the server's public invitation, if any. Until the admin panel (phase 3h), this is how a server
 * gets its `league_guild` row.
 */
export function linkGuild(
  db: Db,
  link: { guildId: string; staffRoleId: string; inviteUrl?: string | null },
  now: number,
): LinkGuildResult {
  const inviteUrl = link.inviteUrl ?? null;
  if (inviteUrl !== null && !isDiscordInvite(inviteUrl)) {
    throw new Error('Not a Discord invitation: expected https://discord.gg/…');
  }
  return db.transaction((tx) => {
    const found = findLfrSeason(tx);
    if (!found) throw new Error('Seed the teams before linking a server: no competition exists');
    const wanted = {
      guildId: link.guildId,
      orgId: found.competition.orgId,
      competitionId: found.competition.id,
      staffRoleId: link.staffRoleId,
      inviteUrl,
    };

    const stored = tx.select().from(leagueGuild).where(eq(leagueGuild.guildId, link.guildId)).get();
    if (
      stored?.competitionId === wanted.competitionId &&
      stored.staffRoleId === wanted.staffRoleId &&
      stored.inviteUrl === wanted.inviteUrl
    ) {
      return 'unchanged';
    }
    if (stored) {
      tx.update(leagueGuild).set(wanted).where(eq(leagueGuild.guildId, link.guildId)).run();
    } else {
      tx.insert(leagueGuild).values(wanted).run();
    }
    tx.insert(auditLog)
      .values({
        actorKind: 'system',
        action: 'seed.guild.link',
        entity: 'league_guild',
        entityId: link.guildId,
        beforeJson: stored ? { ...stored } : null,
        afterJson: wanted,
        at: now,
      })
      .run();
    return stored ? 'updated' : 'created';
  });
}
