import type { PlayerProfile } from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { inArray } from 'drizzle-orm';

// What each player declared on `/me`, read once for many players: the rosters and the
// registrations both check it.

const { gameAccount, player } = schema;

type Reader = Pick<Db, 'select'>;

/** What each player declared, for whether they may play: see `playerGaps`. */
export function profilesOf(
  db: Reader,
  playerIds: readonly number[],
  title: string,
): Map<number, PlayerProfile> {
  if (playerIds.length === 0) return new Map();
  const ranked = new Set(
    db
      .select({ playerId: gameAccount.playerId, rank: gameAccount.rank, title: gameAccount.title })
      .from(gameAccount)
      .where(inArray(gameAccount.playerId, [...playerIds]))
      .all()
      .filter((account) => account.title === title && account.rank !== null)
      .map((account) => account.playerId),
  );
  return new Map(
    db
      .select()
      .from(player)
      .where(inArray(player.id, [...playerIds]))
      .all()
      .map((found) => [
        found.id,
        {
          gameAccount: ranked.has(found.id),
          nationality: found.nationality,
          statsConsent: found.statsConsentAt !== null,
          birthDate: found.birthDate,
        },
      ]),
  );
}
