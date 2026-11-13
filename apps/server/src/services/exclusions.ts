import { applyExclusions, type ExclusionSummary } from '@ligo/core';
import {
  listSeasonTeams,
  loadStandingsInput,
  schema,
  type Db,
  type GuildLeague,
  type LeagueMatch,
  type SeasonTeam,
} from '@ligo/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { requireStaff, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';
import { listTeamStaff } from './team-staff.ts';

// Excluding a team from the season (design doc section 5; maintainer, 13 November 2026, O-04 and
// O-05). Exclusion is a slot status and a sanction; the 50% rule is applied when standings are
// computed, so reinstating a team restores every match as it was.

const { auditLog, competition, division, sanction, season, slot, stage, stageEntry } = schema;

const REASON_MAX_LENGTH = 500;

// The database or a transaction on it, as ensurePlayer takes.
type Tx = Parameters<typeof ensurePlayer>[0];

/** The team's stage entry and how the 50% rule treats it, once excluded. */
function summaryOf(db: Pick<Db, 'select'>, slotId: number): ExclusionSummary | null {
  const entry = db
    .select({ id: stageEntry.id, stageId: stageEntry.stageId })
    .from(stageEntry)
    .innerJoin(stage, eq(stageEntry.stageId, stage.id))
    .where(and(eq(stageEntry.slotId, slotId), eq(stage.kind, 'round_robin')))
    .get();
  const data = entry && loadStandingsInput(db, entry.stageId);
  if (!entry || !data) return null;
  const { exclusions } = applyExclusions(data.input.matches, data.input.pending ?? [], [entry.id]);
  return exclusions[0] ?? null;
}

export interface Excluded {
  slotId: number;
  teamId: number;
  summary: ExclusionSummary | null;
  /** The team's manager and staff, told directly. */
  memberIds: string[];
  /** The season the team is excluded from, by name, for the message to the team. */
  season: { name: string; competition: string };
}

/**
 * Excludes a slot: its status, an `exclusion` sanction and the audit entry, in the caller's
 * transaction. Returns null when the slot is not active, so a second exclusion changes nothing.
 */
export function excludeSlot(
  tx: Tx,
  request: {
    seasonId: number;
    slotId: number;
    reason: string;
    decidedBy: number;
    automatic: boolean;
    matchId?: number;
  },
  now: number,
): Excluded | null {
  const row = tx.select().from(slot).where(eq(slot.id, request.slotId)).get();
  if (row?.status !== 'active') return null;
  tx.update(slot).set({ status: 'excluded', excludedAt: now }).where(eq(slot.id, row.id)).run();
  const stored = tx
    .insert(sanction)
    .values({
      seasonId: request.seasonId,
      targetKind: 'slot',
      targetId: row.id,
      kind: 'exclusion',
      matchId: request.matchId ?? null,
      startsAt: now,
      reason: request.reason,
      decidedBy: request.decidedBy,
    })
    .returning({ id: sanction.id })
    .get();
  const summary = summaryOf(tx, row.id);
  tx.insert(auditLog)
    .values({
      actorPlayerId: request.decidedBy,
      actorKind: 'user',
      action: request.automatic ? 'slot.exclude_auto' : 'slot.exclude',
      entity: 'slot',
      entityId: String(row.id),
      beforeJson: { status: row.status },
      afterJson: { status: 'excluded', sanctionId: stored.id, reason: request.reason, summary },
      at: now,
    })
    .run();
  const names = tx
    .select({ name: season.name, competition: competition.name })
    .from(season)
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .where(eq(season.id, request.seasonId))
    .get();
  return {
    slotId: row.id,
    teamId: row.teamId,
    summary,
    season: names ?? { name: '?', competition: '?' },
    memberIds: listTeamStaff(tx, row.teamId).flatMap((member) => member.discordUserId ?? []),
  };
}

/** True when the match involves a team excluded from its division: nothing more is played. */
export function hasExcludedTeam(db: Pick<Db, 'select'>, found: LeagueMatch): boolean {
  if (!found.division) return false;
  return (
    db
      .select({ id: slot.id })
      .from(slot)
      .where(
        and(
          eq(slot.divisionId, found.division.id),
          inArray(slot.teamId, [found.a.teamId, found.b.teamId]),
          eq(slot.status, 'excluded'),
        ),
      )
      .get() !== undefined
  );
}

// ---------------------------------------------------------------------------------------------
// Staff commands

export type ExclusionError =
  | 'not_linked'
  | 'not_staff'
  | 'no_season'
  | 'team_not_found'
  | 'reason_required'
  | 'already_excluded'
  | 'not_excluded'
  | 'already_set';

interface Opened {
  league: GuildLeague;
  seasonId: number;
  team: SeasonTeam;
  reason: string;
}

function open(
  db: Pick<Db, 'select'>,
  actor: Actor,
  request: { teamId: number; reason: string },
): { ok: true; opened: Opened } | { ok: false; error: ExclusionError } {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const { league } = staff;
  if (!league.season) return { ok: false, error: 'no_season' };
  const team = listSeasonTeams(db, league.season.id).find(
    (candidate) => candidate.teamId === request.teamId,
  );
  if (!team) return { ok: false, error: 'team_not_found' };
  const reason = request.reason.trim().slice(0, REASON_MAX_LENGTH);
  if (reason === '') return { ok: false, error: 'reason_required' };
  return { ok: true, opened: { league, seasonId: league.season.id, team, reason } };
}

const staffPlayerOf = (tx: Tx, league: GuildLeague, actor: Actor, now: number) =>
  ensurePlayer(
    tx,
    { orgId: league.org.id, discordUserId: actor.user.id, displayName: actor.user.displayName },
    now,
  ).id;

/** Where an exclusion or a reinstatement is announced: the team's division, else the league. */
function channelsOf(db: Pick<Db, 'select'>, league: GuildLeague, slotId: number) {
  const row = db
    .select({ resultsChannelId: division.resultsChannelId })
    .from(slot)
    .innerJoin(division, eq(slot.divisionId, division.id))
    .where(eq(slot.id, slotId))
    .get();
  return {
    resultsChannelId: row?.resultsChannelId ?? league.guild.resultsChannelId,
    queueChannelId: league.guild.alertsChannelId,
  };
}

export type ExcludeReply =
  | {
      ok: true;
      team: SeasonTeam;
      excluded: Excluded;
      reason: string;
      resultsChannelId: string | null;
      queueChannelId: string | null;
    }
  | { ok: false; error: ExclusionError };

/** League staff exclude a team, for forfeits or any other reason the rulebook gives. */
export function excludeTeam(
  db: Db,
  actor: Actor,
  request: { teamId: number; reason: string },
  now: number,
): ExcludeReply {
  const checked = open(db, actor, request);
  if (!checked.ok) return checked;
  const { league, seasonId, team, reason } = checked.opened;
  return db.transaction((tx): ExcludeReply => {
    const decidedBy = staffPlayerOf(tx, league, actor, now);
    const excluded = excludeSlot(
      tx,
      { seasonId, slotId: team.slotId, reason, decidedBy, automatic: false },
      now,
    );
    if (!excluded) return { ok: false, error: 'already_excluded' };
    return { ok: true, team, excluded, reason, ...channelsOf(tx, league, team.slotId) };
  });
}

export type ReinstateReply =
  | {
      ok: true;
      team: SeasonTeam;
      reason: string;
      memberIds: string[];
      resultsChannelId: string | null;
      queueChannelId: string | null;
    }
  | { ok: false; error: ExclusionError };

/**
 * League staff reverse an exclusion, on appeal: the team is active again, its exclusion sanction
 * ends, and the standings count its matches as they are.
 */
export function reinstateTeam(
  db: Db,
  actor: Actor,
  request: { teamId: number; reason: string },
  now: number,
): ReinstateReply {
  const checked = open(db, actor, request);
  if (!checked.ok) return checked;
  const { league, seasonId, team, reason } = checked.opened;
  return db.transaction((tx): ReinstateReply => {
    const row = tx.select().from(slot).where(eq(slot.id, team.slotId)).get();
    if (row?.status !== 'excluded') return { ok: false, error: 'not_excluded' };
    const decidedBy = staffPlayerOf(tx, league, actor, now);
    tx.update(slot).set({ status: 'active', excludedAt: null }).where(eq(slot.id, row.id)).run();
    tx.update(sanction)
      .set({ endsAt: now })
      .where(
        and(
          eq(sanction.seasonId, seasonId),
          eq(sanction.targetKind, 'slot'),
          eq(sanction.targetId, row.id),
          eq(sanction.kind, 'exclusion'),
          isNull(sanction.endsAt),
        ),
      )
      .run();
    tx.insert(auditLog)
      .values({
        actorPlayerId: decidedBy,
        actorKind: 'user',
        action: 'slot.reinstate',
        entity: 'slot',
        entityId: String(row.id),
        beforeJson: { status: row.status, excludedAt: row.excludedAt },
        afterJson: { status: 'active', reason },
        at: now,
      })
      .run();
    return {
      ok: true,
      team,
      reason,
      memberIds: listTeamStaff(tx, team.teamId).flatMap((member) => member.discordUserId ?? []),
      ...channelsOf(tx, league, team.slotId),
    };
  });
}

export type AutoExclusionReply =
  | { ok: true; team: SeasonTeam; enabled: boolean; reason: string }
  | { ok: false; error: ExclusionError };

/**
 * League staff switch the automatic exclusion off for one team, always with a reason, or back
 * on. A team with it off can still be excluded by staff.
 */
export function setAutoExclusion(
  db: Db,
  actor: Actor,
  request: { teamId: number; enabled: boolean; reason: string },
  now: number,
): AutoExclusionReply {
  const checked = open(db, actor, request);
  if (!checked.ok) return checked;
  const { league, team, reason } = checked.opened;
  return db.transaction((tx): AutoExclusionReply => {
    const row = tx.select().from(slot).where(eq(slot.id, team.slotId)).get();
    if (!row) return { ok: false, error: 'team_not_found' };
    const isOn = row.autoExclusionOffReason === null;
    if (isOn === request.enabled) return { ok: false, error: 'already_set' };
    const decidedBy = staffPlayerOf(tx, league, actor, now);
    // The reason, who and when are set and cleared together.
    tx.update(slot)
      .set(
        request.enabled
          ? { autoExclusionOffReason: null, autoExclusionOffBy: null, autoExclusionOffAt: null }
          : {
              autoExclusionOffReason: reason,
              autoExclusionOffBy: decidedBy,
              autoExclusionOffAt: now,
            },
      )
      .where(eq(slot.id, row.id))
      .run();
    tx.insert(auditLog)
      .values({
        actorPlayerId: decidedBy,
        actorKind: 'user',
        action: request.enabled ? 'slot.auto_exclusion_on' : 'slot.auto_exclusion_off',
        entity: 'slot',
        entityId: String(row.id),
        beforeJson: { autoExclusionOffReason: row.autoExclusionOffReason },
        afterJson: { reason },
        at: now,
      })
      .run();
    return { ok: true, team, enabled: request.enabled, reason };
  });
}
