import { actsForSide } from '@ligo/core';
import { schema, type Db, type LeagueMatch } from '@ligo/db';
import { R6_PLAYERS_PER_SIDE } from '@ligo/titles';
import { and, asc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { matchRolesOf } from './permissions.ts';

// The players a team announces for a match (M-47, maintainer 24 November 2026): by default its
// season roster's starters; before playing, its officials or captain may name others of the
// roster for this match, a substitute in a starter's place. They are who owes a MOSS file where
// the league takes them from the lineup. Teams change it until the result is reported; staff at
// any time. A stat sheet saved later rewrites it with the players who have stats.

const { auditLog, lineup, lineupMember, player, rosterEntry } = schema;

type Side = 'a' | 'b';
type Reader = Pick<Db, 'select'>;

/** When the match was played, for its roster: its time, else the end of its week. */
const playedAt = (found: LeagueMatch) => found.scheduledAt ?? found.window.end - 1;

export interface LineupChoice {
  playerId: number;
  name: string;
  /** The player's place on the season roster. */
  role: 'player' | 'sub';
}

/** The side's season roster when the match is played: starters, then substitutes. */
export function lineupChoices(db: Reader, found: LeagueMatch, side: Side): LineupChoice[] {
  const at = playedAt(found);
  return db
    .select({ playerId: rosterEntry.playerId, name: player.displayName, role: rosterEntry.role })
    .from(rosterEntry)
    .innerJoin(player, eq(rosterEntry.playerId, player.id))
    .where(
      and(
        eq(rosterEntry.seasonId, found.seasonId),
        eq(rosterEntry.teamId, found[side].teamId),
        lte(rosterEntry.validFrom, at),
        or(isNull(rosterEntry.validTo), gt(rosterEntry.validTo, at)),
      ),
    )
    .orderBy(asc(rosterEntry.role), asc(player.displayName))
    .all()
    .flatMap((row): LineupChoice[] =>
      row.role === 'coach' ? [] : [{ playerId: row.playerId, name: row.name, role: row.role }],
    );
}

/** The players the side announced for the match, else its roster's starters. */
export function announcedPlayers(
  db: Reader,
  found: LeagueMatch,
  side: Side,
): { playerId: number; name: string }[] {
  const members = db
    .select({ playerId: lineupMember.playerId, name: player.displayName })
    .from(lineupMember)
    .innerJoin(lineup, eq(lineupMember.lineupId, lineup.id))
    .innerJoin(player, eq(lineupMember.playerId, player.id))
    .where(and(eq(lineup.matchId, found.id), eq(lineup.side, side)))
    .all();
  if (members.length > 0) return members;
  return lineupChoices(db, found, side)
    .filter((choice) => choice.role === 'player')
    .map(({ playerId, name }) => ({ playerId, name }));
}

export type AnnounceLineupError = 'not_allowed' | 'locked' | 'too_few' | 'not_on_roster';

/** Whether this person may change the side's players now: its officials and captain, or staff. */
export function mayAnnounce(
  db: Reader,
  found: LeagueMatch,
  side: Side,
  actor: { playerId: number; staff: boolean },
): AnnounceLineupError | null {
  if (!actor.staff && !actsForSide(matchRolesOf(db, actor.playerId, found.seasonId), found, side)) {
    return 'not_allowed';
  }
  // Until the result is reported; staff change it at any time.
  if (!actor.staff && found.status !== 'scheduled') return 'locked';
  return null;
}

/** Names the side's players for this match, at least a team, all from its season roster. */
export function announceLineup(
  db: Db,
  found: LeagueMatch,
  side: Side,
  actor: { playerId: number; staff: boolean },
  playerIds: readonly number[],
  now: number,
): { ok: true } | { ok: false; error: AnnounceLineupError } {
  const refusal = mayAnnounce(db, found, side, actor);
  if (refusal) return { ok: false, error: refusal };
  const roles = new Map(lineupChoices(db, found, side).map((c) => [c.playerId, c.role]));
  const chosen = [...new Set(playerIds)];
  if (chosen.some((id) => !roles.has(id))) return { ok: false, error: 'not_on_roster' };
  if (chosen.length < R6_PLAYERS_PER_SIDE) return { ok: false, error: 'too_few' };
  return db.transaction((tx) => {
    const before = announcedPlayers(tx, found, side).map((p) => p.playerId);
    let row = tx
      .select()
      .from(lineup)
      .where(and(eq(lineup.matchId, found.id), eq(lineup.side, side)))
      .get();
    row ??= tx
      .insert(lineup)
      .values({ matchId: found.id, side, teamId: found[side].teamId })
      .returning()
      .get();
    tx.delete(lineupMember).where(eq(lineupMember.lineupId, row.id)).run();
    for (const playerId of chosen) {
      tx.insert(lineupMember)
        .values({
          lineupId: row.id,
          playerId,
          role: roles.get(playerId) === 'sub' ? 'sub' : 'starter',
        })
        .run();
    }
    tx.insert(auditLog)
      .values({
        actorPlayerId: actor.playerId,
        actorKind: 'user',
        action: 'match.lineup',
        entity: 'match',
        entityId: String(found.id),
        beforeJson: { side, players: before },
        afterJson: { side, players: chosen, ...(actor.staff ? { staff: true } : {}) },
        at: now,
      })
      .run();
    return { ok: true };
  });
}
