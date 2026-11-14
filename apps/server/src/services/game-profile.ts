import { checkGameProfile, type FieldErrors, type GameProfileError } from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { R6_RANKS } from '@ligo/titles';
import { and, eq, ne } from 'drizzle-orm';

// A player's R6 account, as they declare it on their own page (maintainer, 14 November 2026):
// their Ubisoft name, their profileID when they have it, and their rank, which they keep up to
// date themselves; Ligo looks nothing up elsewhere. A replay confirms the account in phase 5
// (M-23), after which its profileID no longer changes. Only R6 for now: it is the only title a
// league plays on the instance.

const { auditLog, gameAccount } = schema;
const TITLE = 'r6';

export interface GameProfileView {
  ubisoftName: string;
  profileId: string | null;
  rank: string | null;
  rankUpdatedAt: number | null;
  /** A replay confirmed the account: its profileID is fixed. */
  verified: boolean;
}

export function gameProfileOf(db: Pick<Db, 'select'>, playerId: number): GameProfileView | null {
  const row = db
    .select()
    .from(gameAccount)
    .where(and(eq(gameAccount.playerId, playerId), eq(gameAccount.title, TITLE)))
    .get();
  return row
    ? {
        ubisoftName: row.displayName,
        profileId: row.externalId,
        rank: row.rank,
        rankUpdatedAt: row.rankUpdatedAt,
        verified: row.verified,
      }
    : null;
}

export type SaveProfileError = GameProfileError | 'profile_id_taken' | 'profile_id_verified';

/** The player saves their account: created the first time, changed after; audited each time. */
export function saveGameProfile(
  db: Db,
  playerId: number,
  input: { ubisoftName: string; profileId: string | null; rank: string },
  now: number,
): { ok: true } | { ok: false; errors: FieldErrors<SaveProfileError> } {
  const checked = checkGameProfile(input, R6_RANKS);
  if (!checked.ok) return checked;
  const { ubisoftName, profileId, rank } = checked.value;
  const fail = (error: SaveProfileError) => ({
    ok: false as const,
    errors: [{ field: 'profileId', error }],
  });

  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(gameAccount)
      .where(and(eq(gameAccount.playerId, playerId), eq(gameAccount.title, TITLE)))
      .get();
    if (row?.verified && row.externalId !== profileId) return fail('profile_id_verified');
    if (profileId !== null) {
      const other = tx
        .select({ id: gameAccount.id })
        .from(gameAccount)
        .where(
          and(
            eq(gameAccount.title, TITLE),
            eq(gameAccount.externalId, profileId),
            ne(gameAccount.playerId, playerId),
          ),
        )
        .get();
      if (other) return fail('profile_id_taken');
    }

    const values = {
      displayName: ubisoftName,
      externalId: profileId,
      rank,
      rankUpdatedAt: row?.rank === rank ? row.rankUpdatedAt : now,
    };
    if (row) {
      tx.update(gameAccount).set(values).where(eq(gameAccount.id, row.id)).run();
    } else {
      tx.insert(gameAccount)
        .values({ playerId, title: TITLE, ...values })
        .run();
    }
    tx.insert(auditLog)
      .values({
        actorPlayerId: playerId,
        actorKind: 'user',
        action: 'player.game_profile',
        entity: 'player',
        entityId: String(playerId),
        beforeJson: row
          ? { ubisoftName: row.displayName, profileId: row.externalId, rank: row.rank }
          : null,
        afterJson: { ubisoftName, profileId, rank },
        at: now,
      })
      .run();
    return { ok: true as const };
  });
}
