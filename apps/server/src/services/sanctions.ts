import { listSeasonTeams, schema, type Db, type SeasonTeam } from '@ligo/db';
import { and, asc, eq } from 'drizzle-orm';
import { requireStaff, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';

const { auditLog, sanction } = schema;

/**
 * The sanctions staff can give to a team today. The others of the rulebook wait for what they
 * act on: a suspension for lineups, an administrative defeat for a rule on its score.
 */
export const TEAM_SANCTION_KINDS = ['warning', 'points'] as const;
export type TeamSanctionKind = (typeof TEAM_SANCTION_KINDS)[number];

const REASON_MAX_LENGTH = 500;
// Wide enough for any real penalty, narrow enough to catch a mistyped number.
const POINTS_LIMIT = 100;

export interface SanctionEntry {
  id: number;
  kind: string;
  pointsDelta: number | null;
  reason: string;
  at: number;
  matchId: number | null;
}

export type SanctionError =
  | 'not_linked'
  | 'not_staff'
  | 'no_season'
  | 'team_not_found'
  | 'reason_required'
  | 'points_required'
  | 'points_not_allowed';

export type AddSanctionReply =
  { ok: true; team: SeasonTeam; sanction: SanctionEntry } | { ok: false; error: SanctionError };

export type ListSanctionsReply =
  { ok: true; team: SeasonTeam; sanctions: SanctionEntry[] } | { ok: false; error: SanctionError };

/** League staff acting on a team of the current season. */
function open(db: Pick<Db, 'select'>, actor: Actor, teamId: number) {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const { league } = staff;
  if (!league.season) return { ok: false as const, error: 'no_season' as const };
  const team = listSeasonTeams(db, league.season.id).find(
    (candidate) => candidate.teamId === teamId,
  );
  if (!team) return { ok: false as const, error: 'team_not_found' as const };
  return { ok: true as const, league, season: league.season, team };
}

/**
 * League staff give a team a warning, or a change of points that the standings apply at once: a
 * negative number takes points away, a positive one gives some back. A sanction is never
 * removed; a mistake is offset by the opposite one.
 */
export function addSanction(
  db: Db,
  actor: Actor,
  request: { teamId: number; kind: TeamSanctionKind; points: number | null; reason: string },
  now: number,
): AddSanctionReply {
  const opened = open(db, actor, request.teamId);
  if (!opened.ok) return opened;
  const { league, season, team } = opened;

  const reason = request.reason.trim().slice(0, REASON_MAX_LENGTH);
  if (reason === '') return { ok: false, error: 'reason_required' };
  const { points } = request;
  if (request.kind === 'warning' && points !== null) {
    return { ok: false, error: 'points_not_allowed' };
  }
  const validPoints =
    points !== null &&
    Number.isSafeInteger(points) &&
    points !== 0 &&
    Math.abs(points) <= POINTS_LIMIT;
  if (request.kind === 'points' && !validPoints) return { ok: false, error: 'points_required' };

  return db.transaction((tx): AddSanctionReply => {
    const staffPlayer = ensurePlayer(
      tx,
      { orgId: league.org.id, discordUserId: actor.user.id, displayName: actor.user.displayName },
      now,
    );
    const stored = tx
      .insert(sanction)
      .values({
        seasonId: season.id,
        // The slot is the team's place in this season: the sanction does not follow the team
        // into the next one.
        targetKind: 'slot',
        targetId: team.slotId,
        kind: request.kind,
        pointsDelta: request.kind === 'points' ? points : null,
        startsAt: now,
        reason,
        decidedBy: staffPlayer.id,
      })
      .returning()
      .get();
    tx.insert(auditLog)
      .values({
        actorPlayerId: staffPlayer.id,
        actorKind: 'user',
        action: 'sanction.add',
        entity: 'sanction',
        entityId: String(stored.id),
        afterJson: {
          teamId: team.teamId,
          slotId: team.slotId,
          kind: stored.kind,
          pointsDelta: stored.pointsDelta,
          reason,
        },
        at: now,
      })
      .run();
    return { ok: true, team, sanction: toEntry(stored) };
  });
}

/** A team's sanctions of the current season, oldest first, for league staff. */
export function listSanctions(db: Db, actor: Actor, teamId: number): ListSanctionsReply {
  const opened = open(db, actor, teamId);
  if (!opened.ok) return opened;
  const { season, team } = opened;
  const rows = db
    .select()
    .from(sanction)
    .where(and(eq(sanction.seasonId, season.id)))
    .orderBy(asc(sanction.startsAt), asc(sanction.id))
    .all()
    .filter(
      (row) =>
        (row.targetKind === 'slot' && row.targetId === team.slotId) ||
        (row.targetKind === 'team' && row.targetId === team.teamId),
    );
  return { ok: true, team, sanctions: rows.map(toEntry) };
}

const toEntry = (row: typeof sanction.$inferSelect): SanctionEntry => ({
  id: row.id,
  kind: row.kind,
  pointsDelta: row.pointsDelta,
  reason: row.reason,
  at: row.startsAt,
  matchId: row.matchId,
});
