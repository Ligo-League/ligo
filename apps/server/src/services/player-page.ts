import { computeStandings } from '@ligo/core';
import { loadStandingsInput, schema, type Db } from '@ligo/db';
import type { Title } from '@ligo/titles';
import { and, asc, desc, eq, isNull, ne } from 'drizzle-orm';
import { competitionPath, seasonPath } from './paths.ts';

// A player's public page (phase 3i; design doc section 7, M-42, maintainer, 19 November 2026).
// Every account has one. It shows the person once: nationality, current teams, each game
// account's in-game name and declared rank, and the career (season lineups, with the team's
// division and rank). It never gives the Ubisoft profile ID, the birth date, the Discord ID or
// the email. A game gets its tab once a stat sheet (later a replay) names the player in a
// validated match: a lineup kept without stats does not say who played.

const {
  competition,
  division,
  game,
  gameAccount,
  match,
  org,
  player,
  rosterEntry,
  rosterPlayer,
  season,
  slot,
  stage,
  stat,
  team,
} = schema;
type Reader = Pick<Db, 'select'>;
type Role = (typeof schema.ROSTER_ROLES)[number];
type SeasonStatus = (typeof schema.SEASON_STATUSES)[number];

export interface PlayerTeam {
  title: Title;
  name: string;
  slug: string;
  tag: string;
  /** Their place in the season lineup; null for a player only on the roster's own list. */
  role: Role | null;
  captain: boolean;
}

export interface CareerLine {
  title: Title;
  competition: { name: string; path: string };
  season: { name: string; path: string; status: SeasonStatus };
  team: { name: string; slug: string; tag: string };
  /** Null while the team has no division (a registration not yet placed). */
  division: string | null;
  /** The team's rank in its division: current while the season runs, final once closed. */
  rank: { place: number; shared: boolean; excluded: boolean } | null;
  role: Role;
}

export interface PlayerPageData {
  id: number;
  slug: string;
  name: string;
  /** ISO country code; the page names it. */
  nationality: string | null;
  /** The player accepted public stats. */
  statsPublic: boolean;
  teams: PlayerTeam[];
  /** In-game names and declared ranks; never the profile ID. */
  accounts: { title: Title; name: string; rank: string | null; verified: boolean }[];
  /** Season lineups, the latest season first. */
  career: CareerLine[];
  /** The games played officially, the one of the latest such match first. */
  games: Title[];
}

export type PlayerPageReply =
  { ok: true; player: PlayerPageData } | { ok: false; error: 'not_found' };

/** The teams a player is in now: season lineups not ended, then rosters' own lists. */
function currentTeams(db: Reader, playerId: number): PlayerTeam[] {
  const entries = db
    .select({ team, role: rosterEntry.role, captain: rosterEntry.captain })
    .from(rosterEntry)
    .innerJoin(season, eq(rosterEntry.seasonId, season.id))
    .innerJoin(team, eq(rosterEntry.teamId, team.id))
    .where(
      and(
        eq(rosterEntry.playerId, playerId),
        isNull(rosterEntry.validTo),
        ne(season.status, 'closed'),
      ),
    )
    .orderBy(desc(season.startsOn), asc(team.name))
    .all();
  const lists = db
    .select({ team })
    .from(rosterPlayer)
    .innerJoin(team, eq(rosterPlayer.teamId, team.id))
    .where(and(eq(rosterPlayer.playerId, playerId), isNull(rosterPlayer.leftAt)))
    .orderBy(asc(team.name))
    .all();
  const teams: PlayerTeam[] = [];
  const add = (row: typeof team.$inferSelect, role: Role | null, captain: boolean) => {
    if (teams.some((known) => known.slug === row.slug)) return;
    teams.push({ title: row.title, name: row.name, slug: row.slug, tag: row.tag, role, captain });
  };
  for (const entry of entries) add(entry.team, entry.role, entry.captain);
  for (const entry of lists) add(entry.team, null, false);
  return teams;
}

/** The team's rank in its division's round robin, or null when it has none yet. */
function rankIn(db: Reader, divisionId: number, teamId: number): CareerLine['rank'] {
  const robin = db
    .select({ id: stage.id })
    .from(stage)
    .where(and(eq(stage.divisionId, divisionId), eq(stage.kind, 'round_robin')))
    .orderBy(asc(stage.ord), asc(stage.id))
    .get();
  const data = robin && loadStandingsInput(db, robin.id);
  const entry = data?.teams.find((candidate) => candidate.teamId === teamId);
  if (!data || !entry) return null;
  const standings = computeStandings(data.input);
  const row = standings.ok
    ? standings.rows.find((candidate) => candidate.entry === entry.entry)
    : undefined;
  return row ? { place: row.rank, shared: row.shared, excluded: row.excluded } : null;
}

/** One line per season and team the player was in the lineup of, the latest season first. */
function career(db: Reader, playerId: number): CareerLine[] {
  const rows = db
    .select({
      season,
      competition,
      orgSlug: org.slug,
      team,
      role: rosterEntry.role,
      validFrom: rosterEntry.validFrom,
    })
    .from(rosterEntry)
    .innerJoin(season, eq(rosterEntry.seasonId, season.id))
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .innerJoin(org, eq(competition.orgId, org.id))
    .innerJoin(team, eq(rosterEntry.teamId, team.id))
    .where(eq(rosterEntry.playerId, playerId))
    .orderBy(desc(season.startsOn), desc(season.id), desc(rosterEntry.validFrom))
    .all();
  const lines: CareerLine[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    // A player moved within a season has one entry per stint: the latest gives the role.
    const key = `${String(row.season.id)}:${String(row.team.id)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const place = db
      .select({ id: division.id, name: division.name })
      .from(slot)
      .innerJoin(division, eq(slot.divisionId, division.id))
      .where(and(eq(slot.teamId, row.team.id), eq(division.seasonId, row.season.id)))
      .get();
    lines.push({
      title: row.competition.title,
      competition: {
        name: row.competition.name,
        path: competitionPath(row.orgSlug, row.competition.slug),
      },
      season: {
        name: row.season.name,
        path: seasonPath(row.orgSlug, row.competition.slug, row.season),
        status: row.season.status,
      },
      team: { name: row.team.name, slug: row.team.slug, tag: row.team.tag },
      division: place?.name ?? null,
      rank: place ? rankIn(db, place.id, row.team.id) : null,
      role: row.role,
    });
  }
  return lines;
}

/**
 * The games the player played officially: a verified stat in a game of a validated match. The
 * game of the latest such match comes first; the page opens on it.
 */
function gamesPlayed(db: Reader, playerId: number): Title[] {
  const rows = db
    .select({
      title: competition.title,
      at: match.scheduledAt,
      windowStart: match.windowStart,
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
      ),
    )
    .all();
  const latest = new Map<Title, number>();
  for (const row of rows) {
    const at = row.at ?? row.windowStart;
    latest.set(row.title, Math.max(latest.get(row.title) ?? at, at));
  }
  return [...latest.entries()].sort((x, y) => y[1] - x[1]).map(([title]) => title);
}

/** The public page of the player at `/players/:slug`. */
export function playerPage(db: Reader, slug: string): PlayerPageReply {
  const row = db.select().from(player).where(eq(player.slug, slug)).get();
  if (!row) return { ok: false, error: 'not_found' };
  const accounts = db
    .select({
      title: gameAccount.title,
      name: gameAccount.displayName,
      rank: gameAccount.rank,
      verified: gameAccount.verified,
    })
    .from(gameAccount)
    .where(eq(gameAccount.playerId, row.id))
    .orderBy(asc(gameAccount.title))
    .all();
  return {
    ok: true,
    player: {
      id: row.id,
      slug: row.slug,
      name: row.displayName,
      nationality: row.nationality,
      statsPublic: row.statsConsentAt !== null,
      teams: currentTeams(db, row.id),
      accounts,
      career: career(db, row.id),
      games: gamesPlayed(db, row.id),
    },
  };
}
