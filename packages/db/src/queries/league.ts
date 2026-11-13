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

export interface GuildLeague {
  guild: typeof leagueGuild.$inferSelect;
  org: typeof org.$inferSelect;
  competition: typeof competition.$inferSelect;
  /** The latest season that has left registration; undefined before the first one starts. */
  season: typeof season.$inferSelect | undefined;
  /** That season's divisions, top level first, each with its league stage when it has one. */
  divisions: { division: typeof division.$inferSelect; stageId: number | undefined }[];
}

/**
 * The league a Discord server belongs to. Each server maps to one competition through
 * `league_guild`, found by the stored guild ID, so commands never ask which league.
 */
export function findGuildLeague(db: Pick<Db, 'select'>, guildId: string): GuildLeague | undefined {
  const found = db
    .select({ guild: leagueGuild, org, competition })
    .from(leagueGuild)
    .innerJoin(competition, eq(leagueGuild.competitionId, competition.id))
    .innerJoin(org, eq(competition.orgId, org.id))
    .where(eq(leagueGuild.guildId, guildId))
    .get();
  if (!found) return undefined;

  const seasonRow = db
    .select()
    .from(season)
    .where(and(eq(season.competitionId, found.competition.id), ne(season.status, 'registration')))
    .orderBy(desc(season.startsOn), desc(season.id))
    .get();
  if (!seasonRow) return { ...found, season: undefined, divisions: [] };

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
