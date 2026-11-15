import { eq } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { auditLog, leagueGuild } from '../schema/index.ts';
import { findLfrSeason } from './seed-lfr.ts';

/** `created`: the server is now LFR's; `unchanged`: LFR already had a server, kept as it is. */
export type LinkGuildResult = 'created' | 'unchanged';

/**
 * Gives the seeded LFR competition its first Discord server, with the role that marks its
 * staff. Once LFR has a server, it is changed on the website (`/c/lfr/discord`, maintainer,
 * 15 November 2026), and running the seed again keeps what was set there. A competition created
 * on the website (phase 3h) is linked there by its creator.
 */
export function linkGuild(
  db: Db,
  link: { guildId: string; staffRoleId: string },
  now: number,
): LinkGuildResult {
  return db.transaction((tx) => {
    const found = findLfrSeason(tx);
    if (!found) throw new Error('Seed the teams before linking a server: no competition exists');
    const stored = tx
      .select()
      .from(leagueGuild)
      .where(eq(leagueGuild.competitionId, found.competition.id))
      .get();
    if (stored) return 'unchanged';
    const wanted = {
      guildId: link.guildId,
      orgId: found.competition.orgId,
      competitionId: found.competition.id,
      staffRoleId: link.staffRoleId,
    };
    tx.insert(leagueGuild).values(wanted).run();
    tx.insert(auditLog)
      .values({
        actorKind: 'system',
        action: 'seed.guild.link',
        entity: 'league_guild',
        entityId: link.guildId,
        beforeJson: null,
        afterJson: wanted,
        at: now,
      })
      .run();
    return 'created';
  });
}
