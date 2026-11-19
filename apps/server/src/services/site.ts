import type { ForfeitSide } from '@ligo/core';
import {
  findClub,
  findLeague,
  findRoster,
  listClubRosters,
  listLeagueMatches,
  schema,
  type Db,
  type LeagueMatch,
} from '@ligo/db';
import { and, asc, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { findCompetitionAt, type CompetitionKey } from './competitions.ts';
import { competitionPath, seasonSlug } from './paths.ts';
import { leagueStandings, type StandingsTable } from './standings.ts';
import { listTeamStaff } from './team-staff.ts';
import { seasonMoves, type PublicMove } from './roster-move-data.ts';

// What the public pages of the website show (design doc section 7). Everything here is public:
// results count only once validated, and no evidence or Discord ID leaves this module.

const { competition, division, game, match, org, season, slot, team } = schema;

type SeasonStatus = (typeof season.$inferSelect)['status'];
type Side = 'a' | 'b';

export interface SeasonLink {
  name: string;
  slug: string;
  status: SeasonStatus;
}

export interface LeagueLinks {
  /** `path` is its address, `/:org/:comp`. */
  competition: { name: string; slug: string; path: string };
  seasons: SeasonLink[];
}

const seasonLink = (row: typeof season.$inferSelect): SeasonLink => ({
  name: row.name,
  slug: seasonSlug(row),
  status: row.status,
});

/** Every competition with its seasons, newest first. */
export function listLeagues(db: Pick<Db, 'select'>): LeagueLinks[] {
  const competitions = db
    .select({ row: competition, orgSlug: org.slug })
    .from(competition)
    .innerJoin(org, eq(competition.orgId, org.id))
    .orderBy(asc(competition.name))
    .all();
  return competitions.map(({ row, orgSlug }) => ({
    competition: { name: row.name, slug: row.slug, path: competitionPath(orgSlug, row.slug) },
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
  { kind: 'score'; a: number; b: number } | { kind: 'forfeit'; by: ForfeitSide } | null;

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
      competition: { name: string; slug: string; path: string; timeZone: string };
      season: SeasonLink;
      /** The competition's other seasons, for links. */
      seasons: SeasonLink[];
      standings: StandingsTable[];
      fixtures: DivisionFixtures[];
      /** Results that count, latest week first. */
      latest: MatchLine[];
      /** The season's approved mercato moves, latest first. */
      moves: PublicMove[];
    }
  | { ok: false; error: 'not_found' };

const LATEST_RESULTS = 10;

/** A season's page: standings, fixtures by division and week, and the latest results. */
export function seasonPage(
  db: Pick<Db, 'select'>,
  key: CompetitionKey,
  wantedSeason: string,
): SeasonPage {
  const found = findCompetitionAt(db, key);
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
      path: found.path,
      timeZone: found.schedulingJson.time_zone,
    },
    season: seasonLink(row),
    seasons: seasons.map(seasonLink),
    standings: standings.ok ? standings.tables : [],
    fixtures,
    latest,
    moves: seasonMoves(db, row.id, null),
  };
}

/** Where a roster plays: the latest season it has a place in, if any. */
interface Place {
  competition: { name: string; slug: string; path: string; timeZone: string };
  season: SeasonLink;
  division: string;
  seasonId: number;
}

function latestPlace(db: Pick<Db, 'select'>, teamId: number): Place | null {
  const latest = db
    .select({ season, competition, division: division.name, orgSlug: org.slug })
    .from(slot)
    .innerJoin(division, eq(slot.divisionId, division.id))
    .innerJoin(season, eq(division.seasonId, season.id))
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .innerJoin(org, eq(competition.orgId, org.id))
    .where(and(eq(slot.teamId, teamId), ne(season.status, 'registration')))
    .orderBy(desc(season.startsOn), desc(season.id))
    .get();
  if (!latest) return null;
  return {
    competition: {
      name: latest.competition.name,
      slug: latest.competition.slug,
      path: competitionPath(latest.orgSlug, latest.competition.slug),
      timeZone: latest.competition.schedulingJson.time_zone,
    },
    season: seasonLink(latest.season),
    division: latest.division,
    seasonId: latest.season.id,
  };
}

/**
 * A roster's players in the latest season it has a roster in, registration included, so an
 * approved team shows its players before its season starts: starters first, the captain marked.
 */
export function rosterPlayers(
  db: Pick<Db, 'select'>,
  teamId: number,
): { name: string; role: (typeof schema.rosterEntry.$inferSelect)['role']; captain: boolean }[] {
  const { player, rosterEntry } = schema;
  const rosterSeason = db
    .select({ seasonId: rosterEntry.seasonId })
    .from(rosterEntry)
    .innerJoin(season, eq(rosterEntry.seasonId, season.id))
    .where(and(eq(rosterEntry.teamId, teamId), isNull(rosterEntry.validTo)))
    .orderBy(desc(season.startsOn), desc(season.id))
    .get();
  if (!rosterSeason) return [];
  return db
    .select({ name: player.displayName, role: rosterEntry.role, captain: rosterEntry.captain })
    .from(rosterEntry)
    .innerJoin(player, eq(rosterEntry.playerId, player.id))
    .where(
      and(
        eq(rosterEntry.teamId, teamId),
        eq(rosterEntry.seasonId, rosterSeason.seasonId),
        isNull(rosterEntry.validTo),
      ),
    )
    .orderBy(asc(rosterEntry.role), asc(player.displayName))
    .all();
}

export type TeamPage =
  | {
      ok: true;
      team: TeamLink & { logoKey: string | null; colors: string[] };
      club: { name: string; slug: string };
      /** The club's other rosters. */
      siblings: TeamLink[];
      officials: { name: string; role: string }[];
      /** Its roster of the latest season it has one: starters first, the captain marked. */
      players: { name: string; role: string; captain: boolean }[];
      /** Its approved mercato moves of that season, latest first. */
      moves: PublicMove[];
      /** The latest season the team plays in, if any. */
      season: Omit<Place, 'seasonId'> | null;
      matches: MatchLine[];
    }
  | { ok: false; error: 'not_found' };

/** A team's page: its club, its officials, and its matches of the latest season it plays in. */
export function teamPage(db: Pick<Db, 'select'>, slug: string): TeamPage {
  const roster = findRoster(db, { slug });
  if (!roster) return { ok: false, error: 'not_found' };
  const officials = listTeamStaff(db, roster.teamId).map((member) => ({
    name: member.displayName,
    role: member.role,
  }));
  const place = latestPlace(db, roster.teamId);
  const matches = place
    ? listLeagueMatches(db, { seasonId: place.seasonId }).filter(
        (found) => found.a.teamId === roster.teamId || found.b.teamId === roster.teamId,
      )
    : [];
  const players = rosterPlayers(db, roster.teamId);
  const moves = place ? seasonMoves(db, place.seasonId, roster.teamId) : [];
  const siblings = listClubRosters(db, roster.club.id)
    .filter((other) => other.teamId !== roster.teamId)
    .map((other) => ({ name: other.name, tag: other.tag, slug: other.slug }));
  return {
    ok: true,
    team: {
      name: roster.name,
      tag: roster.tag,
      slug: roster.slug,
      logoKey: roster.logoKey,
      colors: roster.colors,
    },
    club: { name: roster.club.name, slug: roster.club.slug },
    siblings,
    officials,
    players,
    moves,
    season: place && {
      competition: place.competition,
      season: place.season,
      division: place.division,
    },
    matches: linesOf(db, matches),
  };
}

export type ClubPage =
  | {
      ok: true;
      club: { name: string; city: string | null; colors: string[]; logoKey: string | null };
      /** Each roster, with where it plays now. */
      rosters: (TeamLink & { place: Omit<Place, 'seasonId'> | null })[];
    }
  | { ok: false; error: 'not_found' };

/** A club's page: its rosters and where each plays. */
export function clubPage(db: Pick<Db, 'select'>, slug: string): ClubPage {
  const found = findClub(db, slug);
  if (!found) return { ok: false, error: 'not_found' };
  const rosters = listClubRosters(db, found.id).map((roster) => {
    const place = latestPlace(db, roster.teamId);
    return {
      name: roster.name,
      tag: roster.tag,
      slug: roster.slug,
      place: place && {
        competition: place.competition,
        season: place.season,
        division: place.division,
      },
    };
  });
  return {
    ok: true,
    club: {
      name: found.name,
      city: found.city,
      colors: found.colorsJson,
      logoKey: found.logoKey,
    },
    rosters,
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
        competition: { name: string; slug: string; path: string; timeZone: string };
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
    .select({ season, competition, hostSide: match.hostSide, orgSlug: org.slug })
    .from(match)
    .innerJoin(schema.stage, eq(match.stageId, schema.stage.id))
    .innerJoin(season, eq(schema.stage.seasonId, season.id))
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .innerJoin(org, eq(competition.orgId, org.id))
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
        path: competitionPath(context.orgSlug, context.competition.slug),
        timeZone: context.competition.schedulingJson.time_zone,
      },
      season: seasonLink(context.season),
    },
    host: context.hostSide ? nameOf(context.hostSide) : null,
    games,
  };
}
