import { slugify } from '@ligo/core';
import { findLeague, listLeagueMatches, schema, type Db, type LeagueMatch } from '@ligo/db';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { leagueStandings, type StandingsTable } from './standings.ts';
import { listTeamStaff } from './team-staff.ts';

// What the public pages of the website show (design doc section 7). Everything here is public:
// results count only once validated, and no evidence or Discord ID leaves this module.

const { competition, division, game, match, season, slot, team } = schema;

type SeasonStatus = (typeof season.$inferSelect)['status'];
type Side = 'a' | 'b';

export interface SeasonLink {
  name: string;
  slug: string;
  status: SeasonStatus;
}

export interface LeagueLinks {
  competition: { name: string; slug: string };
  seasons: SeasonLink[];
}

/** A season's URL part: its name as a slug, or its ID for a name with no Latin letter. */
export function seasonSlug(row: { id: number; name: string }): string {
  const slug = slugify(row.name);
  return slug.ok ? slug.slug : `season-${String(row.id)}`;
}

const seasonLink = (row: typeof season.$inferSelect): SeasonLink => ({
  name: row.name,
  slug: seasonSlug(row),
  status: row.status,
});

/** Every competition with its seasons, newest first. */
export function listLeagues(db: Pick<Db, 'select'>): LeagueLinks[] {
  const competitions = db.select().from(competition).orderBy(asc(competition.name)).all();
  return competitions.map((row) => ({
    competition: { name: row.name, slug: row.slug },
    seasons: db
      .select()
      .from(season)
      .where(eq(season.competitionId, row.id))
      .orderBy(desc(season.startsOn), desc(season.id))
      .all()
      .map(seasonLink),
  }));
}

export interface TeamLink {
  name: string;
  tag: string;
  slug: string;
}

/** What a match's public line shows. A score appears only once the result counts. */
export type MatchResult =
  { kind: 'score'; a: number; b: number } | { kind: 'forfeit'; by: Side } | null;

export interface MatchLine {
  id: number;
  division: string | null;
  week: number | null;
  status: LeagueMatch['status'];
  a: TeamLink;
  b: TeamLink;
  scheduledAt: number | null;
  result: MatchResult;
}

const counts = (status: LeagueMatch['status']) => status === 'validated' || status === 'forfeit';

function resultOf(found: LeagueMatch): MatchResult {
  if (!counts(found.status) || !found.game) return null;
  const { scoreA, scoreB, forfeitSide } = found.game;
  if (forfeitSide) return { kind: 'forfeit', by: forfeitSide };
  return { kind: 'score', a: scoreA, b: scoreB };
}

function teamSlugs(db: Pick<Db, 'select'>, ids: readonly number[]): Map<number, string> {
  if (ids.length === 0) return new Map();
  const rows = db
    .select({ id: team.id, slug: team.slug })
    .from(team)
    .where(inArray(team.id, [...new Set(ids)]))
    .all();
  return new Map(rows.map((row) => [row.id, row.slug]));
}

function linesOf(db: Pick<Db, 'select'>, matches: readonly LeagueMatch[]): MatchLine[] {
  const slugs = teamSlugs(
    db,
    matches.flatMap((found) => [found.a.teamId, found.b.teamId]),
  );
  const link = (side: LeagueMatch['a']): TeamLink => ({
    name: side.name,
    tag: side.tag,
    slug: slugs.get(side.teamId) ?? '',
  });
  return matches.map((found) => ({
    id: found.id,
    division: found.division?.name ?? null,
    week: found.week,
    status: found.status,
    a: link(found.a),
    b: link(found.b),
    scheduledAt: found.scheduledAt,
    result: resultOf(found),
  }));
}

export interface DivisionFixtures {
  division: string;
  weeks: { week: number | null; matches: MatchLine[] }[];
}

export type SeasonPage =
  | {
      ok: true;
      competition: { name: string; slug: string; timeZone: string };
      season: SeasonLink;
      /** The competition's other seasons, for links. */
      seasons: SeasonLink[];
      standings: StandingsTable[];
      fixtures: DivisionFixtures[];
      /** Results that count, latest week first. */
      latest: MatchLine[];
    }
  | { ok: false; error: 'not_found' };

const LATEST_RESULTS = 10;

function findCompetition(db: Pick<Db, 'select'>, slug: string) {
  // One instance holds the group's leagues; their slugs do not repeat across organisations.
  return db
    .select()
    .from(competition)
    .where(eq(competition.slug, slug))
    .orderBy(asc(competition.id))
    .get();
}

/** A season's page: standings, fixtures by division and week, and the latest results. */
export function seasonPage(
  db: Pick<Db, 'select'>,
  competitionSlug: string,
  wantedSeason: string,
): SeasonPage {
  const found = findCompetition(db, competitionSlug);
  if (!found) return { ok: false, error: 'not_found' };
  const seasons = db
    .select()
    .from(season)
    .where(eq(season.competitionId, found.id))
    .orderBy(desc(season.startsOn), desc(season.id))
    .all();
  const row = seasons.find((candidate) => seasonSlug(candidate) === wantedSeason);
  const league = row && findLeague(db, found.id, row.id);
  if (!row || !league) return { ok: false, error: 'not_found' };

  const standings = leagueStandings(db, league);
  const lines = linesOf(db, listLeagueMatches(db, { seasonId: row.id }));
  const fixtures: DivisionFixtures[] = [];
  for (const line of lines) {
    const name = line.division ?? '';
    let group = fixtures.find((candidate) => candidate.division === name);
    if (!group) {
      group = { division: name, weeks: [] };
      fixtures.push(group);
    }
    let week = group.weeks.find((candidate) => candidate.week === line.week);
    if (!week) {
      week = { week: line.week, matches: [] };
      group.weeks.push(week);
    }
    week.matches.push(line);
  }
  const latest = lines
    .filter((line) => line.result !== null)
    .sort((x, y) => (y.week ?? 0) - (x.week ?? 0))
    .slice(0, LATEST_RESULTS);

  return {
    ok: true,
    competition: {
      name: found.name,
      slug: found.slug,
      timeZone: found.schedulingJson.time_zone,
    },
    season: seasonLink(row),
    seasons: seasons.map(seasonLink),
    standings: standings.ok ? standings.tables : [],
    fixtures,
    latest,
  };
}

export type TeamPage =
  | {
      ok: true;
      team: TeamLink & { logoKey: string | null; colors: string[] };
      officials: { name: string; role: string }[];
      /** The latest season the team plays in, if any. */
      season: {
        competition: { name: string; slug: string; timeZone: string };
        season: SeasonLink;
        division: string;
      } | null;
      matches: MatchLine[];
    }
  | { ok: false; error: 'not_found' };

/** A team's page: its officials, and its matches of the latest season it plays in. */
export function teamPage(db: Pick<Db, 'select'>, slug: string): TeamPage {
  const row = db.select().from(team).where(eq(team.slug, slug)).orderBy(asc(team.id)).get();
  if (!row) return { ok: false, error: 'not_found' };
  const officials = listTeamStaff(db, row.id).map((member) => ({
    name: member.displayName,
    role: member.role,
  }));
  const latest = db
    .select({ season, competition, division: division.name })
    .from(slot)
    .innerJoin(division, eq(slot.divisionId, division.id))
    .innerJoin(season, eq(division.seasonId, season.id))
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .where(and(eq(slot.teamId, row.id), ne(season.status, 'registration')))
    .orderBy(desc(season.startsOn), desc(season.id))
    .get();
  const matches = latest
    ? listLeagueMatches(db, { seasonId: latest.season.id }).filter(
        (found) => found.a.teamId === row.id || found.b.teamId === row.id,
      )
    : [];
  return {
    ok: true,
    team: {
      name: row.name,
      tag: row.tag,
      slug: row.slug,
      logoKey: row.logoKey,
      colors: row.colorsJson,
    },
    officials,
    season: latest
      ? {
          competition: {
            name: latest.competition.name,
            slug: latest.competition.slug,
            timeZone: latest.competition.schedulingJson.time_zone,
          },
          season: seasonLink(latest.season),
          division: latest.division,
        }
      : null,
    matches: linesOf(db, matches),
  };
}

export interface GameLine {
  n: number;
  map: string | null;
  /** Null until the result counts. */
  score: { a: number; b: number } | null;
  bans: { team: string; map: string }[];
}

export type MatchPage =
  | {
      ok: true;
      match: MatchLine;
      league: {
        competition: { name: string; slug: string; timeZone: string };
        season: SeasonLink;
      };
      /** The host the veto named; null when the teams agree on it, or before the veto. */
      host: string | null;
      games: GameLine[];
    }
  | { ok: false; error: 'not_found' };

/** A match's page: its teams, time, result, and each game's map and bans. */
export function matchPage(db: Pick<Db, 'select'>, matchId: number): MatchPage {
  const [found] = listLeagueMatches(db, { matchId });
  if (!found) return { ok: false, error: 'not_found' };
  const [line] = linesOf(db, [found]);
  const context = db
    .select({ season, competition, hostSide: match.hostSide })
    .from(match)
    .innerJoin(schema.stage, eq(match.stageId, schema.stage.id))
    .innerJoin(season, eq(schema.stage.seasonId, season.id))
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .where(eq(match.id, found.id))
    .get();
  if (!line || !context) return { ok: false, error: 'not_found' };
  const nameOf = (side: Side) => found[side].name;
  const games = db
    .select()
    .from(game)
    .where(and(eq(game.matchId, found.id), ne(game.status, 'void')))
    .orderBy(asc(game.n))
    .all()
    .map((row): GameLine => ({
      n: row.n,
      map: row.map,
      score: counts(found.status) ? { a: row.scoreA, b: row.scoreB } : null,
      bans: row.bansJson.map((ban) => ({ team: nameOf(ban.side), map: ban.map })),
    }));
  return {
    ok: true,
    match: line,
    league: {
      competition: {
        name: context.competition.name,
        slug: context.competition.slug,
        timeZone: context.competition.schedulingJson.time_zone,
      },
      season: seasonLink(context.season),
    },
    host: context.hostSide ? nameOf(context.hostSide) : null,
    games,
  };
}
