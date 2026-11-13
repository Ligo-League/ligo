import { listLeagueMatches, schema, type Db, type LeagueMatch, type Theme } from '@ligo/db';
import { and, eq } from 'drizzle-orm';

// What the social image of one match shows (design doc section 11), read from the database so
// that the picture always matches the stored state.

const { competition, game, season, team } = schema;

export interface MatchCardTeam {
  name: string;
  colors: string[];
  logoKey: string | null;
}

export interface MatchCardFacts {
  match: LeagueMatch;
  competition: string;
  season: string;
  theme: Theme;
  /** The league's time zone: a picture shows one time, so it says which zone. */
  timeZone: string;
  teams: { a: MatchCardTeam; b: MatchCardTeam };
  /** The first game's map, when the veto or a report named it. */
  map: string | null;
}

export function matchCardFacts(
  db: Pick<Db, 'select'>,
  matchId: number,
): MatchCardFacts | undefined {
  const [found] = listLeagueMatches(db, { matchId });
  if (!found) return undefined;
  const context = db
    .select({ competition, season })
    .from(season)
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .where(eq(season.id, found.seasonId))
    .get();
  if (!context) return undefined;
  const teamOf = (teamId: number): MatchCardTeam => {
    const row = db
      .select({ name: team.name, colors: team.colorsJson, logoKey: team.logoKey })
      .from(team)
      .where(eq(team.id, teamId))
      .get();
    // The match's teams come from the same database read: a missing one is corrupt data.
    if (!row) throw new Error(`Team ${teamId} of match ${found.id} not found`);
    return row;
  };
  const first = db
    .select({ map: game.map })
    .from(game)
    .where(and(eq(game.matchId, found.id), eq(game.n, 1)))
    .get();
  return {
    match: found,
    competition: context.competition.name,
    season: context.season.name,
    theme: context.competition.themeJson,
    timeZone: context.competition.schedulingJson.time_zone,
    teams: { a: teamOf(found.a.teamId), b: teamOf(found.b.teamId) },
    map: first?.map ?? null,
  };
}
