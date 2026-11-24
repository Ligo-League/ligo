import type { ReplaySide } from '@ligo/core';
import { and, eq, gt, inArray, isNull, lte, ne, or } from 'drizzle-orm';
import type { Db } from '../client.ts';
import * as schema from '../schema/index.ts';
import type { LeagueMatch } from './matches.ts';

// Whose game accounts a match's replays may hold (design doc section 8, "From files to a game"):
// the upload API checks a file belongs to the match with them, and `stitch_game` resolves each
// lobby's teams with them. One reading for both, so an accepted file is one the stitch can place.

const { gameAccount, lineup, lineupMember, rosterEntry } = schema;

const upper = (side: 'a' | 'b'): ReplaySide => (side === 'a' ? 'A' : 'B');

export interface MatchAccounts {
  /** Each known R6 account (Ubisoft profileID) and the side it plays for. */
  teamOf: Map<string, ReplaySide>;
  /** Each known account's Ligo player. */
  playerOf: Map<string, number>;
}

/** Each side's R6 accounts: the season roster when the match was played, and its lineups. */
export function matchAccounts(db: Pick<Db, 'select'>, found: LeagueMatch): MatchAccounts {
  const at = found.scheduledAt ?? found.window.end - 1;
  const players = new Map<number, ReplaySide>();
  for (const side of ['a', 'b'] as const) {
    const rows = db
      .select({ playerId: rosterEntry.playerId })
      .from(rosterEntry)
      .where(
        and(
          eq(rosterEntry.seasonId, found.seasonId),
          eq(rosterEntry.teamId, found[side].teamId),
          ne(rosterEntry.role, 'coach'),
          lte(rosterEntry.validFrom, at),
          or(isNull(rosterEntry.validTo), gt(rosterEntry.validTo, at)),
        ),
      )
      .all();
    for (const row of rows) players.set(row.playerId, upper(side));
  }
  const members = db
    .select({ playerId: lineupMember.playerId, side: lineup.side })
    .from(lineupMember)
    .innerJoin(lineup, eq(lineupMember.lineupId, lineup.id))
    .where(eq(lineup.matchId, found.id))
    .all();
  for (const row of members) players.set(row.playerId, upper(row.side));

  const teamOf = new Map<string, ReplaySide>();
  const playerOf = new Map<string, number>();
  if (players.size === 0) return { teamOf, playerOf };
  const accounts = db
    .select({ playerId: gameAccount.playerId, externalId: gameAccount.externalId })
    .from(gameAccount)
    .where(and(eq(gameAccount.title, 'r6'), inArray(gameAccount.playerId, [...players.keys()])))
    .all();
  for (const { playerId, externalId } of accounts) {
    const side = players.get(playerId);
    if (externalId === null || !side) continue;
    teamOf.set(externalId, side);
    playerOf.set(externalId, playerId);
  }
  return { teamOf, playerOf };
}
