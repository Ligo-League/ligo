import {
  roundRobin,
  rulesetSchema,
  schedulingSchema,
  seasonCalendar,
  stageConfigSchema,
  type StageConfig,
} from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { and, asc, count, countDistinct, eq } from 'drizzle-orm';
import { z } from 'zod';
import { openSeason } from './admin-seasons.ts';
import { markWeekOpen, stageHasWeek } from './week-open.ts';
import type { OrgUser } from './orgs.ts';

// A season's schedule (phase 4; design doc section 5, "Scheduling"; M-45, maintainer,
// 20 November 2026). For each division, staff keep a draft: the round robin's stored seed, the
// weeks without matches, the weeks with one round more, and the best-of. The page shows the
// calendar it gives; publishing creates the matches in their weeks' windows. A published
// schedule is never drawn again: a change is an audited match edit.

const { auditLog, division, match, matchSlot, slot, stage, stageEntry, team } = schema;
type Reader = Pick<Db, 'select'>;
type Key = { orgSlug: string; compSlug: string; staffIds: readonly number[]; seasonId: number };

/** A team in a division's draw, by its slot. */
export interface DrawTeam {
  slotId: number;
  name: string;
  tag: string;
}

export interface ScheduleDivision {
  id: number;
  name: string;
  level: number;
  status: 'none' | 'draft' | 'published';
  /** Why it cannot be drawn now; null when it can. */
  problem: 'too_few_teams' | 'too_many_teams' | null;
  /** The division's active slots, in the order the draw starts from. */
  teams: DrawTeam[];
  bestOf: 1 | 3 | 5;
  /** The draft's calendar; null without a draft, or once published. */
  preview: {
    weeks: {
      week: number;
      calendarWeek: number;
      firstDay: string;
      matches: { round: number; a: DrawTeam; b: DrawTeam }[];
      rests: DrawTeam[];
    }[];
    lastDay: string;
    /** The last week ends after the season: publishing needs staff to confirm. */
    overrun: boolean;
  } | null;
  /** Each week of the season (and past it, as far as the draft goes), for marking. */
  calendarWeeks: {
    calendarWeek: number;
    firstDay: string;
    off: boolean;
    extra: boolean;
    /** The play week it holds in the draft, if any. */
    playWeek: number | null;
  }[];
  /** Its matches and weeks, and the weeks whose channels staff opened early (`opened_weeks`). */
  published: { matches: number; weeks: number; openedWeeks: number[] } | null;
}

export type ScheduleAdminView =
  | {
      ok: true;
      org: { name: string; slug: string };
      competition: { id: number; name: string; slug: string };
      season: { id: number; name: string; startsOn: string; endsOn: string };
      divisions: ScheduleDivision[];
    }
  | { ok: false; error: 'not_found' | 'not_allowed' };

type CompetitionRow = typeof schema.competition.$inferSelect;
type SeasonRow = typeof schema.season.$inferSelect;
type DivisionRow = typeof division.$inferSelect;
type StageRow = typeof stage.$inferSelect;

const DAY_MS = 86_400_000;
const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

function roundRobinStage(db: Reader, seasonId: number, divisionId: number): StageRow | undefined {
  return db
    .select()
    .from(stage)
    .where(
      and(
        eq(stage.seasonId, seasonId),
        eq(stage.divisionId, divisionId),
        eq(stage.kind, 'round_robin'),
      ),
    )
    .orderBy(asc(stage.id))
    .get();
}

function drawTeams(db: Reader, divisionId: number): DrawTeam[] {
  return db
    .select({ slotId: slot.id, name: team.name, tag: team.tag })
    .from(slot)
    .innerJoin(team, eq(slot.teamId, team.id))
    .where(and(eq(slot.divisionId, divisionId), eq(slot.status, 'active')))
    .orderBy(asc(slot.id))
    .all();
}

function problemOf(teams: readonly DrawTeam[], competitionRow: CompetitionRow) {
  if (teams.length < 2) return 'too_few_teams' as const;
  const limit = rulesetSchema.parse(competitionRow.rulesetJson).registration.division_max;
  return teams.length > limit ? ('too_many_teams' as const) : null;
}

/** The draft's matches, week by week, as publishing will create them. */
function draw(
  competitionRow: CompetitionRow,
  seasonRow: SeasonRow,
  teams: readonly DrawTeam[],
  config: StageConfig,
) {
  const scheduling = schedulingSchema.parse(competitionRow.schedulingJson);
  const robin = roundRobin(teams, { seed: config.seed ?? 0, legs: scheduling.legs });
  if (!robin.ok) return null;
  const calendar = seasonCalendar({
    startsOn: seasonRow.startsOn,
    endsOn: seasonRow.endsOn,
    timeZone: scheduling.time_zone,
    rounds: robin.rounds.length,
    roundsPerWeek: scheduling.rounds_per_week,
    weeksOff: config.weeks_off,
    extraRoundWeeks: config.extra_round_weeks,
  });
  const weeks = calendar.weeks.map((week) => {
    const rounds = robin.rounds.filter((round) => week.rounds.includes(round.round));
    return {
      ...week,
      matches: rounds.flatMap((round) =>
        round.matches.map(({ a, b }) => ({ round: round.round, a, b })),
      ),
      rests: rounds.flatMap((round) => (round.rest ? [round.rest] : [])),
    };
  });
  return { weeks, lastDay: calendar.lastDay, overrun: calendar.overrun };
}

function divisionView(
  db: Reader,
  competitionRow: CompetitionRow,
  seasonRow: SeasonRow,
  divisionRow: DivisionRow,
): ScheduleDivision {
  const stageRow = roundRobinStage(db, seasonRow.id, divisionRow.id);
  const teams = drawTeams(db, divisionRow.id);
  const config = stageConfigSchema.parse(stageRow?.configJson ?? {});
  const status = !stageRow ? 'none' : stageRow.status === 'draft' ? 'draft' : 'published';
  const problem = problemOf(teams, competitionRow);
  const drawn =
    status === 'draft' && problem === null ? draw(competitionRow, seasonRow, teams, config) : null;

  const played = new Map(drawn?.weeks.map((week) => [week.calendarWeek, week.week]));
  const lastShown = Math.max(
    Math.ceil((daysBetween(seasonRow.startsOn, seasonRow.endsOn) + 1) / 7),
    ...(drawn?.weeks.map((week) => week.calendarWeek) ?? []),
  );
  const weekOf = (day: string) => Math.floor(daysBetween(seasonRow.startsOn, day) / 7) + 1;
  const off = new Set(config.weeks_off.map(weekOf));
  const extra = new Set(config.extra_round_weeks.map(weekOf));
  const calendarWeeks = Array.from({ length: Math.max(lastShown, 0) + 1 }, (_, i) => ({
    calendarWeek: i + 1,
    firstDay: addDays(seasonRow.startsOn, 7 * i),
    off: off.has(i + 1),
    extra: extra.has(i + 1),
    playWeek: played.get(i + 1) ?? null,
  }));

  let published: ScheduleDivision['published'] = null;
  if (stageRow && status === 'published') {
    const totals = db
      .select({ matches: count(match.id), weeks: countDistinct(match.week) })
      .from(match)
      .where(eq(match.stageId, stageRow.id))
      .get();
    published = {
      matches: totals?.matches ?? 0,
      weeks: totals?.weeks ?? 0,
      openedWeeks: stageConfigSchema.parse(stageRow.configJson).opened_weeks,
    };
  }

  return {
    id: divisionRow.id,
    name: divisionRow.name,
    level: divisionRow.level,
    status,
    problem,
    teams,
    bestOf: config.best_of,
    preview: drawn && {
      weeks: drawn.weeks.map(({ week, calendarWeek, firstDay, matches, rests }) => ({
        week,
        calendarWeek,
        firstDay,
        matches,
        rests,
      })),
      lastDay: drawn.lastDay,
      overrun: drawn.overrun,
    },
    calendarWeeks,
    published,
  };
}

/** The season's schedule page: each division's draft or published schedule. */
export function scheduleAdmin(db: Reader, user: OrgUser, key: Key): ScheduleAdminView {
  const access = openSeason(db, user, key);
  if (!access.ok) return access;
  const { orgRow, row, seasonRow } = access;
  const divisions = db
    .select()
    .from(division)
    .where(eq(division.seasonId, seasonRow.id))
    .orderBy(asc(division.level), asc(division.name))
    .all();
  return {
    ok: true,
    org: { name: orgRow.name, slug: orgRow.slug },
    competition: { id: row.id, name: row.name, slug: row.slug },
    season: {
      id: seasonRow.id,
      name: seasonRow.name,
      startsOn: seasonRow.startsOn,
      endsOn: seasonRow.endsOn,
    },
    divisions: divisions.map((entry) => divisionView(db, row, seasonRow, entry)),
  };
}

export type ScheduleReply =
  | { ok: true }
  | {
      ok: false;
      error:
        | 'not_found'
        | 'not_allowed'
        | 'invalid'
        | 'published'
        | 'no_draft'
        | 'too_few_teams'
        | 'too_many_teams'
        | 'overrun'
        | 'no_matches';
    };

/** The division of this season, for its owner and staff, with its round robin stage if any. */
function openDivision(db: Reader, user: OrgUser, key: Key, divisionId: number) {
  const access = openSeason(db, user, key);
  if (!access.ok) return access;
  const divisionRow = db
    .select()
    .from(division)
    .where(and(eq(division.id, divisionId), eq(division.seasonId, access.seasonRow.id)))
    .get();
  if (!divisionRow) return { ok: false as const, error: 'not_found' as const };
  const stageRow = roundRobinStage(db, access.seasonRow.id, divisionRow.id);
  return { ...access, divisionRow, stageRow };
}

const draftFormSchema = z.strictObject({
  weeksOff: z.array(z.iso.date()).max(60),
  extraRoundWeeks: z.array(z.iso.date()).max(60),
  bestOf: z.enum(['1', '3', '5']).transform((value) => Number(value) as 1 | 3 | 5),
});

function audit(
  db: Pick<Db, 'insert'>,
  user: OrgUser,
  action: string,
  stageId: number,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  now: number,
) {
  db.insert(auditLog)
    .values({
      actorPlayerId: user.playerId,
      actorKind: 'user',
      action,
      entity: 'stage',
      entityId: String(stageId),
      beforeJson: before,
      afterJson: after,
      at: now,
    })
    .run();
}

/**
 * Saves a division's draft: the weeks off, the weeks with one round more and the best-of. The
 * first draft gets a seed from `newSeed`; later ones keep it, so the draw stays as staff saw it.
 */
export function saveScheduleDraft(
  db: Db,
  user: OrgUser,
  key: Key,
  divisionId: number,
  form: { weeksOff: string[]; extraRoundWeeks: string[]; bestOf: string },
  newSeed: () => number,
  now: number,
): ScheduleReply {
  const access = openDivision(db, user, key, divisionId);
  if (!access.ok) return access;
  const { row, divisionRow, stageRow } = access;
  if (stageRow && stageRow.status !== 'draft') return { ok: false, error: 'published' };
  const parsed = draftFormSchema.safeParse(form);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const problem = problemOf(drawTeams(db, divisionRow.id), row);
  if (problem) return { ok: false, error: problem };
  const before = stageRow ? stageConfigSchema.parse(stageRow.configJson) : null;
  const config = stageConfigSchema.parse({
    seed: before?.seed ?? newSeed(),
    weeks_off: [...new Set(parsed.data.weeksOff)].sort(),
    extra_round_weeks: [...new Set(parsed.data.extraRoundWeeks)].sort(),
    best_of: parsed.data.bestOf,
  });
  db.transaction((tx) => {
    let id = stageRow?.id;
    if (id === undefined)
      id = tx
        .insert(stage)
        .values({
          seasonId: access.seasonRow.id,
          divisionId: divisionRow.id,
          ord: 1,
          kind: 'round_robin',
          configJson: config,
          status: 'draft',
        })
        .returning({ id: stage.id })
        .get().id;
    else tx.update(stage).set({ configJson: config }).where(eq(stage.id, id)).run();
    audit(tx, user, 'schedule.draft', id, before, config, now);
  });
  return { ok: true };
}

/** Draws the division again with a new seed; the weeks marked stay. */
export function reshuffleSchedule(
  db: Db,
  user: OrgUser,
  key: Key,
  divisionId: number,
  newSeed: () => number,
  now: number,
): ScheduleReply {
  const access = openDivision(db, user, key, divisionId);
  if (!access.ok) return access;
  const { stageRow } = access;
  if (!stageRow) return { ok: false, error: 'no_draft' };
  if (stageRow.status !== 'draft') return { ok: false, error: 'published' };
  const before = stageConfigSchema.parse(stageRow.configJson);
  const config = { ...before, seed: newSeed() };
  db.transaction((tx) => {
    tx.update(stage).set({ configJson: config }).where(eq(stage.id, stageRow.id)).run();
    audit(
      tx,
      user,
      'schedule.reshuffle',
      stageRow.id,
      { seed: before.seed },
      { seed: config.seed },
      now,
    );
  });
  return { ok: true };
}

/**
 * Publishes the draft: one stage entry per team, then every match in its week's window with
 * its two sides, week by week. Past the season's end, staff confirm first (`acceptOverrun`).
 */
export function publishSchedule(
  db: Db,
  user: OrgUser,
  key: Key,
  divisionId: number,
  options: { acceptOverrun: boolean },
  now: number,
): ScheduleReply {
  const access = openDivision(db, user, key, divisionId);
  if (!access.ok) return access;
  const { row, seasonRow, divisionRow, stageRow } = access;
  if (!stageRow) return { ok: false, error: 'no_draft' };
  if (stageRow.status !== 'draft') return { ok: false, error: 'published' };
  const teams = drawTeams(db, divisionRow.id);
  const problem = problemOf(teams, row);
  if (problem) return { ok: false, error: problem };
  const config = stageConfigSchema.parse(stageRow.configJson);
  const drawn = draw(row, seasonRow, teams, config);
  if (!drawn) return { ok: false, error: 'too_few_teams' };
  if (drawn.overrun && !options.acceptOverrun) return { ok: false, error: 'overrun' };

  db.transaction((tx) => {
    // Another tab may have published meanwhile: only a draft is published, once.
    const updated = tx
      .update(stage)
      .set({ status: 'published' })
      .where(and(eq(stage.id, stageRow.id), eq(stage.status, 'draft')))
      .run();
    if (updated.changes !== 1) throw new Error('The schedule was published meanwhile');
    const entryOf = new Map<number, number>();
    for (const [i, entry] of teams.entries()) {
      const inserted = tx
        .insert(stageEntry)
        .values({ stageId: stageRow.id, slotId: entry.slotId, seed: i + 1 })
        .returning({ id: stageEntry.id })
        .get();
      entryOf.set(entry.slotId, inserted.id);
    }
    const entry = (team: DrawTeam) => {
      const id = entryOf.get(team.slotId);
      // Every team of the draw got its entry just above.
      if (id === undefined) throw new Error(`No stage entry for slot ${String(team.slotId)}`);
      return id;
    };
    for (const week of drawn.weeks)
      for (const { a, b } of week.matches) {
        const created = tx
          .insert(match)
          .values({
            stageId: stageRow.id,
            week: week.week,
            bestOf: config.best_of,
            windowStart: week.start,
            windowEnd: week.end,
          })
          .returning({ id: match.id })
          .get();
        tx.insert(matchSlot)
          .values([
            { matchId: created.id, side: 'a', sourceKind: 'entry', sourceRef: entry(a) },
            { matchId: created.id, side: 'b', sourceKind: 'entry', sourceRef: entry(b) },
          ])
          .run();
      }
    audit(
      tx,
      user,
      'schedule.publish',
      stageRow.id,
      { status: 'draft' },
      {
        status: 'published',
        seed: config.seed,
        teams: teams.length,
        matches: drawn.weeks.reduce((total, week) => total + week.matches.length, 0),
        weeks: drawn.weeks.length,
        lastDay: drawn.lastDay,
        overrun: drawn.overrun,
      },
      now,
    );
  });
  return { ok: true };
}

/**
 * Opens a published division's play week now (design doc section 6): its match channels come on
 * the reconciler's next check instead of `open_days_before_week` days before the week. Audited.
 */
export function openScheduleWeek(
  db: Db,
  user: OrgUser,
  key: Key,
  divisionId: number,
  week: number,
  now: number,
): ScheduleReply {
  const access = openDivision(db, user, key, divisionId);
  if (!access.ok) return access;
  const { stageRow } = access;
  if (!stageRow || stageRow.status === 'draft') return { ok: false, error: 'no_draft' };
  if (!Number.isInteger(week) || !stageHasWeek(db, stageRow.id, week))
    return { ok: false, error: 'no_matches' };
  db.transaction((tx) => {
    markWeekOpen(tx, stageRow, week, user.playerId, now);
  });
  return { ok: true };
}
