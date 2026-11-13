import type { PendingMatch, StandingsInput, StandingsMatch } from '@ligo/core';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../client.ts';
import {
  competition,
  game,
  match,
  matchSlot,
  sanction,
  season,
  slot,
  stage,
  stageEntry,
  team,
} from '../schema/index.ts';

export interface StandingsTeam {
  /** `stage_entry.id`, the entry number used in `input`. */
  entry: number;
  slotId: number;
  teamId: number;
  name: string;
  tag: string;
  slug: string;
  colors: string[];
  /** Where the team's logo is stored, or null when it has none. */
  logoKey: string | null;
  /** The team was excluded from the season (`slot.status = 'excluded'`). */
  excluded: boolean;
}

export interface StageStandingsData {
  /** Ready for `computeStandings` from `@ligo/core`. */
  input: StandingsInput;
  /** The team behind each entry, in the order of `input.entries` (by name). */
  teams: StandingsTeam[];
}

/**
 * Everything standings are computed from, for one stage of a team league: its entries, the
 * matches that count (`validated` or `forfeit`), sanction point deltas and the rule settings.
 * Returns undefined for an unknown stage.
 */
export function loadStandingsInput(
  db: Pick<Db, 'select'>,
  stageId: number,
): StageStandingsData | undefined {
  const context = db
    .select({ stage, season, competition })
    .from(stage)
    .innerJoin(season, eq(stage.seasonId, season.id))
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .where(eq(stage.id, stageId))
    .get();
  if (!context) return undefined;

  const teams: StandingsTeam[] = db
    .select({
      entry: stageEntry.id,
      slotId: slot.id,
      teamId: team.id,
      name: team.name,
      tag: team.tag,
      slug: team.slug,
      colors: team.colorsJson,
      logoKey: team.logoKey,
      slotStatus: slot.status,
    })
    .from(stageEntry)
    .innerJoin(slot, eq(stageEntry.slotId, slot.id))
    .innerJoin(team, eq(slot.teamId, team.id))
    .where(eq(stageEntry.stageId, stageId))
    .orderBy(asc(team.name), asc(stageEntry.id))
    .all()
    .map(({ slotStatus, ...row }) => ({ ...row, excluded: slotStatus === 'excluded' }));

  const counted = db
    .select({ id: match.id, status: match.status, week: match.week })
    .from(match)
    .where(and(eq(match.stageId, stageId), inArray(match.status, ['validated', 'forfeit'])))
    // By week, so that a team's latest results can be read off the end of the list.
    .orderBy(asc(match.week), asc(match.id))
    .all();
  // Matches that do not count yet: still to play, or reported and not validated. The 50% rule
  // turns some of them into forfeits when a team is excluded.
  const waiting = db
    .select({ id: match.id, week: match.week })
    .from(match)
    .where(
      and(
        eq(match.stageId, stageId),
        inArray(match.status, ['scheduled', 'reported', 'confirmed', 'disputed']),
      ),
    )
    .orderBy(asc(match.week), asc(match.id))
    .all();
  const matchIds = counted.map((row) => row.id);
  const sides = db
    .select()
    .from(matchSlot)
    .where(inArray(matchSlot.matchId, [...matchIds, ...waiting.map((row) => row.id)]))
    .all();
  const games = db
    .select()
    .from(game)
    .where(and(inArray(game.matchId, matchIds), eq(game.status, 'final')))
    .orderBy(asc(game.matchId), asc(game.n))
    .all();

  const matches = counted.map(({ id, status, week }): StandingsMatch => {
    // A league stage is played between its entries; a bracket source here is corrupt data.
    const entryOf = (side: 'a' | 'b') => {
      const found = sides.find((row) => row.matchId === id && row.side === side);
      if (found?.sourceKind !== 'entry')
        throw new Error(`Match ${id} has no entry on side ${side}`);
      return found.sourceRef;
    };
    const matchGames = games.filter((row) => row.matchId === id);
    if (status === 'forfeit') {
      const forfeitedBy = matchGames[0]?.forfeitSide;
      if (!forfeitedBy) throw new Error(`Forfeit match ${id} does not say which side forfeited`);
      return {
        id,
        week,
        a: entryOf('a'),
        b: entryOf('b'),
        result: { kind: 'forfeit', forfeitedBy },
      };
    }
    return {
      id,
      week,
      a: entryOf('a'),
      b: entryOf('b'),
      result: {
        kind: 'played',
        games: matchGames.map((row) => ({ a: row.scoreA, b: row.scoreB })),
      },
    };
  });

  const sanctions = db
    .select()
    .from(sanction)
    .where(and(eq(sanction.seasonId, context.season.id), isNotNull(sanction.pointsDelta)))
    .orderBy(asc(sanction.id))
    .all();
  const pointDeltas: { entry: number; delta: number }[] = [];
  for (const row of sanctions) {
    const target = teams.find(
      (candidate) =>
        (row.targetKind === 'slot' && candidate.slotId === row.targetId) ||
        (row.targetKind === 'team' && candidate.teamId === row.targetId),
    );
    // A sanction on a team of another division, or on a player, moves no points here.
    if (target && row.pointsDelta !== null) {
      pointDeltas.push({ entry: target.entry, delta: row.pointsDelta });
    }
  }

  // A bracket match waiting for its teams has no entries yet: it is nobody's pending match.
  const pending = waiting.flatMap(({ id, week }): PendingMatch[] => {
    const entryOf = (side: 'a' | 'b') =>
      sides.find((row) => row.matchId === id && row.side === side && row.sourceKind === 'entry')
        ?.sourceRef;
    const a = entryOf('a');
    const b = entryOf('b');
    return a === undefined || b === undefined ? [] : [{ id, week, a, b }];
  });

  return {
    teams,
    input: {
      entries: teams.map((row) => row.entry),
      matches,
      pending,
      excluded: teams.filter((row) => row.excluded).map((row) => row.entry),
      points: context.competition.pointsJson,
      tiebreak: context.competition.tiebreakJson,
      forfeitScore: context.season.settingsJson.forfeit_score,
      pointDeltas,
    },
  };
}
