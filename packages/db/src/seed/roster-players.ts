import type { Db } from '../client.ts';
import * as schema from '../schema/index.ts';

// For the replay tests of the server and the worker: players whose R6 accounts are known, so a
// round's sides resolve to their team.

/** Five roster players with Ubisoft accounts for a team of the season; their profileIDs. */
export function addRosterPlayers(
  db: Db,
  seasonId: number,
  teamId: number,
  prefix: string,
): string[] {
  const org = db.select().from(schema.org).get();
  if (!org) throw new Error('no organisation');
  return [1, 2, 3, 4, 5].map((n) => {
    const name = `${prefix}${String(n)}`;
    // The first part is unique, since rawRound names each player by it.
    const account = `${prefix}${String(n)}00000-0000-4000-8000-000000000000`;
    const player = db
      .insert(schema.player)
      .values({ orgId: org.id, slug: name, displayName: name, createdAt: 0 })
      .returning()
      .get();
    db.insert(schema.gameAccount)
      .values({ playerId: player.id, title: 'r6', externalId: account, displayName: name })
      .run();
    db.insert(schema.rosterEntry)
      .values({ seasonId, teamId, playerId: player.id, role: 'player', validFrom: 0 })
      .run();
    return account;
  });
}
