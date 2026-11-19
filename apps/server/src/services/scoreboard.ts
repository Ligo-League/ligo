import { listLeagueMatches, schema, type Db } from '@ligo/db';
import { computeDerived, manualMetrics, statsOf } from '@ligo/titles';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';

// The public scoreboard on the match page (design doc sections 7 and 9; M-39): each game's
// figures per side, once the result is validated. Only stats that count are shown: a side the
// opponent entered waits for its own team's confirmation. Players without stats consent are
// named, as in results, but their figures stay hidden (section 7, privacy).

const { competition, game, lineup, lineupMember, match, player, stage, season, stat } = schema;

type Side = 'a' | 'b';

export interface ScoreboardColumn {
  key: string;
  label: { fr: string; en: string };
  format: 'count' | 'ratio' | 'percent' | 'signed';
}

export interface ScoreboardRow {
  playerId: number;
  name: string;
  /** For the link to the player's page. */
  slug: string;
  /** No stats consent: named, figures hidden. */
  hidden: boolean;
  values: Record<string, number | null>;
}

export interface Scoreboard {
  columns: ScoreboardColumn[];
  games: {
    n: number;
    map: string | null;
    sides: { side: Side; team: string; rows: ScoreboardRow[] }[];
  }[];
}

/** The match's scoreboard, or null while there is nothing public to show. */
export function matchScoreboard(db: Pick<Db, 'select'>, matchId: number): Scoreboard | null {
  const found = db
    .select({ status: match.status, title: competition.title })
    .from(match)
    .innerJoin(stage, eq(match.stageId, stage.id))
    .innerJoin(season, eq(stage.seasonId, season.id))
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .where(eq(match.id, matchId))
    .get();
  const stats = found && statsOf(found.title);
  if (found?.status !== 'validated' || !stats) return null;

  const members = db
    .select({
      side: lineup.side,
      teamId: lineup.teamId,
      playerId: player.id,
      name: player.displayName,
      slug: player.slug,
      consent: player.statsConsentAt,
    })
    .from(lineupMember)
    .innerJoin(lineup, eq(lineupMember.lineupId, lineup.id))
    .innerJoin(player, eq(lineupMember.playerId, player.id))
    .where(eq(lineup.matchId, matchId))
    .all();
  const [league] = listLeagueMatches(db, { matchId });
  const games = db
    .select()
    .from(game)
    .where(and(eq(game.matchId, matchId), ne(game.status, 'void')))
    .orderBy(asc(game.n))
    .all()
    .filter((row) => row.forfeitSide === null);
  const playerIds = members.map((row) => row.playerId);
  const rows =
    games.length === 0 || playerIds.length === 0
      ? []
      : db
          .select()
          .from(stat)
          .where(
            and(
              inArray(
                stat.gameId,
                games.map((row) => row.id),
              ),
              inArray(stat.playerId, playerIds),
              eq(stat.verified, true),
            ),
          )
          .all();
  if (rows.length === 0) return null;

  const shownMetrics = manualMetrics(stats).filter((metric) => !(metric.optional ?? false));
  // Best first, by the title's kills when it has them.
  const sortKey = stats.crossCheck?.kills ?? shownMetrics[0]?.key ?? '';
  const usedDerived = new Set<string>();
  const result = games.map((gameRow) => ({
    n: gameRow.n,
    map: gameRow.map,
    sides: (['a', 'b'] as const).map((side) => {
      const sideRows = members
        .filter((member) => member.side === side)
        .flatMap((member): ScoreboardRow[] => {
          const own = rows.filter(
            (entry) => entry.gameId === gameRow.id && entry.playerId === member.playerId,
          );
          if (own.length === 0) return [];
          if (member.consent === null) {
            return [
              {
                playerId: member.playerId,
                name: member.name,
                slug: member.slug,
                hidden: true,
                values: {},
              },
            ];
          }
          const totals = Object.fromEntries(own.map((entry) => [entry.metric, entry.value]));
          const derived = computeDerived(stats, totals);
          for (const [key, value] of Object.entries(derived)) {
            if (value !== null) usedDerived.add(key);
          }
          const values: Record<string, number | null> = {
            ...Object.fromEntries(
              shownMetrics.map((metric) => [metric.key, totals[metric.key] ?? null]),
            ),
            ...derived,
          };
          return [
            {
              playerId: member.playerId,
              name: member.name,
              slug: member.slug,
              hidden: false,
              values,
            },
          ];
        })
        .sort(
          (x, y) =>
            Number(x.hidden) - Number(y.hidden) ||
            (y.values[sortKey] ?? 0) - (x.values[sortKey] ?? 0) ||
            x.name.localeCompare(y.name),
        );
      return { side, team: league?.[side].name ?? '', rows: sideRows };
    }),
  }));
  return {
    columns: [
      ...shownMetrics.map((metric) => ({
        key: metric.key,
        label: metric.label,
        format: 'count' as const,
      })),
      ...stats.derived
        .filter((derived) => usedDerived.has(derived.key))
        .map((derived) => ({ key: derived.key, label: derived.label, format: derived.format })),
    ],
    games: result,
  };
}
