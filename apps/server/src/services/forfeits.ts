import {
  countForfeits,
  forfeitConsequence,
  nextMatchStatus,
  type ForfeitConsequence,
  type ForfeitSide,
  type ForfeitThresholds,
} from '@ligo/core';
import { listLeagueMatches, loadStandingsInput, schema, type Db, type LeagueMatch } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { requireStaff, type Actor } from './permissions.ts';
import { resultsChannelFor } from './league-channels.ts';
import { ensurePlayer } from './players.ts';
import { settleDisputes } from './disputes.ts';
import { openReportPosts, type OpenReportPosts } from './open-report.ts';
import { excludeSlot, type Excluded } from './exclusions.ts';

const { auditLog, game, match, sanction, slot } = schema;

export type ForfeitError =
  'not_linked' | 'not_staff' | 'match_not_found' | 'wrong_status' | 'unsupported_series';

/** What the forfeit means for one team that forfeited. */
export interface ForfeitOutcome {
  side: 'a' | 'b';
  /** How many forfeits the team now has in this stage. */
  count: number;
  consequence: ForfeitConsequence;
  /** The team, when this forfeit excluded it automatically. */
  excluded: Excluded | null;
  /** Why staff switched the automatic exclusion off for this team, when they did. */
  autoExclusionOffReason: string | null;
}

export type ForfeitReply =
  | ({
      ok: true;
      match: LeagueMatch;
      /** Who forfeited: one side, or both when neither team showed up (O-28). */
      side: ForfeitSide;
      /** One outcome per team that forfeited, side A first. */
      teams: ForfeitOutcome[];
      /** Where staff are alerted when a count reaches the exclusion threshold. */
      queueChannelId: string | null;
      /** Where results are announced: a forfeit counts in the standings like any result. */
      resultsChannelId: string | null;
      // A report still open is superseded: its posts and disputes close (`OpenReportPosts`).
    } & OpenReportPosts)
  | { ok: false; error: ForfeitError };

/**
 * League staff record that one team forfeited a match, or both when neither showed up (O-28):
 * only staff can, a team never claims a forfeit win itself. The opponent's win counts at once;
 * after a forfeit by both, each team has a forfeit loss and each forfeit counts for its team. Reaching the season's warning threshold
 * adds a warning sanction in the same transaction; `warningReason` words it. Reaching the
 * exclusion threshold excludes the team in the same transaction (O-05), unless staff switched
 * that off for it; `exclusionReason` words the sanction. Staff can reinstate it on appeal.
 */
export function recordForfeit(
  db: Db,
  actor: Actor,
  request: {
    matchId: number;
    side: ForfeitSide;
    warningReason: (count: number) => string;
    exclusionReason: (count: number) => string;
  },
  now: number,
): ForfeitReply {
  const staff = requireStaff(db, actor, { matchId: request.matchId });
  if (!staff.ok) return staff;
  const { league } = staff;
  if (!league.season) return { ok: false, error: 'match_not_found' };
  const { season } = league;

  return db.transaction((tx): ForfeitReply => {
    const [found] = listLeagueMatches(tx, { matchId: request.matchId });
    if (found?.competitionId !== league.competition.id) {
      return { ok: false, error: 'match_not_found' };
    }
    const step = nextMatchStatus({
      status: found.status,
      action: 'forfeit',
      actor: 'staff',
      validation: league.competition.rulesetJson.result_validation,
    });
    if (!step.ok) return { ok: false, error: 'wrong_status' };
    if (found.bestOf !== 1) return { ok: false, error: 'unsupported_series' };

    const staffPlayer = ensurePlayer(
      tx,
      { orgId: league.org.id, discordUserId: actor.user.id, displayName: actor.user.displayName },
      now,
    );
    // A forfeit stores no rounds: the season's forfeit score is applied when standings are
    // computed.
    const forfeited = { scoreA: 0, scoreB: 0, forfeitSide: request.side, status: 'final' as const };
    if (found.game) {
      tx.update(game).set(forfeited).where(eq(game.id, found.game.id)).run();
    } else {
      tx.insert(game)
        .values({ matchId: found.id, n: 1, bansJson: [], ...forfeited })
        .run();
    }
    tx.update(match)
      .set({ status: 'forfeit', validatedBy: staffPlayer.id, validatedAt: now })
      .where(eq(match.id, found.id))
      .run();
    // Read before the disputes are settled, which would leave none open to name.
    const open = openReportPosts(tx, league, found.id);
    settleDisputes(tx, found.id, 'forfeit', staffPlayer.id, now);

    // Counted after the change, over the stage, from the same data standings use.
    const stage = loadStandingsInput(tx, found.stageId);
    if (!stage) throw new Error(`Match ${found.id} has no stage`);
    const sides = request.side === 'both' ? (['a', 'b'] as const) : [request.side];
    const teams = sides.map((side): ForfeitOutcome & { teamId: number } => {
      const team = stage.teams.find((entry) => entry.teamId === found[side].teamId);
      if (!team) throw new Error(`Match ${found.id} has a team outside its stage`);
      const count = countForfeits(stage.input.matches, team.entry);
      const consequence = forfeitConsequence(count, season.settingsJson.forfeits);

      if (consequence === 'warning') {
        tx.insert(sanction)
          .values({
            seasonId: season.id,
            targetKind: 'slot',
            targetId: team.slotId,
            kind: 'warning',
            matchId: found.id,
            startsAt: now,
            reason: request.warningReason(count),
            decidedBy: staffPlayer.id,
          })
          .run();
      }
      let excluded: Excluded | null = null;
      let autoExclusionOffReason: string | null = null;
      if (consequence === 'exclusion') {
        const slotRow = tx.select().from(slot).where(eq(slot.id, team.slotId)).get();
        autoExclusionOffReason = slotRow?.autoExclusionOffReason ?? null;
        if (autoExclusionOffReason === null) {
          // Null when the team is already excluded: a later forfeit changes nothing more.
          excluded = excludeSlot(
            tx,
            {
              seasonId: season.id,
              slotId: team.slotId,
              reason: request.exclusionReason(count),
              decidedBy: staffPlayer.id,
              automatic: true,
              matchId: found.id,
            },
            now,
          );
        }
      }
      return { side, teamId: team.teamId, count, consequence, excluded, autoExclusionOffReason };
    });
    tx.insert(auditLog)
      .values({
        actorPlayerId: staffPlayer.id,
        actorKind: 'user',
        action: 'match.forfeit',
        entity: 'match',
        entityId: String(found.id),
        beforeJson: {
          status: found.status,
          ...(found.game ? { scoreA: found.game.scoreA, scoreB: found.game.scoreB } : {}),
        },
        afterJson: {
          status: 'forfeit',
          side: request.side,
          teams: teams.map(({ teamId, count, consequence }) => ({
            teamId,
            forfeits: count,
            consequence,
          })),
        },
        at: now,
      })
      .run();

    return {
      ok: true,
      match: found,
      side: request.side,
      teams: teams.map(({ side, count, consequence, excluded, autoExclusionOffReason }) => ({
        side,
        count,
        consequence,
        excluded,
        autoExclusionOffReason,
      })),
      queueChannelId: league.guild.alertsChannelId,
      resultsChannelId: resultsChannelFor(league, found),
      ...open,
    };
  });
}

/**
 * Each side's forfeits so far in the match's stage, and the season's thresholds, for staff to see
 * what a forfeit would bring before recording it. Null for an unknown match.
 */
export function matchForfeitCounts(
  db: Pick<Db, 'select'>,
  matchId: number,
): { a: number; b: number; thresholds: ForfeitThresholds | null } | null {
  const [found] = listLeagueMatches(db, { matchId });
  const stage = found && loadStandingsInput(db, found.stageId);
  if (!found || !stage) return null;
  const countOf = (side: 'a' | 'b') => {
    const team = stage.teams.find((entry) => entry.teamId === found[side].teamId);
    return team ? countForfeits(stage.input.matches, team.entry) : 0;
  };
  const [season] = db
    .select()
    .from(schema.season)
    .where(eq(schema.season.id, found.seasonId))
    .all();
  return { a: countOf('a'), b: countOf('b'), thresholds: season?.settingsJson.forfeits ?? null };
}
