import {
  DEFAULT_DISPUTE_REASONS,
  promotionSchema,
  mercatoSchema,
  registrationSchema,
  statsSettingsSchema,
  discordSettingsSchema,
  requestsSchema,
  teamRolesSchema,
  vetoSchema,
  type PointsSettings,
  type TiebreakSettings,
} from '@ligo/core';
import { slugify } from '@ligo/core';
import { R6_GAME_SCORE } from '@ligo/titles';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { orgSettingsSchema } from '../json.ts';
import {
  auditLog,
  club,
  clubStaff,
  competition,
  division,
  org,
  player,
  sanction,
  season,
  slot,
  team,
} from '../schema/index.ts';
import type { TeamRow } from './parse-teams-csv.ts';

// LFR Season 3 as described in the design doc (sections 5 and 16). Data, not rules: every value
// below is an ordinary row or setting that staff will be able to change.
const LFR_TIME_ZONE_SETTING = 'Europe/Paris';
// MLB Group runs the LFR and its other leagues (design doc section 1); its slug is the first
// part of their addresses, `/mlb-group/lfr/...` (migration 0022 renamed the first seed's "LFR",
// migration 0026 fixed the name's typo, "MBL"). Its owner is the maintainer's given account
// (M-20, 19 November 2026).
const ORG: typeof org.$inferInsert = {
  name: 'MLB Group',
  slug: 'mlb-group',
  ownerDiscordUserId: '994597181476569170',
  locale: 'fr',
  settingsJson: orgSettingsSchema.parse({}),
};
/** 3 points per win in Season 3, as the league's score7 tables are configured. */
const LFR_POINTS: PointsSettings = {
  outcomes: { win: 3, loss: 0 },
  forfeit: { winner: 3, loser: 0, counts_as_played: true },
};
const LFR_TIEBREAK: TiebreakSettings = { criteria: ['points', 'diff'], unresolved_tie: 'shared' };

const COMPETITION: Omit<typeof competition.$inferInsert, 'orgId'> = {
  title: 'r6',
  name: 'LFR',
  slug: 'lfr',
  participantMode: 'team',
  // One owner, up to three managers (the rulebook form's three staff) and one coach per team.
  // Dispute reasons agreed with the maintainer on 13 November 2026, the platform's defaults.
  // The veto follows the design doc's sequences until the owner answers O-11. Promotion: the
  // maintainer's rule of 13 November 2026, last 2 down and the one above in a barrage against
  // the lower division's 3rd.
  // A result the opponent confirms counts at once; staff decide only disputes (maintainer,
  // 14 November 2026: the two teams already agree the result is right).
  rulesetJson: {
    result_validation: 'opponent',
    game_score: R6_GAME_SCORE,
    team_roles: teamRolesSchema.parse({}),
    requests: requestsSchema.parse({}),
    dispute_reasons: [...DEFAULT_DISPUTE_REASONS],
    veto: vetoSchema.parse({}),
    promotion: promotionSchema.parse({}),
    // 5 players and up to 2 substitutes; public stats accepted at registration from Season 4
    // (maintainer, 14 November 2026, O-20); players 16 or older (O-31); lineups change until the
    // season starts (O-32); 12 teams at most in a division (O-16).
    registration: registrationSchema.parse({
      stats_consent_required: true,
      min_age: 16,
      division_max: 12,
    }),
    // Announced windows, 3 moves per team, every incoming player blocked 24 hours; a move
    // inside a club is an ordinary one (O-35, M-22, maintainer, 16 and 19 November 2026).
    mercato: mercatoSchema.parse({ mode: 'windows', max_moves_per_team: 3, lock_hours: 24 }),
    // No deadline for the stat grid; a tolerance of 3 kills (M-39, 19 November 2026).
    stats: statsSettingsSchema.parse({}),
    // Ligo leaves the server alone until staff turn it on (phase 4); its names and times are
    // M-44's. LFR's rulebook has a MOSS channel per team.
    discord: discordSettingsSchema.parse({ moss: true }),
  },
  // What a new season copies (3 points per win, as score7's Season 3 tables are configured).
  pointsJson: LFR_POINTS,
  tiebreakJson: LFR_TIEBREAK,
  // Rulebook: one extra week without an agreed time, then Sunday 21:00, French time.
  schedulingJson: {
    rounds_per_week: 1,
    legs: 1,
    time_zone: LFR_TIME_ZONE_SETTING,
    extension_weeks: 1,
    auto_slot: { weekday: 7, time: '21:00' },
  },
  statSchemaVersion: 1,
  themeJson: {},
};
const SEASON: Omit<typeof season.$inferInsert, 'competitionId'> = {
  name: 'Saison 3',
  startsOn: '2026-10-19',
  endsOn: '2026-12-20',
  status: 'active',
  // The official competitive pool of the current Ubisoft season, from the maintainer
  // (13 November 2026). Rulebook: a warning at the 2nd forfeit, exclusion at the 3rd. A forfeit
  // scores Season 4's +4 / -7 (7-3 for the team that receives it, 0-7 for the team that forfeits;
  // O-36), previewed on Season 3 before Ligo is official: the real Season 3 counted 7-0
  // (maintainer, 19 November 2026). A forfeit made by the 50% rule scores the same until O-27
  // says otherwise.
  settingsJson: {
    // The season's own points and tie-breakers (maintainer, 19 November 2026; M-40).
    points: LFR_POINTS,
    tiebreak: LFR_TIEBREAK,
    forfeit_score: { winner: [7, 3], loser: [0, 7] },
    exclusion_forfeit_score: null,
    map_pool: [
      'Bank',
      'Chalet',
      'Clubhouse',
      'Nighthaven Labs',
      'Lair',
      'Villa',
      'Kafe Dostoyevsky',
      'Border',
      'Fortress',
    ],
    forfeits: { warning_at: 2, exclusion_at: 3 },
  },
};
const DIVISIONS: Omit<typeof division.$inferInsert, 'seasonId'>[] = [
  { name: 'Ligue 1', kind: 'league', level: 1, categoryPrefix: 'L1' },
  { name: 'Ligue 2', kind: 'league', level: 2, categoryPrefix: 'L2' },
];

export const LFR_DIVISION_NAMES = DIVISIONS.map((entry) => entry.name);

/** LFR plays and schedules in French time. */
export const LFR_TIME_ZONE = LFR_TIME_ZONE_SETTING;

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
    clubs: number;
    teams: number;
    slots: number;
    /** Teams the file marks as excluded, excluded now. */
    exclusions: number;
  };
  updated: { competitions: number; seasons: number; clubs: number; teams: number; slots: number };
  /** Clubs left without a roster because the file moved theirs to another club. */
  removed: { clubs: number };
}

/**
 * Loads the LFR skeleton and the given teams. Running it again changes nothing; editing the CSV
 * and running it again updates teams (matched by tag) and moves their slot. A competition's rule
 * settings and the season's settings that differ from the ones above are brought back to them.
 * It never deletes.
 */
export function seedLfr(db: Db, teams: readonly TeamRow[], now: number): SeedSummary {
  return db.transaction((tx) => {
    const summary: SeedSummary = {
      created: {
        orgs: 0,
        competitions: 0,
        seasons: 0,
        divisions: 0,
        clubs: 0,
        teams: 0,
        slots: 0,
        exclusions: 0,
      },
      updated: { competitions: 0, seasons: 0, clubs: 0, teams: 0, slots: 0 },
      removed: { clubs: 0 },
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
    } else if (!sameJson(seasonRow.settingsJson, SEASON.settingsJson)) {
      tx.update(season)
        .set({ settingsJson: SEASON.settingsJson })
        .where(eq(season.id, seasonRow.id))
        .run();
      summary.updated.seasons += 1;
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

    // The same key will name the logo in R2 (design doc section 13, `logos/`).
    const logoKeyOf = (entry: TeamRow) => (entry.logo ? `logos/${entry.logo}.png` : null);
    // A club takes its look from its first roster in the file; a roster keeps its own colours
    // and logo only where they differ from the club's. A row naming no club keeps the club its
    // roster already has, so renaming a roster does not leave its club behind.
    const teamWhere = (tag: string) =>
      and(eq(team.orgId, orgId), eq(team.title, 'r6'), eq(team.tag, tag));
    type ClubLook = { id: number; colors: string[]; logoKey: string | null };
    // By club ID: two rows reach the same club by its name or by their roster's current club.
    const clubs = new Map<number, ClubLook>();
    const clubOf = new Map<TeamRow, ClubLook>();
    for (const entry of teams) {
      const name = entry.club ?? entry.name;
      const made = slugify(name);
      if (!made.ok) throw new Error(`Club "${name}" has no letter or digit for its URL`);
      const current = entry.club
        ? undefined
        : tx.select({ clubId: team.clubId }).from(team).where(teamWhere(entry.tag)).get();
      let clubRow = tx
        .select()
        .from(club)
        .where(
          current
            ? eq(club.id, current.clubId)
            : and(eq(club.orgId, orgId), eq(club.slug, made.slug)),
        )
        .get();
      const known = clubRow && clubs.get(clubRow.id);
      if (known) {
        clubOf.set(entry, known);
        continue;
      }
      const wanted = {
        name,
        city: entry.city,
        colorsJson: entry.colors,
        logoKey: logoKeyOf(entry),
      };
      if (!clubRow) {
        clubRow = tx
          .insert(club)
          .values({ ...wanted, orgId, slug: made.slug, socialsJson: [] })
          .returning()
          .get();
        summary.created.clubs += 1;
      } else if (
        clubRow.name !== wanted.name ||
        clubRow.city !== wanted.city ||
        clubRow.logoKey !== wanted.logoKey ||
        !sameJson(clubRow.colorsJson, wanted.colorsJson)
      ) {
        tx.update(club).set(wanted).where(eq(club.id, clubRow.id)).run();
        summary.updated.clubs += 1;
      }
      const look = { id: clubRow.id, colors: entry.colors, logoKey: logoKeyOf(entry) };
      clubs.set(clubRow.id, look);
      clubOf.set(entry, look);
    }

    const vacated = new Set<number>();
    for (const entry of teams) {
      const divisionId = divisionIds.get(entry.division);
      if (divisionId === undefined) throw new Error(`Unknown division "${entry.division}"`);
      const owner = clubOf.get(entry);
      if (!owner) throw new Error(`No club for "${entry.name}"`);

      const logoKey = logoKeyOf(entry);
      const wanted = {
        name: entry.name,
        slug: entry.slug,
        clubId: owner.id,
        colorsJson: sameJson(entry.colors, owner.colors) ? null : entry.colors,
        logoKey: logoKey === owner.logoKey ? null : logoKey,
      };
      let teamRow = tx.select().from(team).where(teamWhere(entry.tag)).get();
      if (!teamRow) {
        teamRow = tx
          .insert(team)
          .values({ ...wanted, orgId, title: 'r6', tag: entry.tag })
          .returning()
          .get();
        summary.created.teams += 1;
      } else if (
        teamRow.name !== wanted.name ||
        teamRow.slug !== wanted.slug ||
        teamRow.clubId !== wanted.clubId ||
        teamRow.logoKey !== wanted.logoKey ||
        !sameJson(teamRow.colorsJson, wanted.colorsJson)
      ) {
        tx.update(team).set(wanted).where(eq(team.id, teamRow.id)).run();
        summary.updated.teams += 1;
        if (teamRow.clubId !== wanted.clubId) vacated.add(teamRow.clubId);
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

      const reason = entry.excluded ?? null;
      const current = reason === null ? undefined : tx.select().from(slot).where(slotWhere).get();
      if (reason !== null && current?.status === 'active') {
        // As `excludeSlot` in the server does for staff: status, sanction and audit together.
        const decidedBy = fixtureStaffId(tx, orgId, now);
        tx.update(slot)
          .set({ status: 'excluded', excludedAt: now })
          .where(eq(slot.id, current.id))
          .run();
        const stored = tx
          .insert(sanction)
          .values({
            seasonId: seasonRow.id,
            targetKind: 'slot',
            targetId: current.id,
            kind: 'exclusion',
            startsAt: now,
            reason,
            decidedBy,
          })
          .returning({ id: sanction.id })
          .get();
        tx.insert(auditLog)
          .values({
            actorPlayerId: decidedBy,
            actorKind: 'user',
            action: 'slot.exclude',
            entity: 'slot',
            entityId: String(current.id),
            beforeJson: { status: current.status },
            afterJson: { status: 'excluded', sanctionId: stored.id, reason },
            at: now,
          })
          .run();
        summary.created.exclusions += 1;
      }
    }

    // A club the file moved every roster away from holds nothing more: the file grouped it into
    // another (the clubs 0009 made, one per team, before the file named Season 3's clubs).
    for (const clubId of vacated) {
      // A club with officials is somebody's: it stays, for staff to sort out.
      const left = tx.select({ id: team.id }).from(team).where(eq(team.clubId, clubId)).get();
      const staffed = tx
        .select({ id: clubStaff.playerId })
        .from(clubStaff)
        .where(eq(clubStaff.clubId, clubId))
        .get();
      if (left || staffed) continue;
      tx.delete(club).where(eq(club.id, clubId)).run();
      summary.removed.clubs += 1;
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

/**
 * The league staff member who decided the exclusions the fixture records: the maintainer, who
 * asked for RPV's (19 November 2026). Their player is created if Ligo does not know them yet.
 */
const FIXTURE_STAFF = { discordUserId: '546017354535141381', displayName: 'Gipson62' };

function fixtureStaffId(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  orgId: number,
  now: number,
): number {
  const known = tx
    .select({ id: player.id })
    .from(player)
    .where(eq(player.discordUserId, FIXTURE_STAFF.discordUserId))
    .get();
  if (known) return known.id;
  const base = slugify(FIXTURE_STAFF.displayName);
  const stem = base.ok ? base.slug : 'staff';
  // Player slugs are unique across Ligo (M-42): someone may already use the maintainer's name.
  let slug = stem;
  for (
    let suffix = 2;
    tx.select({ id: player.id }).from(player).where(eq(player.slug, slug)).get();
    suffix += 1
  ) {
    slug = `${stem}-${String(suffix)}`;
  }
  return tx
    .insert(player)
    .values({
      orgId,
      slug,
      displayName: FIXTURE_STAFF.displayName,
      discordUserId: FIXTURE_STAFF.discordUserId,
      createdAt: now,
    })
    .returning({ id: player.id })
    .get().id;
}

const RULE_SETTINGS = ['rulesetJson', 'pointsJson', 'tiebreakJson', 'schedulingJson'] as const;
const sameJson = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

export function hasChanges(summary: SeedSummary): boolean {
  return [
    ...Object.values(summary.created),
    ...Object.values(summary.updated),
    ...Object.values(summary.removed),
  ].some((n) => n > 0);
}

/**
 * Season 4, open for registration: created with its two divisions when missing, never changed
 * afterwards. Its dates are placeholders until the league sets them (maintainer, 14 November
 * 2026); the admin panel (phase 3h) will let staff change them. Returns whether it was created.
 */
export function openLfrRegistration(db: Db, now: number): boolean {
  return db.transaction((tx) => {
    const current = findLfrSeason(tx);
    if (!current) throw new Error('Seed LFR before opening registration: Season 3 is missing');
    const competitionId = current.competition.id;
    const where = and(eq(season.competitionId, competitionId), eq(season.name, NEXT_SEASON.name));
    if (tx.select({ id: season.id }).from(season).where(where).get()) return false;
    const created = tx
      .insert(season)
      .values({ ...NEXT_SEASON, competitionId, settingsJson: current.season.settingsJson })
      .returning()
      .get();
    for (const entry of DIVISIONS) {
      tx.insert(division)
        .values({ ...entry, seasonId: created.id })
        .run();
    }
    tx.insert(auditLog)
      .values({
        actorKind: 'system',
        action: 'seed.lfr.registration',
        entity: 'season',
        entityId: String(created.id),
        afterJson: { name: created.name, status: created.status },
        at: now,
      })
      .run();
    return true;
  });
}

const NEXT_SEASON = {
  name: 'Saison 4',
  startsOn: '2027-01-04',
  endsOn: '2027-03-14',
  status: 'registration',
} as const;
