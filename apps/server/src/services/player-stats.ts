import { listLeagueMatches, schema, type Db } from '@ligo/db';
import { manualMetrics, statsOf, type TitleStats, type Title } from '@ligo/titles';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { competitionPath, seasonPath } from './paths.ts';

// A game's tab on the player page (phase 3i; design doc sections 7 and 9, M-42, maintainer,
// 19 November 2026). Matches are those a stat sheet (later a replay) names the player in: their
// verified stats in a validated match. Totals per season and per map are summed first and
// divided last, each ratio over the games that have every value it needs. A player without stats
// consent has their matches and their team's results listed, with no figures (section 7).

const { competition, game, lineup, lineupMember, match, org, player, season, stage, stat, team } =
  schema;
type Reader = Pick<Db, 'select'>;

export interface PlayerStatsColumn {
  key: string;
  label: { fr: string; en: string };
  format: 'count' | 'ratio' | 'percent' | 'signed';
}

type Values = Record<string, number | null>;

export interface PlayerGameLine {
  n: number;
  map: string | null;
  scoreFor: number;
  scoreAgainst: number;
  /** The player's figures in this game; null without stats consent. */
  values: Values | null;
}

interface TeamRef {
  name: string;
  slug: string;
  tag: string;
}

export interface PlayerMatchLine {
  id: number;
  /** Its time, or the start of its week when it had none (`timed` false). */
  at: number;
  timed: boolean;
  competition: { name: string; path: string };
  season: { name: string; path: string };
  team: TeamRef;
  opponent: TeamRef;
  /** The team's result over the match's maps. */
  result: 'win' | 'loss' | 'draw';
  /** The maps the player has figures in. */
  games: PlayerGameLine[];
}

export interface PlayerStats {
  /** No stats consent: matches only, no figure anywhere. */
  hidden: boolean;
  columns: PlayerStatsColumn[];
  /** The latest first. */
  matches: PlayerMatchLine[];
  /** Totals per competition season, the latest first. */
  seasons: {
    competition: { name: string; path: string };
    season: { name: string; path: string };
    games: number;
    values: Values;
  }[];
  /** Totals per map, by name; a game with no map recorded is left out. */
  maps: { map: string; games: number; values: Values }[];
}

/** Every value of one game, by metric. */
type GameValues = Record<string, number>;

/** Totals of a set of games: each metric summed; each ratio from the games that have its needs. */
function totalsOf(stats: TitleStats, games: readonly GameValues[]): Values {
  const sum = (key: string, from: readonly GameValues[]) => {
    const present = from.filter((values) => values[key] !== undefined);
    return present.length === 0
      ? null
      : present.reduce((total, values) => total + (values[key] ?? 0), 0);
  };
  const values: Values = {};
  for (const metric of stats.metrics) values[metric.key] = sum(metric.key, games);
  for (const derived of stats.derived) {
    const covered = games.filter((values) =>
      derived.needs.every((key) => values[key] !== undefined),
    );
    if (covered.length === 0) {
      values[derived.key] = null;
      continue;
    }
    const totals = Object.fromEntries(derived.needs.map((key) => [key, sum(key, covered) ?? 0]));
    values[derived.key] = derived.compute(totals);
  }
  return values;
}

const EMPTY = (hidden: boolean): PlayerStats => ({
  hidden,
  columns: [],
  matches: [],
  seasons: [],
  maps: [],
});

/** The player's matches and stats in one game. */
export function playerStats(db: Reader, playerId: number, title: Title): PlayerStats {
  const stats = statsOf(title);
  const who = db
    .select({ consent: player.statsConsentAt })
    .from(player)
    .where(eq(player.id, playerId))
    .get();
  const hidden = who?.consent === null || who === undefined;
  if (!stats) return EMPTY(hidden);

  const rows = db
    .select({
      gameId: game.id,
      matchId: match.id,
      metric: stat.metric,
      value: stat.value,
    })
    .from(stat)
    .innerJoin(game, eq(stat.gameId, game.id))
    .innerJoin(match, eq(game.matchId, match.id))
    .innerJoin(stage, eq(match.stageId, stage.id))
    .innerJoin(season, eq(stage.seasonId, season.id))
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .where(
      and(
        eq(stat.playerId, playerId),
        eq(stat.verified, true),
        ne(game.status, 'void'),
        eq(match.status, 'validated'),
        eq(competition.title, title),
      ),
    )
    .all();
  if (rows.length === 0) return EMPTY(hidden);

  const byGame = new Map<number, GameValues>();
  for (const entry of rows) {
    const values = byGame.get(entry.gameId) ?? {};
    values[entry.metric] = entry.value;
    byGame.set(entry.gameId, values);
  }
  const matchIds = [...new Set(rows.map((entry) => entry.matchId))];
  const context = db
    .select({ matchId: match.id, season, competition, orgSlug: org.slug })
    .from(match)
    .innerJoin(stage, eq(match.stageId, stage.id))
    .innerJoin(season, eq(stage.seasonId, season.id))
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .innerJoin(org, eq(competition.orgId, org.id))
    .where(inArray(match.id, matchIds))
    .all();
  const sides = db
    .select({ matchId: lineup.matchId, side: lineup.side })
    .from(lineupMember)
    .innerJoin(lineup, eq(lineupMember.lineupId, lineup.id))
    .where(and(eq(lineupMember.playerId, playerId), inArray(lineup.matchId, matchIds)))
    .all();
  const games = db
    .select()
    .from(game)
    .where(and(inArray(game.matchId, matchIds), ne(game.status, 'void')))
    .orderBy(asc(game.n))
    .all();
  const leagues = new Map(
    matchIds.flatMap((matchId) =>
      listLeagueMatches(db, { matchId }).map((line) => [matchId, line]),
    ),
  );
  const teamIds = [...leagues.values()].flatMap((line) => [line.a.teamId, line.b.teamId]);
  const teamRefs = new Map(
    db
      .select({ id: team.id, name: team.name, slug: team.slug, tag: team.tag })
      .from(team)
      .where(inArray(team.id, teamIds))
      .all()
      .map((entry) => [entry.id, { name: entry.name, slug: entry.slug, tag: entry.tag }]),
  );

  const shown = manualMetrics(stats).filter((metric) => !(metric.optional ?? false));
  const figures = (values: GameValues): Values => totalsOf(stats, [values]);
  type Played = {
    line: PlayerMatchLine;
    seasonKey: string;
    games: { map: string | null; values: GameValues }[];
  };
  const played: Played[] = [];
  for (const matchId of matchIds) {
    const where = context.find((entry) => entry.matchId === matchId);
    const side = sides.find((entry) => entry.matchId === matchId)?.side;
    const league = leagues.get(matchId);
    if (!where || !side || !league) continue;
    const other = side === 'a' ? 'b' : 'a';
    const own = (row: (typeof games)[number]) => (side === 'a' ? row.scoreA : row.scoreB);
    const theirs = (row: (typeof games)[number]) => (side === 'a' ? row.scoreB : row.scoreA);
    const matchGames = games.filter((row) => row.matchId === matchId && row.forfeitSide === null);
    const won = matchGames.filter((row) => own(row) > theirs(row)).length;
    const lost = matchGames.filter((row) => own(row) < theirs(row)).length;
    const mine = matchGames.filter((row) => byGame.has(row.id));
    const fallback = { name: '', slug: '', tag: '' };
    played.push({
      seasonKey: String(where.season.id),
      games: mine.map((row) => ({ map: row.map, values: byGame.get(row.id) ?? {} })),
      line: {
        id: matchId,
        at: league.scheduledAt ?? league.window.start,
        timed: league.scheduledAt !== null,
        competition: {
          name: where.competition.name,
          path: competitionPath(where.orgSlug, where.competition.slug),
        },
        season: {
          name: where.season.name,
          path: seasonPath(where.orgSlug, where.competition.slug, where.season),
        },
        team: teamRefs.get(league[side].teamId) ?? fallback,
        opponent: teamRefs.get(league[other].teamId) ?? fallback,
        result: won > lost ? 'win' : won < lost ? 'loss' : 'draw',
        games: mine.map((row) => ({
          n: row.n,
          map: row.map,
          scoreFor: own(row),
          scoreAgainst: theirs(row),
          values: hidden ? null : figures(byGame.get(row.id) ?? {}),
        })),
      },
    });
  }
  played.sort((x, y) => y.line.at - x.line.at || y.line.id - x.line.id);
  const matches = played.map((entry) => entry.line);
  if (hidden) return { ...EMPTY(true), matches };

  const seasons: PlayerStats['seasons'] = [];
  for (const entry of played) {
    if (seasons.some((known) => known.season.path === entry.line.season.path)) continue;
    const all = played
      .filter((other) => other.seasonKey === entry.seasonKey)
      .flatMap((other) => other.games);
    seasons.push({
      competition: entry.line.competition,
      season: entry.line.season,
      games: all.length,
      values: totalsOf(
        stats,
        all.map((one) => one.values),
      ),
    });
  }
  const allGames = played.flatMap((entry) => entry.games);
  const mapNames = [
    ...new Set(allGames.flatMap((one) => (one.map === null ? [] : [one.map]))),
  ].sort((x, y) => x.localeCompare(y));
  const maps = mapNames.map((map) => {
    const onMap = allGames.filter((one) => one.map === map);
    return {
      map,
      games: onMap.length,
      values: totalsOf(
        stats,
        onMap.map((one) => one.values),
      ),
    };
  });

  // The grid's metrics, then the ratios that have a value somewhere.
  const derivedShown = stats.derived.filter((derived) =>
    seasons.some((entry) => entry.values[derived.key] !== null),
  );
  const columns: PlayerStatsColumn[] = [
    ...shown.map((metric) => ({ key: metric.key, label: metric.label, format: 'count' as const })),
    ...derivedShown.map((derived) => ({
      key: derived.key,
      label: derived.label,
      format: derived.format,
    })),
  ];
  return { hidden: false, columns, matches, seasons, maps };
}
