import { and, asc, desc, eq, ne } from 'drizzle-orm';
import type { Db } from '../client.ts';
import {
  competition,
  division,
  leagueGuild,
  org,
  season,
  slot,
  stage,
  team,
} from '../schema/index.ts';

/** A competition with one of its seasons, as the commands and the website read it. */
export interface League {
  org: typeof org.$inferSelect;
  competition: typeof competition.$inferSelect;
  /** The season asked for, or the latest that has left registration; undefined before any. */
  season: typeof season.$inferSelect | undefined;
  /** That season's divisions, top level first, each with its league stage when it has one. */
  divisions: { division: typeof division.$inferSelect; stageId: number | undefined }[];
}

export interface GuildLeague extends League {
  guild: typeof leagueGuild.$inferSelect;
}

/**
 * The league a Discord server belongs to. Each server maps to one competition through
 * `league_guild`, found by the stored guild ID, so commands never ask which league.
 */
export function findGuildLeague(db: Pick<Db, 'select'>, guildId: string): GuildLeague | undefined {
  const found = db
    .select({ guild: leagueGuild })
    .from(leagueGuild)
    .where(eq(leagueGuild.guildId, guildId))
    .get();
  if (!found) return undefined;
  const league = findLeague(db, found.guild.competitionId);
  return league && { ...league, guild: found.guild };
}

/**
 * A competition with one of its seasons: `seasonId`, or by default the latest season that has
 * left registration. Undefined when the competition, or the season asked for, is not there.
 */
export function findLeague(
  db: Pick<Db, 'select'>,
  competitionId: number,
  seasonId?: number,
): League | undefined {
  const found = db
    .select({ org, competition })
    .from(competition)
    .innerJoin(org, eq(competition.orgId, org.id))
    .where(eq(competition.id, competitionId))
    .get();
  if (!found) return undefined;

  const seasonRow =
    seasonId === undefined
      ? db
          .select()
          .from(season)
          .where(
            and(eq(season.competitionId, found.competition.id), ne(season.status, 'registration')),
          )
          .orderBy(desc(season.startsOn), desc(season.id))
          .get()
      : db
          .select()
          .from(season)
          .where(and(eq(season.competitionId, found.competition.id), eq(season.id, seasonId)))
          .get();
  if (!seasonRow) {
    return seasonId === undefined ? { ...found, season: undefined, divisions: [] } : undefined;
  }

  const divisions = db
    .select()
    .from(division)
    .where(eq(division.seasonId, seasonRow.id))
    .orderBy(asc(division.level), asc(division.name))
    .all();
  const stages = db
    .select()
    .from(stage)
    .where(and(eq(stage.seasonId, seasonRow.id), eq(stage.kind, 'round_robin')))
    .orderBy(asc(stage.ord), asc(stage.id))
    .all();

  return {
    ...found,
    season: seasonRow,
    divisions: divisions.map((row) => ({
      division: row,
      stageId: stages.find((candidate) => candidate.divisionId === row.id)?.id,
    })),
  };
}

export interface SeasonTeam {
  teamId: number;
  slotId: number;
  name: string;
  tag: string;
  division: string;
}

/** The teams holding a slot in a season, by division level then name. */
export function listSeasonTeams(db: Pick<Db, 'select'>, seasonId: number): SeasonTeam[] {
  return db
    .select({
      teamId: team.id,
      slotId: slot.id,
      name: team.name,
      tag: team.tag,
      division: division.name,
    })
    .from(slot)
    .innerJoin(division, eq(slot.divisionId, division.id))
    .innerJoin(team, eq(slot.teamId, team.id))
    .where(eq(division.seasonId, seasonId))
    .orderBy(asc(division.level), asc(team.name))
    .all();
}
