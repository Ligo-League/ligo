import { weekWindow } from '@ligo/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../client.ts';
import {
  auditLog,
  division,
  game,
  match,
  matchSlot,
  slot,
  stage,
  stageEntry,
  team,
} from '../schema/index.ts';
import type { MatchRow } from './matches-csv.ts';
import { findLfrSeason, LFR_TIME_ZONE } from './seed-lfr.ts';

export interface MatchSeedSummary {
  created: { stages: number; entries: number; matches: number };
  /** Results written on matches that had none. */
  results: { played: number; forfeits: number };
  /** Rows the file marks as drawn: the league has no draws, so they are left without result. */
  draws: string[];
  /** Matches whose stored result differs from the file. They are left as stored. */
  conflicts: string[];
}

/**
 * Loads the season's fixtures and results after `seedLfr`: one published round-robin stage per
 * division with an entry per slot, one best-of-1 match per row. A result is written only on a
 * match that has none, so running it again with a newer file adds the new results and never
 * rewrites one entered since. It never deletes.
 */
export function seedMatches(db: Db, rows: readonly MatchRow[], now: number): MatchSeedSummary {
  return db.transaction((tx) => {
    const summary: MatchSeedSummary = {
      created: { stages: 0, entries: 0, matches: 0 },
      results: { played: 0, forfeits: 0 },
      draws: [],
      conflicts: [],
    };

    const found = findLfrSeason(tx);
    if (!found) throw new Error('Seed the teams before the matches: the season does not exist');
    const seasonRow = found.season;

    // division name → team tag → stage entry, creating the stage and its entries when missing.
    const entries = new Map<string, { stageId: number; byTag: Map<string, number> }>();
    const divisions = tx.select().from(division).where(eq(division.seasonId, seasonRow.id)).all();
    for (const divisionRow of divisions) {
      const stageWhere = and(
        eq(stage.seasonId, seasonRow.id),
        eq(stage.divisionId, divisionRow.id),
        eq(stage.kind, 'round_robin'),
      );
      let stageRow = tx.select().from(stage).where(stageWhere).get();
      if (!stageRow) {
        stageRow = tx
          .insert(stage)
          .values({
            seasonId: seasonRow.id,
            divisionId: divisionRow.id,
            ord: 1,
            kind: 'round_robin',
            // No shuffle seed: this schedule was made on score7, not generated here.
            configJson: {},
            status: 'published',
          })
          .returning()
          .get();
        summary.created.stages += 1;
      }

      const slots = tx
        .select({ slotId: slot.id, tag: team.tag })
        .from(slot)
        .innerJoin(team, eq(slot.teamId, team.id))
        .where(eq(slot.divisionId, divisionRow.id))
        .orderBy(team.tag)
        .all();
      const existing = tx
        .select()
        .from(stageEntry)
        .where(eq(stageEntry.stageId, stageRow.id))
        .all();
      const byTag = new Map<string, number>();
      let nextSeed = Math.max(0, ...existing.map((entry) => entry.seed)) + 1;
      for (const { slotId, tag } of slots) {
        let entry = existing.find((candidate) => candidate.slotId === slotId);
        if (!entry) {
          entry = tx
            .insert(stageEntry)
            .values({ stageId: stageRow.id, slotId, seed: nextSeed++ })
            .returning()
            .get();
          summary.created.entries += 1;
        }
        byTag.set(tag, entry.id);
      }
      entries.set(divisionRow.name, { stageId: stageRow.id, byTag });
    }

    for (const row of rows) {
      const label = `${row.division}, week ${row.week}, ${row.teamA} v ${row.teamB}`;
      const stageEntries = entries.get(row.division);
      const entryA = stageEntries?.byTag.get(row.teamA);
      const entryB = stageEntries?.byTag.get(row.teamB);
      if (!stageEntries || entryA === undefined || entryB === undefined) {
        throw new Error(`${label}: the division or a team is not seeded`);
      }

      const weekMatches = tx
        .select({ match, side: matchSlot.side, entry: matchSlot.sourceRef })
        .from(match)
        .innerJoin(matchSlot, eq(matchSlot.matchId, match.id))
        .where(
          and(
            eq(match.stageId, stageEntries.stageId),
            eq(match.week, row.week),
            eq(matchSlot.sourceKind, 'entry'),
            inArray(matchSlot.sourceRef, [entryA, entryB]),
          ),
        )
        .all();
      const sidesOf = (matchId: number) =>
        weekMatches.filter((candidate) => candidate.match.id === matchId);
      const stored = weekMatches.find(({ match: candidate }) => sidesOf(candidate.id).length === 2);

      let matchRow = stored?.match;
      if (matchRow) {
        const sideA = sidesOf(matchRow.id).find((candidate) => candidate.side === 'a');
        if (sideA?.entry !== entryA) {
          summary.conflicts.push(`${label}: stored with the two sides the other way round`);
          continue;
        }
      } else {
        const window = weekWindow(seasonRow.startsOn, row.week, LFR_TIME_ZONE);
        matchRow = tx
          .insert(match)
          .values({
            stageId: stageEntries.stageId,
            week: row.week,
            bestOf: 1,
            windowStart: window.start,
            windowEnd: window.end,
          })
          .returning()
          .get();
        tx.insert(matchSlot)
          .values([
            { matchId: matchRow.id, side: 'a', sourceKind: 'entry', sourceRef: entryA },
            { matchId: matchRow.id, side: 'b', sourceKind: 'entry', sourceRef: entryB },
          ])
          .run();
        summary.created.matches += 1;
      }

      const { result } = row;
      if (result.kind === 'none') continue;
      if (result.kind === 'draw') {
        summary.draws.push(`${label}: ${result.scoreA}-${result.scoreB}`);
        continue;
      }

      const wanted =
        result.kind === 'played'
          ? { status: 'validated' as const, scoreA: result.scoreA, scoreB: result.scoreB }
          : // A forfeit stores no rounds: the season's forfeit score is applied when standings
            // are computed, so changing that setting changes every forfeit at once.
            { status: 'forfeit' as const, scoreA: 0, scoreB: 0, forfeitSide: result.forfeitBy };
      const forfeitSide = 'forfeitSide' in wanted ? wanted.forfeitSide : null;

      if (matchRow.status === 'scheduled') {
        tx.insert(game)
          .values({
            matchId: matchRow.id,
            n: 1,
            bansJson: [],
            scoreA: wanted.scoreA,
            scoreB: wanted.scoreB,
            forfeitSide,
            status: 'final',
          })
          .run();
        tx.update(match)
          .set({ status: wanted.status, validatedAt: now })
          .where(eq(match.id, matchRow.id))
          .run();
        summary.results[result.kind === 'played' ? 'played' : 'forfeits'] += 1;
        continue;
      }

      const games = tx.select().from(game).where(eq(game.matchId, matchRow.id)).all();
      const [only, ...others] = games;
      const same =
        matchRow.status === wanted.status &&
        only !== undefined &&
        others.length === 0 &&
        only.scoreA === wanted.scoreA &&
        only.scoreB === wanted.scoreB &&
        only.forfeitSide === forfeitSide;
      if (!same) {
        summary.conflicts.push(`${label}: stored as ${matchRow.status}, the file says otherwise`);
      }
    }

    if (matchSeedHasChanges(summary)) {
      tx.insert(auditLog)
        .values({
          actorKind: 'system',
          action: 'seed.lfr.matches',
          entity: 'season',
          entityId: String(seasonRow.id),
          afterJson: { created: summary.created, results: summary.results },
          at: now,
        })
        .run();
    }
    return summary;
  });
}

export function matchSeedHasChanges(summary: MatchSeedSummary): boolean {
  return [...Object.values(summary.created), ...Object.values(summary.results)].some((n) => n > 0);
}
