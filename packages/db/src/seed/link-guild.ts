import { eq } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { auditLog, leagueGuild } from '../schema/index.ts';
import { findLfrSeason } from './seed-lfr.ts';

export type LinkGuildResult = 'created' | 'updated' | 'unchanged';

/**
 * Maps a Discord server to the seeded LFR competition, with the role that marks its staff.
 * Until a setup command exists, this is how the staging server gets its `league_guild` row.
 */
export function linkGuild(
  db: Db,
  link: { guildId: string; staffRoleId: string },
  now: number,
): LinkGuildResult {
  return db.transaction((tx) => {
    const found = findLfrSeason(tx);
    if (!found) throw new Error('Seed the teams before linking a server: no competition exists');
    const wanted = {
      guildId: link.guildId,
      orgId: found.competition.orgId,
      competitionId: found.competition.id,
      staffRoleId: link.staffRoleId,
    };

    const stored = tx.select().from(leagueGuild).where(eq(leagueGuild.guildId, link.guildId)).get();
    if (
      stored?.competitionId === wanted.competitionId &&
      stored.staffRoleId === wanted.staffRoleId
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
