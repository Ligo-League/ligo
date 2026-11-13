import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { auditLog, competition, division, org, season, slot, team } from '../schema/index.ts';
import type { TeamRow } from './parse-teams-csv.ts';

// LFR Season 3 as described in the design doc (sections 5 and 16). Data, not rules: every value
// below is an ordinary row or setting that staff will be able to change.
const ORG: typeof org.$inferInsert = { name: 'LFR', slug: 'lfr', locale: 'fr', settingsJson: {} };
const COMPETITION: Omit<typeof competition.$inferInsert, 'orgId'> = {
  title: 'r6',
  name: 'LFR',
  slug: 'lfr',
  participantMode: 'team',
  rulesetJson: { result_validation: 'staff', game_score: null },
  // 3 points per win in Season 3, as the league's score7 tables are configured.
  pointsJson: {
    outcomes: { win: 3, loss: 0 },
    forfeit: { winner: 3, loser: 0, counts_as_played: true },
  },
  tiebreakJson: { criteria: ['points', 'diff'], unresolved_tie: 'shared' },
  schedulingJson: { rounds_per_week: 1 },
  statSchemaVersion: 1,
  themeJson: {},
};
const SEASON: Omit<typeof season.$inferInsert, 'competitionId'> = {
  name: 'Saison 3',
  startsOn: '2026-10-19',
  endsOn: '2026-12-20',
  status: 'active',
  // The map pool is left empty until the maintainer supplies the current nine maps.
  settingsJson: { forfeit_score: [0, 0], map_pool: [] },
};
const DIVISIONS: Omit<typeof division.$inferInsert, 'seasonId'>[] = [
  { name: 'Ligue 1', kind: 'league', level: 1, categoryPrefix: 'L1' },
  { name: 'Ligue 2', kind: 'league', level: 2, categoryPrefix: 'L2' },
];

export const LFR_DIVISION_NAMES = DIVISIONS.map((entry) => entry.name);

/** LFR plays and schedules in French time. */
export const LFR_TIME_ZONE = 'Europe/Paris';

/** The seeded season with its competition, or undefined before `seedLfr` has run. */
export function findLfrSeason(db: Pick<Db, 'select'>) {
  return db
    .select({ season, competition })
    .from(season)
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .innerJoin(org, eq(competition.orgId, org.id))
    .where(
      and(
        eq(org.slug, ORG.slug),
        eq(competition.slug, COMPETITION.slug),
        eq(season.name, SEASON.name),
      ),
    )
    .get();
}

export interface SeedSummary {
  created: {
    orgs: number;
    competitions: number;
    seasons: number;
    divisions: number;
    teams: number;
    slots: number;
  };
  updated: { competitions: number; teams: number; slots: number };
}

/**
 * Loads the LFR skeleton and the given teams. Running it again changes nothing; editing the CSV
 * and running it again updates teams (matched by tag) and moves their slot. A competition whose
 * rule settings differ from the ones above is brought back to them. It never deletes.
 */
export function seedLfr(db: Db, teams: readonly TeamRow[], now: number): SeedSummary {
  return db.transaction((tx) => {
    const summary: SeedSummary = {
      created: { orgs: 0, competitions: 0, seasons: 0, divisions: 0, teams: 0, slots: 0 },
      updated: { competitions: 0, teams: 0, slots: 0 },
    };

    let orgRow = tx.select().from(org).where(eq(org.slug, ORG.slug)).get();
    if (!orgRow) {
      orgRow = tx.insert(org).values(ORG).returning().get();
      summary.created.orgs += 1;
    }
    const orgId = orgRow.id;

    const competitionWhere = and(
      eq(competition.orgId, orgId),
      eq(competition.slug, COMPETITION.slug),
    );
    let competitionRow = tx.select().from(competition).where(competitionWhere).get();
    if (!competitionRow) {
      competitionRow = tx
        .insert(competition)
        .values({ ...COMPETITION, orgId })
        .returning()
        .get();
      summary.created.competitions += 1;
    } else if (RULE_SETTINGS.some((key) => !sameJson(competitionRow?.[key], COMPETITION[key]))) {
      const settings = Object.fromEntries(RULE_SETTINGS.map((key) => [key, COMPETITION[key]]));
      tx.update(competition).set(settings).where(eq(competition.id, competitionRow.id)).run();
      summary.updated.competitions += 1;
    }
    const competitionId = competitionRow.id;

    const seasonWhere = and(eq(season.competitionId, competitionId), eq(season.name, SEASON.name));
    let seasonRow = tx.select().from(season).where(seasonWhere).get();
    if (!seasonRow) {
      seasonRow = tx
        .insert(season)
        .values({ ...SEASON, competitionId })
        .returning()
        .get();
      summary.created.seasons += 1;
    }
    const seasonId = seasonRow.id;

    const divisionIds = new Map<string, number>();
    for (const entry of DIVISIONS) {
      const where = and(eq(division.seasonId, seasonId), eq(division.name, entry.name));
      let row = tx.select().from(division).where(where).get();
      if (!row) {
        row = tx
          .insert(division)
          .values({ ...entry, seasonId })
          .returning()
          .get();
        summary.created.divisions += 1;
      }
      divisionIds.set(entry.name, row.id);
    }
    const seasonDivisionIds = [...divisionIds.values()];

    for (const entry of teams) {
      const divisionId = divisionIds.get(entry.division);
      if (divisionId === undefined) throw new Error(`Unknown division "${entry.division}"`);

      const wanted = {
        name: entry.name,
        slug: entry.slug,
        city: entry.city,
        colorsJson: entry.colors,
      };
      const teamWhere = and(eq(team.orgId, orgId), eq(team.title, 'r6'), eq(team.tag, entry.tag));
      let teamRow = tx.select().from(team).where(teamWhere).get();
      if (!teamRow) {
        teamRow = tx
          .insert(team)
          .values({ ...wanted, orgId, title: 'r6', tag: entry.tag, socialsJson: [] })
          .returning()
          .get();
        summary.created.teams += 1;
      } else if (
        teamRow.name !== wanted.name ||
        teamRow.slug !== wanted.slug ||
        teamRow.city !== wanted.city ||
        JSON.stringify(teamRow.colorsJson) !== JSON.stringify(wanted.colorsJson)
      ) {
        tx.update(team).set(wanted).where(eq(team.id, teamRow.id)).run();
        summary.updated.teams += 1;
      }

      const slotWhere = and(
        eq(slot.teamId, teamRow.id),
        inArray(slot.divisionId, seasonDivisionIds),
      );
      const slotRow = tx.select().from(slot).where(slotWhere).get();
      if (!slotRow) {
        tx.insert(slot).values({ divisionId, teamId: teamRow.id }).run();
        summary.created.slots += 1;
      } else if (slotRow.divisionId !== divisionId) {
        tx.update(slot).set({ divisionId }).where(eq(slot.id, slotRow.id)).run();
        summary.updated.slots += 1;
      }
    }

    if (hasChanges(summary)) {
      tx.insert(auditLog)
        .values({
          actorKind: 'system',
          action: 'seed.lfr',
          entity: 'season',
          entityId: String(seasonId),
          afterJson: { ...summary },
          at: now,
        })
        .run();
    }
    return summary;
  });
}

const RULE_SETTINGS = ['rulesetJson', 'pointsJson', 'tiebreakJson', 'schedulingJson'] as const;
const sameJson = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

export function hasChanges(summary: SeedSummary): boolean {
  return [...Object.values(summary.created), ...Object.values(summary.updated)].some((n) => n > 0);
}
