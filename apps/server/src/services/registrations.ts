import {
  lineupLocked,
  lineupStatus,
  mayManagePlayers,
  playerGaps,
  type FieldErrors,
  type LineupGap,
  type PlayerGap,
  type RegistrationRole,
  type RegistrationSettings,
  zonedDate,
} from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm';
import { findCompetitionAt, type CompetitionKey } from './competitions.ts';
import { competitionPath } from './paths.ts';
import { teamsOfPlayer } from './permissions.ts';
import { profilesOf } from './profiles.ts';
import {
  clubNameOf,
  leadsRegistration,
  rosterNameOf,
  unavailablePlayers,
} from './registration-players.ts';
import { rosterMembers } from './rosters.ts';

// Registering a roster (design doc section 7, "Registration"; maintainer, 14 and 15 November
// 2026). The roster exists first, in no competition, with its own players (M-33): an official
// who manages its players registers it, with the rulebook in force accepted, then picks its
// lineup among those players. The registration is a `registration` request naming the roster
// in `team_id`; staff approve it into a division. Nobody declares another person's data.

const { auditLog, competition, player, registrationPlayer, request, rulesVersion, season, team } =
  schema;

type Reader = Pick<Db, 'select'>;

/** The competition, its season taking registrations, and the rulebook in force. */
function openSeason(db: Reader, key: CompetitionKey, now: number) {
  const found = findCompetitionAt(db, key);
  if (!found) return { ok: false as const, error: 'not_found' as const };
  const open = db
    .select()
    .from(season)
    .where(and(eq(season.competitionId, found.id), eq(season.status, 'registration')))
    .orderBy(desc(season.startsOn), desc(season.id))
    .get();
  if (!open) return { ok: false as const, error: 'closed' as const };
  const rules = db
    .select({ id: rulesVersion.id, version: rulesVersion.version })
    .from(rulesVersion)
    .where(and(eq(rulesVersion.competitionId, found.id), lte(rulesVersion.effectiveFrom, now)))
    .orderBy(desc(rulesVersion.effectiveFrom), desc(rulesVersion.id))
    .get();
  if (!rules) return { ok: false as const, error: 'no_rules' as const };
  return { ok: true as const, competition: found, season: open, rules };
}

/**
 * Where a Discord server's league takes registrations, for `/register`: the form's path while
 * a season is open for them.
 */
export function registrationLink(
  db: Reader,
  guildId: string | null,
):
  | { ok: true; path: string; competition: string; season: string }
  | {
      ok: false;
      error: 'not_linked' | 'closed';
      competition?: string;
    } {
  const linked =
    guildId === null
      ? undefined
      : db
          .select({ competition, orgSlug: schema.org.slug })
          .from(schema.leagueGuild)
          .innerJoin(competition, eq(schema.leagueGuild.competitionId, competition.id))
          .innerJoin(schema.org, eq(competition.orgId, schema.org.id))
          .where(eq(schema.leagueGuild.guildId, guildId))
          .get();
  if (!linked) return { ok: false, error: 'not_linked' };
  const open = db
    .select({ name: season.name })
    .from(season)
    .where(and(eq(season.competitionId, linked.competition.id), eq(season.status, 'registration')))
    .orderBy(desc(season.startsOn), desc(season.id))
    .get();
  if (!open) return { ok: false, error: 'closed', competition: linked.competition.name };
  return {
    ok: true,
    path: `${competitionPath(linked.orgSlug, linked.competition.slug)}/register`,
    competition: linked.competition.name,
    season: open.name,
  };
}

/** A roster the player may register: they manage its players, it plays the league's game. */
export interface RegistrableRoster {
  teamId: number;
  name: string;
  tag: string;
  slug: string;
  players: number;
}

/**
 * The rosters a player may register for the season: those whose players they manage, of the
 * league's group and game, without a registration of this season waiting or approved.
 */
function registrableRosters(
  db: Reader,
  playerId: number,
  open: { competition: typeof competition.$inferSelect; season: typeof season.$inferSelect },
): RegistrableRoster[] {
  const managed = [
    ...new Set(
      teamsOfPlayer(db, playerId)
        .filter((held) => mayManagePlayers(held.role))
        .map((held) => held.teamId),
    ),
  ];
  if (managed.length === 0) return [];
  const entered = new Set(
    db
      .select({ teamId: request.teamId })
      .from(request)
      .where(
        and(
          eq(request.kind, 'registration'),
          eq(request.seasonId, open.season.id),
          inArray(request.status, ['pending', 'approved']),
        ),
      )
      .all()
      .map((row) => row.teamId),
  );
  return db
    .select()
    .from(team)
    .where(inArray(team.id, managed))
    .orderBy(team.name)
    .all()
    .filter(
      (row) =>
        row.orgId === open.competition.orgId &&
        row.title === open.competition.title &&
        !entered.has(row.id),
    )
    .map((row) => ({
      teamId: row.id,
      name: row.name,
      tag: row.tag,
      slug: row.slug,
      players: rosterMembers(db, row.id, row.title).length,
    }));
}

export type RegistrationClosed = { ok: false; error: 'not_found' | 'closed' | 'no_rules' };

export type RegistrationForm =
  | {
      ok: true;
      /** `path` is its address, `/:org/:comp`. */
      competition: { id: number; name: string; slug: string; path: string };
      season: { id: number; name: string };
      rules: { id: number; version: string };
      /** The rosters the member may register now. */
      rosters: RegistrableRoster[];
      settings: RegistrationSettings;
    }
  | RegistrationClosed;

export function registrationForm(
  db: Reader,
  key: CompetitionKey,
  playerId: number,
  now: number,
): RegistrationForm {
  const open = openSeason(db, key, now);
  if (!open.ok) return open;
  return {
    ok: true,
    competition: {
      id: open.competition.id,
      name: open.competition.name,
      slug: open.competition.slug,
      path: open.competition.path,
    },
    season: { id: open.season.id, name: open.season.name },
    rules: open.rules,
    rosters: registrableRosters(db, playerId, open),
    settings: open.competition.rulesetJson.registration,
  };
}

/** What the form sends: the roster, and the rulebook version it showed. */
export interface RegistrationRequest {
  teamId: number;
  /** The version the form showed: a newer one in force means asking again. */
  rulesVersionId: number;
  rulesAccepted: boolean;
}

export type RegistrationFieldError = 'not_your_roster' | 'rules_not_accepted' | 'rules_changed';

export type FileRegistrationReply =
  | { ok: true; id: number }
  | RegistrationClosed
  | { ok: false; errors: FieldErrors<RegistrationFieldError> };

/**
 * An official who manages a roster's players registers it for the season open for
 * registrations, the rulebook in force accepted. Its lineup is picked next, on its page.
 */
export function fileRegistration(
  db: Db,
  playerId: number,
  key: CompetitionKey,
  input: RegistrationRequest,
  now: number,
): FileRegistrationReply {
  return db.transaction((tx): FileRegistrationReply => {
    const open = openSeason(tx, key, now);
    if (!open.ok) return open;
    const errors: FieldErrors<RegistrationFieldError> = [];
    // Checked inside the transaction: another registration of the roster may have just been filed.
    const roster = registrableRosters(tx, playerId, open).find(
      (entry) => entry.teamId === input.teamId,
    );
    if (!roster) errors.push({ field: 'roster', error: 'not_your_roster' });
    if (!input.rulesAccepted) errors.push({ field: 'rules', error: 'rules_not_accepted' });
    else if (input.rulesVersionId !== open.rules.id) {
      errors.push({ field: 'rules', error: 'rules_changed' });
    }
    if (errors.length > 0 || !roster) return { ok: false, errors };
    const stored = tx
      .insert(request)
      .values({
        competitionId: open.competition.id,
        seasonId: open.season.id,
        teamId: roster.teamId,
        kind: 'registration',
        payloadJson: { rules: { versionId: open.rules.id, acceptedAt: now } },
        approval: 'staff',
        requestedBy: playerId,
        requestedAt: now,
      })
      .returning({ id: request.id })
      .get();
    tx.insert(auditLog)
      .values({
        actorPlayerId: playerId,
        actorKind: 'user',
        action: 'registration.file',
        entity: 'request',
        entityId: String(stored.id),
        afterJson: { teamId: roster.teamId, roster: roster.name, rulesVersionId: open.rules.id },
        at: now,
      })
      .run();
    return { ok: true, id: stored.id };
  });
}

/** Whether a season's lineups are locked now, in the league's time zone (M-29). */
export function lockedNow(
  found: {
    competition: Pick<typeof competition.$inferSelect, 'schedulingJson' | 'rulesetJson'>;
    season: Pick<typeof season.$inferSelect, 'startsOn'>;
  },
  now: number,
): boolean {
  const today = zonedDate(now, found.competition.schedulingJson.time_zone).date;
  return lineupLocked(
    today,
    found.season.startsOn,
    found.competition.rulesetJson.registration.lineup_lock_days,
  );
}

/**
 * A registration still waiting for staff, with its competition, season and roster; nothing
 * otherwise. Only registrations that name a roster wait (M-33): older ones were withdrawn.
 */
export function waitingRegistration(db: Reader, requestId: number) {
  const row = db
    .select({ request, competition, season, team })
    .from(request)
    .innerJoin(competition, eq(request.competitionId, competition.id))
    .innerJoin(season, eq(request.seasonId, season.id))
    .innerJoin(team, eq(request.teamId, team.id))
    .where(
      and(
        eq(request.id, requestId),
        eq(request.kind, 'registration'),
        eq(request.status, 'pending'),
      ),
    )
    .get();
  return row && !('roster' in row.request.payloadJson) ? row : null;
}

/**
 * A registration's lineup, starters first, then by name. Ready: nothing keeps them from playing
 * (their account, nationality, consent where required, and the league's age).
 */
export function lineupOf(
  db: Reader,
  requestId: number,
  title: string,
  settings: RegistrationSettings,
  seasonStartsOn: string,
): RegistrationPlayerView[] {
  const joined = db
    .select({ entry: registrationPlayer, name: player.displayName })
    .from(registrationPlayer)
    .innerJoin(player, eq(registrationPlayer.playerId, player.id))
    .where(eq(registrationPlayer.requestId, requestId))
    .orderBy(asc(registrationPlayer.role), asc(player.displayName), asc(player.id))
    .all();
  const profiles = profilesOf(
    db,
    joined.map(({ entry }) => entry.playerId),
    title,
  );
  return joined.map(({ entry, name }) => {
    const profile = profiles.get(entry.playerId);
    return {
      playerId: entry.playerId,
      name,
      role: entry.role,
      captain: entry.captain,
      ready: profile !== undefined && playerGaps(profile, settings, seasonStartsOn).length === 0,
    };
  });
}

/** What staff answered: the refusal's reason, or the approved roster and its division. */
function decisionOf(
  db: Reader,
  found: { reason: string | null; teamId: number | null; seasonId: number | null; status: string },
) {
  const placed =
    found.teamId === null || found.status !== 'approved'
      ? undefined
      : db
          .select({ name: team.name, slug: team.slug, division: schema.division.name })
          .from(team)
          .leftJoin(schema.slot, eq(schema.slot.teamId, team.id))
          .leftJoin(
            schema.division,
            and(
              eq(schema.slot.divisionId, schema.division.id),
              eq(schema.division.seasonId, found.seasonId ?? -1),
            ),
          )
          .where(eq(team.id, found.teamId))
          .all()
          .sort((x, y) => (x.division === null ? 1 : 0) - (y.division === null ? 1 : 0))[0];
  return {
    reason: found.reason,
    team: placed ? { name: placed.name, slug: placed.slug } : null,
    division: placed?.division ?? null,
  };
}

export interface RegistrationPlayerView {
  playerId: number;
  name: string;
  role: RegistrationRole;
  captain: boolean;
  ready: boolean;
}

/** One of the roster's players, as the filer picks the lineup among them. */
export interface LineupCandidate {
  playerId: number;
  name: string;
  /** In the lineup, and as what; null when not picked. */
  role: RegistrationRole | null;
  captain: boolean;
  /** What keeps them from playing in this league: their profile, the league's age. */
  gaps: PlayerGap[];
  /** Already in another roster or registration of the competition (O-29). */
  unavailable: boolean;
}

export type RegistrationStatus =
  | {
      ok: true;
      id: number;
      status: string;
      requestedAt: number;
      competition: { id: number; name: string; slug: string };
      season: string;
      club: string;
      /** The roster: its own page, once it names one (M-33). */
      roster: { name: string; slug: string | null };
      rulesVersion: string;
      players: RegistrationPlayerView[];
      /** The roster's players, for the filer to pick the lineup; none for older registrations. */
      candidates: LineupCandidate[];
      lineup: { complete: boolean; gaps: LineupGap[] };
      /** Lineups are locked: no player is picked, dropped or changes role (M-29). */
      locked: boolean;
      /** Staff's answer: the reason of a refusal, the roster and division of an approval. */
      decision: {
        reason: string | null;
        team: { name: string; slug: string } | null;
        division: string | null;
      };
    }
  | { ok: false; error: 'not_found' };

/**
 * A registration as the roster's officials follow it (`leadsRegistration`). Anyone else finds
 * nothing: staff see registrations in their own list.
 */
export function registrationStatus(
  db: Reader,
  playerId: number,
  requestId: number,
  now: number,
): RegistrationStatus {
  const row = db
    .select({ request, competition, season })
    .from(request)
    .innerJoin(competition, eq(request.competitionId, competition.id))
    .innerJoin(season, eq(request.seasonId, season.id))
    .where(and(eq(request.id, requestId), eq(request.kind, 'registration')))
    .get();
  const rosterName = row ? rosterNameOf(db, row.request) : null;
  if (!row || !leadsRegistration(db, playerId, row.request) || rosterName === null) {
    return { ok: false, error: 'not_found' };
  }
  const settings = row.competition.rulesetJson.registration;
  const payload = row.request.payloadJson;
  const versionId = 'rules' in payload ? payload.rules.versionId : -1;
  const rules = db
    .select({ version: rulesVersion.version })
    .from(rulesVersion)
    .where(eq(rulesVersion.id, versionId))
    .get();
  const players = lineupOf(db, requestId, row.competition.title, settings, row.season.startsOn);
  const named = 'roster' in payload ? null : row.request.teamId;
  const slug =
    named === null
      ? null
      : (db.select({ slug: team.slug }).from(team).where(eq(team.id, named)).get()?.slug ?? null);

  let candidates: LineupCandidate[] = [];
  if (named !== null) {
    const members = rosterMembers(db, named, row.competition.title);
    const ids = members.map((member) => member.playerId);
    const profiles = profilesOf(db, ids, row.competition.title);
    const taken = new Set(
      unavailablePlayers(
        db,
        { requestId, competitionId: row.competition.id, seasonId: row.season.id },
        ids,
      ),
    );
    candidates = members.map((member) => {
      const picked = players.find((entry) => entry.playerId === member.playerId);
      const profile = profiles.get(member.playerId);
      return {
        playerId: member.playerId,
        name: member.name,
        role: picked?.role ?? null,
        captain: picked?.captain ?? false,
        gaps: profile ? playerGaps(profile, settings, row.season.startsOn) : ['game_account'],
        unavailable: taken.has(member.playerId),
      };
    });
  }

  return {
    ok: true,
    id: row.request.id,
    status: row.request.status,
    requestedAt: row.request.requestedAt,
    competition: { id: row.competition.id, name: row.competition.name, slug: row.competition.slug },
    season: row.season.name,
    club: clubNameOf(db, row.request),
    roster: { name: rosterName, slug },
    rulesVersion: rules?.version ?? '?',
    players,
    candidates,
    lineup: lineupStatus(players, settings),
    locked: lockedNow(row, now),
    decision: decisionOf(db, row.request),
  };
}
