import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../client.ts';
import {
  division,
  evidence,
  game,
  match,
  matchSlot,
  season,
  slot,
  stage,
  stageEntry,
  team,
} from '../schema/index.ts';

type MatchRow = typeof match.$inferSelect;
type GameRow = typeof game.$inferSelect;

export interface MatchTeam {
  teamId: number;
  name: string;
  tag: string;
}

export interface LeagueMatch {
  id: number;
  competitionId: number;
  seasonId: number;
  stageId: number;
  /** Null for a stage that spans divisions, such as a cup. */
  division: {
    id: number;
    name: string;
    categoryPrefix: string;
    /** Its own results channel, when it has one. */
    resultsChannelId: string | null;
  } | null;
  week: number | null;
  bestOf: number;
  status: MatchRow['status'];
  a: MatchTeam;
  b: MatchTeam;
  /** The players who reported and confirmed the result, when a team did. */
  reportedBy: number | null;
  confirmedBy: number | null;
  /** The first game, which is the whole match in a best of 1. */
  game: Pick<GameRow, 'id' | 'scoreA' | 'scoreB' | 'forfeitSide' | 'status'> | null;
}

/**
 * Matches between two known teams, for one season or one match ID, ordered by division, week and
 * ID. A match whose sides are not both stage entries yet (a bracket slot waiting for a winner)
 * is left out.
 */
export function listLeagueMatches(
  db: Pick<Db, 'select'>,
  filter: { seasonId: number } | { matchId: number },
): LeagueMatch[] {
  const rows = db
    .select({ match, competitionId: season.competitionId, seasonId: season.id, division })
    .from(match)
    .innerJoin(stage, eq(match.stageId, stage.id))
    .innerJoin(season, eq(stage.seasonId, season.id))
    .leftJoin(division, eq(stage.divisionId, division.id))
    .where('seasonId' in filter ? eq(season.id, filter.seasonId) : eq(match.id, filter.matchId))
    .orderBy(asc(division.level), asc(match.week), asc(match.id))
    .all();
  const matchIds = rows.map((row) => row.match.id);

  const sides = db
    .select({
      matchId: matchSlot.matchId,
      side: matchSlot.side,
      teamId: team.id,
      name: team.name,
      tag: team.tag,
    })
    .from(matchSlot)
    .innerJoin(stageEntry, eq(matchSlot.sourceRef, stageEntry.id))
    .innerJoin(slot, eq(stageEntry.slotId, slot.id))
    .innerJoin(team, eq(slot.teamId, team.id))
    .where(and(inArray(matchSlot.matchId, matchIds), eq(matchSlot.sourceKind, 'entry')))
    .all();
  const games = db
    .select()
    .from(game)
    .where(and(inArray(game.matchId, matchIds), eq(game.n, 1)))
    .all();

  const matches: LeagueMatch[] = [];
  for (const row of rows) {
    const side = (which: 'a' | 'b') =>
      sides.find((candidate) => candidate.matchId === row.match.id && candidate.side === which);
    const a = side('a');
    const b = side('b');
    if (!a || !b) continue;
    const first = games.find((candidate) => candidate.matchId === row.match.id);
    matches.push({
      id: row.match.id,
      competitionId: row.competitionId,
      seasonId: row.seasonId,
      stageId: row.match.stageId,
      division: row.division && {
        id: row.division.id,
        name: row.division.name,
        categoryPrefix: row.division.categoryPrefix,
        resultsChannelId: row.division.resultsChannelId,
      },
      week: row.match.week,
      bestOf: row.match.bestOf,
      status: row.match.status,
      a: { teamId: a.teamId, name: a.name, tag: a.tag },
      b: { teamId: b.teamId, name: b.name, tag: b.tag },
      reportedBy: row.match.reportedBy,
      confirmedBy: row.match.confirmedBy,
      game: first
        ? {
            id: first.id,
            scoreA: first.scoreA,
            scoreB: first.scoreB,
            forfeitSide: first.forfeitSide,
            status: first.status,
          }
        : null,
    });
  }
  return matches;
}

/**
 * The latest score screenshot of a match: the one the current report rests on. Its ID also
 * marks which report a button belongs to.
 */
export function latestScoreEvidence(db: Pick<Db, 'select'>, matchId: number) {
  return db
    .select()
    .from(evidence)
    .where(and(eq(evidence.matchId, matchId), eq(evidence.kind, 'score_screenshot')))
    .orderBy(desc(evidence.id))
    .get();
}
