import {
  matchChannelKey,
  matchChannelPlan,
  stageConfigSchema,
  type ChannelMatch,
  type DiscordSettings,
  type MatchChannelPlan,
} from '@ligo/core';
import { listLeagueMatches, schema, type Db } from '@ligo/db';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { teamRoleKey } from './team-roles.ts';

// Match channels (phase 4; design doc section 6, "Match channel lifecycle"): the competition's
// matches as `@ligo/core` matchChannelPlan takes them. A match counts from `validated_at`, which a
// validation, a forfeit and an annulment all set.

const { discordObject, division, match, season, stage } = schema;
type Reader = Pick<Db, 'select'>;

const COUNTED = new Set(['validated', 'forfeit', 'void']);

export interface MatchChannelTarget {
  competitionId: number;
  guildId: string;
  staffRoleId: string;
  settings: DiscordSettings;
  /** The team role keys the server should hold: a team without one gets no overwrite. */
  teamRoleKeys: ReadonlySet<string>;
  botUserId: string | null;
  now: number;
}

/** The competition's matches with a division and a week, in seasons not closed yet. */
export function channelMatches(db: Reader, competitionId: number): ChannelMatch[] {
  const seasons = db
    .select({ id: season.id })
    .from(season)
    .where(and(eq(season.competitionId, competitionId), ne(season.status, 'closed')))
    .all();
  const found = seasons.flatMap((row) => listLeagueMatches(db, { seasonId: row.id }));
  const ids = found.map((entry) => entry.id);
  if (ids.length === 0) return [];
  const rows = new Map(
    db
      .select({ id: match.id, validatedAt: match.validatedAt, config: stage.configJson })
      .from(match)
      .innerJoin(stage, eq(match.stageId, stage.id))
      .where(inArray(match.id, ids))
      .all()
      .map((row) => [row.id, row]),
  );
  const divisionIds = [
    ...new Set(found.flatMap((entry) => (entry.division ? [entry.division.id] : []))),
  ];
  const staffRoles = new Map(
    divisionIds.length === 0
      ? []
      : db
          .select({ id: division.id, staffRoleId: division.staffRoleId })
          .from(division)
          .where(inArray(division.id, divisionIds))
          .all()
          .map((row) => [row.id, row.staffRoleId]),
  );
  return found.flatMap((entry): ChannelMatch[] => {
    const row = rows.get(entry.id);
    if (!entry.division || entry.week === null || !row) return [];
    const { week } = entry;
    const opened = stageConfigSchema.parse(row.config).opened_weeks;
    return [
      {
        id: entry.id,
        division: {
          id: entry.division.id,
          prefix: entry.division.categoryPrefix,
          staffRoleId: staffRoles.get(entry.division.id) ?? null,
        },
        week,
        windowStart: entry.window.start,
        // An old annulment has no time: its channel, if any, is archived at once.
        countedAt: COUNTED.has(entry.status) ? (row.validatedAt ?? 0) : null,
        openEarly: opened.includes(week),
        a: { tag: entry.a.tag, roleKey: teamRoleKey(entry.a.teamId) },
        b: { tag: entry.b.tag, roleKey: teamRoleKey(entry.b.teamId) },
      },
    ];
  });
}

/** The match channels and their categories the competition's server should hold now. */
export function desiredMatchChannels(db: Reader, target: MatchChannelTarget): MatchChannelPlan {
  const existing = new Set(
    db
      .select({ key: discordObject.key })
      .from(discordObject)
      .where(
        and(eq(discordObject.guildId, target.guildId), eq(discordObject.kind, 'match_channel')),
      )
      .all()
      .map((row) => row.key),
  );
  const matches = channelMatches(db, target.competitionId).map((entry) => ({
    ...entry,
    a: { ...entry.a, roleKey: keep(entry.a.roleKey, target.teamRoleKeys) },
    b: { ...entry.b, roleKey: keep(entry.b.roleKey, target.teamRoleKeys) },
  }));
  return matchChannelPlan(matches, {
    settings: target.settings,
    everyoneId: target.guildId,
    staffRoleId: target.staffRoleId,
    botUserId: target.botUserId,
    existing,
    now: target.now,
  });
}

const keep = (key: string | null, keys: ReadonlySet<string>) =>
  key !== null && keys.has(key) ? key : null;

/** The match's own channel in a server, when Ligo made one there; null otherwise. */
export function matchChannelIn(db: Reader, guildId: string, matchId: number): string | null {
  return (
    db
      .select({ id: discordObject.discordId })
      .from(discordObject)
      .where(
        and(
          eq(discordObject.guildId, guildId),
          eq(discordObject.kind, 'match_channel'),
          eq(discordObject.key, matchChannelKey(matchId)),
        ),
      )
      .get()?.id ?? null
  );
}

/** The match's own channel in its competition's server, when it has one. */
export function matchChannelOf(db: Reader, matchId: number): string | null {
  const row = db
    .select({ guildId: schema.leagueGuild.guildId })
    .from(match)
    .innerJoin(stage, eq(match.stageId, stage.id))
    .innerJoin(season, eq(stage.seasonId, season.id))
    .innerJoin(schema.leagueGuild, eq(schema.leagueGuild.competitionId, season.competitionId))
    .where(eq(match.id, matchId))
    .get();
  return row ? matchChannelIn(db, row.guildId, matchId) : null;
}

/**
 * Where a match's notifications go (design doc section 6, maintainer, 13 November 2026): its own
 * channel once it has one, so the two teams answer where only they and staff read; until then,
 * the league's schedule channel.
 */
export function matchPostChannel(
  db: Reader,
  guild: { guildId: string; scheduleChannelId: string | null },
  matchId: number,
): string | null {
  return matchChannelIn(db, guild.guildId, matchId) ?? guild.scheduleChannelId;
}
