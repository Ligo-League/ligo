import {
  isPossibleGameScore,
  nextMatchStatus,
  OTHER_DISPUTE_REASON,
  type DisputeReason,
  type GameScoreSettings,
  type MatchAction,
  type MatchActor,
} from '@ligo/core';
import {
  findGuildLeague,
  latestScoreEvidence,
  listLeagueMatches,
  schema,
  type Db,
  type GuildLeague,
  type LeagueMatch,
  type Tx,
} from '@ligo/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { CommandFile, OutgoingMessage } from '../discord/commands/types.ts';
import type { EvidenceStore } from '../assets/evidence-store.ts';
import type { DiscordGateway } from '../discord/gateway.ts';
import { evidenceKeyOf, imageTypeOf, keepEvidence } from './evidence.ts';
import { matchQuery } from './match-search.ts';
import {
  actsFor,
  matchActorOf,
  matchRolesOf,
  requireStaff,
  sideOf,
  type Actor,
} from './permissions.ts';
import { resultsChannelFor } from './league-channels.ts';
import { settleDisputes, type DisputeResolution } from './disputes.ts';
import { hasExcludedTeam } from './exclusions.ts';
import { ensurePlayer } from './players.ts';
import { queuePostsOf, recordQueuePost, type PostRef } from './queue-posts.ts';
import { isAcceptableScreenshot, SCREENSHOT_MAX_BYTES, type Screenshot } from './results.ts';
import { teamMentions } from './team-staff.ts';

const { auditLog, dispute: disputeTable, evidence, game, match, player } = schema;

type Side = 'a' | 'b';
const other = (side: Side): Side => (side === 'a' ? 'b' : 'a');

// `sideOf`: someone acting for both teams counts for side A; the other side is then theirs too,
// so they can still confirm. A club official acts for neither of two rosters of their club.

/** The side whose official reported the match's current result; null with no report. */
export function reportingSide(db: Pick<Db, 'select'>, found: LeagueMatch): Side | null {
  return found.reportedBy === null
    ? null
    : sideOf(matchRolesOf(db, found.reportedBy, found.seasonId), found);
}

/** The match of that ID if it belongs to the league of the server, else nothing. */
export function leagueMatch(
  db: Pick<Db, 'select'>,
  league: GuildLeague,
  matchId: number,
): LeagueMatch | undefined {
  const [found] = listLeagueMatches(db, { matchId });
  // A match of another league is treated as missing: nothing about it leaks.
  return found?.competitionId === league.competition.id ? found : undefined;
}

const scoreOf = (stored: LeagueMatch['game']) =>
  stored ? { scoreA: stored.scoreA, scoreB: stored.scoreB } : {};

// ---------------------------------------------------------------------------------------------
// A team reports

/** A screenshot uploaded on the website: the file's own bytes. */
export interface UploadedScreenshot {
  data: Uint8Array;
}

export interface ReportRequest {
  matchId: number;
  /** Rounds won by side A and side B of the match. */
  scoreA: number;
  scoreB: number;
  /** Attached in Discord (its address there), or uploaded on the website (its bytes). */
  screenshot: Screenshot | UploadedScreenshot | null;
}

const isUpload = (screenshot: Screenshot | UploadedScreenshot): screenshot is UploadedScreenshot =>
  'data' in screenshot;

/**
 * The same checks wherever the screenshot comes from: an image of at most the size Discord
 * allows. An upload is judged by its own bytes, never by the name or type the browser gave.
 */
function acceptable(screenshot: Screenshot | UploadedScreenshot): boolean {
  if (!isUpload(screenshot)) return isAcceptableScreenshot(screenshot);
  const { data } = screenshot;
  return data.length > 0 && data.length <= SCREENSHOT_MAX_BYTES && imageTypeOf(data) !== null;
}

export type ReportError =
  | 'not_linked'
  | 'no_team'
  | 'match_not_found'
  | 'not_your_match'
  | 'not_reportable'
  | 'team_excluded'
  | 'unsupported_series'
  | 'invalid_score'
  | 'screenshot_required'
  | 'invalid_screenshot'
  | 'queue_not_set';

type ReportRefusal =
  | { ok: false; error: ReportError }
  | { ok: false; error: 'impossible_score'; rule: GameScoreSettings };

type ReportCheck =
  | ReportRefusal
  | {
      ok: true;
      league: GuildLeague;
      match: LeagueMatch;
      side: Side;
      screenshot: Screenshot | UploadedScreenshot;
      queueChannelId: string;
    };

/**
 * Everything that can refuse a report, checked without writing: the command runs it before
 * announcing a public reply, and `reportResult` runs it again inside its transaction.
 */
export function checkReport(
  db: Pick<Db, 'select'>,
  actor: Actor,
  request: ReportRequest,
): ReportCheck {
  const league = actor.guildId === null ? undefined : findGuildLeague(db, actor.guildId);
  if (!league) return { ok: false, error: 'not_linked' };
  // Checked before the match: someone who manages no team needs to hear that, whatever they picked.
  if (matchActorOf(db, actor, league.season?.id ?? null).teams.length === 0) {
    return { ok: false, error: 'no_team' };
  }
  const found = leagueMatch(db, league, request.matchId);
  if (!found) return { ok: false, error: 'match_not_found' };

  const side = sideOf(matchActorOf(db, actor, found.seasonId).teams, found);
  if (side === null) return { ok: false, error: 'not_your_match' };
  const { rulesetJson } = league.competition;
  const step = nextMatchStatus({
    status: found.status,
    action: 'report',
    actor: 'reporting_team',
    validation: rulesetJson.result_validation,
  });
  if (!step.ok) return { ok: false, error: 'not_reportable' };
  // An excluded team plays no more: the 50% rule decides its matches.
  if (hasExcludedTeam(db, found)) return { ok: false, error: 'team_excluded' };
  if (found.bestOf !== 1) return { ok: false, error: 'unsupported_series' };

  const { scoreA, scoreB } = request;
  const whole = [scoreA, scoreB].every((score) => Number.isSafeInteger(score) && score >= 0);
  if (!whole || scoreA === scoreB) return { ok: false, error: 'invalid_score' };
  if (rulesetJson.game_score && !isPossibleGameScore(rulesetJson.game_score, scoreA, scoreB)) {
    return { ok: false, error: 'impossible_score', rule: rulesetJson.game_score };
  }

  // A team's result rests on its screenshot: staff validate by looking at it.
  if (!request.screenshot) return { ok: false, error: 'screenshot_required' };
  if (!acceptable(request.screenshot)) return { ok: false, error: 'invalid_screenshot' };
  const queueChannelId = league.guild.alertsChannelId;
  if (!queueChannelId) return { ok: false, error: 'queue_not_set' };

  return { ok: true, league, match: found, side, screenshot: request.screenshot, queueChannelId };
}

export interface ReportDetails {
  match: LeagueMatch;
  scoreA: number;
  scoreB: number;
  /** The side that reported. */
  side: Side;
  /** Marks this report: the nonce of its buttons. */
  evidenceId: number;
  /** The other side's officials and captain, to mention (Discord IDs). */
  opponentIds: string[];
  screenshot: CommandFile;
  /** Where a report made on the website is posted for the other team (M-32), when set. */
  scheduleChannelId: string | null;
}

export type ReportReply =
  | ReportRefusal
  /** The screenshot could not be downloaded, or (uploaded) kept by the server. */
  | { ok: false; error: 'screenshot_unreadable' | 'screenshot_unstored' }
  /**
   * `queued` is false when the report is stored but could not be posted to the staff queue;
   * `kept` is false when the server could not keep its own copy of the screenshot.
   */
  | ({ ok: true; queued: boolean; kept: boolean } & ReportDetails);

const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const;

/**
 * A team's officials or captain report the result of its match. A screenshot attached in Discord
 * is downloaded, kept by the server for the website, and posted again in the staff queue: the
 * link Discord gave for the upload expires. One uploaded on the website is kept first, since it
 * is the only copy. `queueMessage` formats the queue post; the service knows no user-facing text.
 */
export async function reportResult(
  db: Db,
  gateway: DiscordGateway,
  store: EvidenceStore,
  actor: Actor,
  request: ReportRequest,
  queueMessage: (report: ReportDetails) => OutgoingMessage,
  now: number,
): Promise<ReportReply> {
  const first = checkReport(db, actor, request);
  if (!first.ok) return first;

  const source = first.screenshot;
  let data: Uint8Array;
  if (isUpload(source)) {
    data = source.data;
  } else {
    try {
      data = await gateway.downloadAttachment(source.url, SCREENSHOT_MAX_BYTES);
    } catch {
      return { ok: false, error: 'screenshot_unreadable' };
    }
  }
  // The type Discord declares is the uploader's word; the file's own bytes decide.
  const type = imageTypeOf(data);
  if (!type) return { ok: false, error: 'invalid_screenshot' };
  const screenshot: CommandFile = { name: `score-${request.matchId}.${EXTENSIONS[type]}`, data };
  let objectKey: string | null = null;
  if (isUpload(source)) {
    const key = evidenceKeyOf(request.matchId, data, type);
    try {
      await store.put(key, data);
    } catch {
      // Without the server's copy there would be no screenshot at all: nothing is stored.
      return { ok: false, error: 'screenshot_unstored' };
    }
    objectKey = key;
  }

  const stored = db.transaction((tx): ReportRefusal | ({ ok: true } & ReportDetails) => {
    // The download took time: the match may have been reported or changed meanwhile.
    const check = checkReport(tx, actor, request);
    if (!check.ok) return check;
    const { league, match: found, side } = check;
    const { scoreA, scoreB } = request;

    const reporter = ensurePlayer(
      tx,
      { orgId: league.org.id, discordUserId: actor.user.id, displayName: actor.user.displayName },
      now,
    );
    let gameId = found.game?.id;
    if (gameId === undefined) {
      gameId = tx
        .insert(game)
        .values({ matchId: found.id, n: 1, bansJson: [], scoreA, scoreB, status: 'pending' })
        .returning({ id: game.id })
        .get().id;
    } else {
      tx.update(game)
        .set({ scoreA, scoreB, forfeitSide: null, status: 'pending' })
        .where(eq(game.id, gameId))
        .run();
    }
    tx.update(match)
      .set({ status: 'reported', reportedBy: reporter.id, confirmedBy: null })
      .where(eq(match.id, found.id))
      .run();
    const evidenceId = tx
      .insert(evidence)
      .values({
        matchId: found.id,
        gameId,
        kind: 'score_screenshot',
        objectKey,
        // Replaced below by the address of the staff queue post, which does not expire.
        url: isUpload(check.screenshot) ? null : check.screenshot.url,
        uploadedBy: reporter.id,
        visibility: 'teams',
        at: now,
      })
      .returning({ id: evidence.id })
      .get().id;
    tx.insert(auditLog)
      .values({
        actorPlayerId: reporter.id,
        actorKind: 'user',
        action: 'match.report',
        entity: 'match',
        entityId: String(found.id),
        beforeJson: { status: found.status },
        afterJson: { status: 'reported', side, scoreA, scoreB, evidenceId },
        at: now,
      })
      .run();

    const opponentIds = teamMentions(tx, found[other(side)].teamId, found.seasonId, found.id);
    return {
      ok: true,
      match: found,
      scoreA,
      scoreB,
      side,
      evidenceId,
      opponentIds,
      screenshot,
      scheduleChannelId: league.guild.scheduleChannelId,
    };
  });
  if (!stored.ok) return stored;
  const kept =
    objectKey !== null ||
    (await keepEvidence(
      db,
      store,
      { evidenceId: stored.evidenceId, matchId: stored.match.id },
      data,
    ));

  let queued = true;
  try {
    const post = await gateway.postMessage(first.queueChannelId, {
      ...queueMessage(stored),
      files: [screenshot],
    });
    db.update(evidence).set({ url: post.url }).where(eq(evidence.id, stored.evidenceId)).run();
    recordQueuePost(
      db,
      { entity: 'match', entityId: stored.match.id },
      { channelId: first.queueChannelId, messageId: post.messageId },
      now,
    );
  } catch {
    // The report is stored and staff can still find it with their command; only the queue
    // post is missing.
    queued = false;
  }
  return { ...stored, queued, kept };
}

/** Where a report's public post is, when it is known. */
function publicPostOf(
  report: { postChannelId: string | null; postMessageId: string | null } | undefined,
): PostRef | null {
  return report?.postChannelId && report.postMessageId
    ? { channelId: report.postChannelId, messageId: report.postMessageId }
    : null;
}

/** Keeps where the report's public post is, with the other team's buttons, so an answer edits it. */
export function recordReportPost(db: Db, evidenceId: number, post: PostRef): void {
  db.update(evidence)
    .set({ postChannelId: post.channelId, postMessageId: post.messageId })
    .where(eq(evidence.id, evidenceId))
    .run();
}

export type ReportableSearch =
  | { ok: true; matches: LeagueMatch[] }
  /** Why nothing can be offered at all, so the member is told instead of seeing an empty list. */
  | { ok: false; error: 'not_linked' | 'no_season' | 'no_team' };

/** The matches a member can report: those of their teams still to play, narrowed by `query`. */
export function searchReportableMatches(
  db: Pick<Db, 'select'>,
  actor: Actor,
  query: string,
  limit: number,
): ReportableSearch {
  const league = actor.guildId === null ? undefined : findGuildLeague(db, actor.guildId);
  if (!league) return { ok: false, error: 'not_linked' };
  if (!league.season) return { ok: false, error: 'no_season' };
  const { teams } = matchActorOf(db, actor, league.season.id);
  if (teams.length === 0) return { ok: false, error: 'no_team' };
  const matches = listLeagueMatches(db, { seasonId: league.season.id })
    .filter((found) => found.status === 'scheduled' && found.bestOf === 1)
    .filter((found) => sideOf(teams, found) !== null)
    .filter((found) => !hasExcludedTeam(db, found))
    .filter(matchQuery(query))
    .slice(0, limit);
  return { ok: true, matches };
}

// ---------------------------------------------------------------------------------------------
// The opponent confirms or disputes

export type AnswerError =
  | 'not_linked'
  | 'match_not_found'
  | 'stale'
  | 'not_your_match'
  | 'not_opponent'
  | 'wrong_status'
  | 'reason_unknown'
  | 'details_required'
  | 'details_too_long';

/** The longest explanation a team can give with a dispute. */
export const DISPUTE_DETAILS_MAX_LENGTH = 1000;

type AnswerTarget = { matchId: number; evidenceId: number };
export type AnswerRequest = AnswerTarget &
  (
    | { action: 'confirm' }
    /** `reason` is a key of the competition's dispute reasons, or "other". */
    | { action: 'dispute'; reason: string; details: string | null }
  );

/** The dispute as stored, with its label so the staff queue can show it. */
export interface DisputeDetails {
  reason: string;
  /** Null for "other", which has no label in the settings. */
  label: DisputeReason['label'] | null;
  details: string | null;
}

export type AnswerReply =
  | {
      ok: true;
      match: LeagueMatch;
      status: 'confirmed' | 'disputed' | 'validated';
      /** The dispute stored, with its row's ID for its post in the staff queue. */
      dispute: (DisputeDetails & { id: number }) | null;
      /**
       * When the confirmation validated the result: the report's posts in the staff queue, which
       * no longer wait for anyone. Empty otherwise.
       */
      posts: PostRef[];
      /** The report's public post, with the buttons answered, when it is known. */
      post: PostRef | null;
      queueChannelId: string | null;
      resultsChannelId: string | null;
    }
  | { ok: false; error: AnswerError };

type AnswerCheck =
  | {
      ok: true;
      found: LeagueMatch;
      playerId: number;
      status: 'confirmed' | 'disputed' | 'validated';
    }
  | { ok: false; error: AnswerError };

/** Whether this member may answer this report so, read again from the database each time. */
function checkAnswer(
  db: Pick<Db, 'select'>,
  league: GuildLeague,
  actor: Actor,
  request: AnswerTarget & { action: 'confirm' | 'dispute' },
): AnswerCheck {
  const found = leagueMatch(db, league, request.matchId);
  if (!found) return { ok: false, error: 'match_not_found' };
  if (latestScoreEvidence(db, found.id)?.id !== request.evidenceId) {
    return { ok: false, error: 'stale' };
  }

  const acting = matchActorOf(db, actor, found.seasonId);
  if (acting.playerId === null || sideOf(acting.teams, found) === null) {
    return { ok: false, error: 'not_your_match' };
  }
  const reporter = reportingSide(db, found) ?? 'a';
  const kind: MatchActor = actsFor(acting.teams, found, other(reporter))
    ? 'opposing_team'
    : 'reporting_team';
  const step = nextMatchStatus({
    status: found.status,
    action: request.action,
    actor: kind,
    validation: league.competition.rulesetJson.result_validation,
  });
  if (!step.ok) {
    return { ok: false, error: step.error === 'not_allowed' ? 'not_opponent' : 'wrong_status' };
  }
  // `confirm` and `dispute` lead to exactly these three statuses.
  const status = step.status as 'confirmed' | 'disputed' | 'validated';
  return { ok: true, found, playerId: acting.playerId, status };
}

/** A reason the league offers, or "other" with details; details are trimmed, empty is none. */
function checkDisputeInput(
  reasons: readonly DisputeReason[],
  reason: string,
  rawDetails: string | null,
): { ok: true; dispute: DisputeDetails } | { ok: false; error: AnswerError } {
  const details = rawDetails?.trim() || null;
  if (details !== null && details.length > DISPUTE_DETAILS_MAX_LENGTH) {
    return { ok: false, error: 'details_too_long' };
  }
  if (reason === OTHER_DISPUTE_REASON) {
    // "Other" says nothing by itself: staff need the team's own words.
    if (details === null) return { ok: false, error: 'details_required' };
    return { ok: true, dispute: { reason, label: null, details } };
  }
  const known = reasons.find((candidate) => candidate.key === reason);
  if (!known) return { ok: false, error: 'reason_unknown' };
  return { ok: true, dispute: { reason, label: known.label, details } };
}

/**
 * Before the dispute form opens: may this member dispute this report? Answers with the reasons
 * the league offers, without writing anything; `answerReport` checks everything again.
 */
export function checkDispute(
  db: Pick<Db, 'select'>,
  actor: Actor,
  request: AnswerTarget,
): { ok: true; reasons: readonly DisputeReason[] } | { ok: false; error: AnswerError } {
  const league = actor.guildId === null ? undefined : findGuildLeague(db, actor.guildId);
  if (!league) return { ok: false, error: 'not_linked' };
  const check = checkAnswer(db, league, actor, { ...request, action: 'dispute' });
  if (!check.ok) return check;
  return { ok: true, reasons: league.competition.rulesetJson.dispute_reasons };
}

/**
 * The other team confirms the reported result, or disputes it with a reason. `evidenceId` names
 * the report the button belongs to: a button left under an older report is stale.
 */
export function answerReport(
  db: Db,
  actor: Actor,
  request: AnswerRequest,
  now: number,
): AnswerReply {
  const league = actor.guildId === null ? undefined : findGuildLeague(db, actor.guildId);
  if (!league) return { ok: false, error: 'not_linked' };

  return db.transaction((tx): AnswerReply => {
    const check = checkAnswer(tx, league, actor, request);
    if (!check.ok) return check;
    const { found, playerId, status } = check;
    let dispute: DisputeDetails | null = null;
    if (request.action === 'dispute') {
      const input = checkDisputeInput(
        league.competition.rulesetJson.dispute_reasons,
        request.reason,
        request.details,
      );
      if (!input.ok) return input;
      dispute = input.dispute;
    }

    tx.update(match)
      .set({
        status,
        ...(request.action === 'confirm' ? { confirmedBy: playerId } : {}),
        // Where the opponent validates, the confirmation makes the result count.
        ...(status === 'validated' ? { validatedAt: now } : {}),
      })
      .where(eq(match.id, found.id))
      .run();
    if (status === 'validated' && found.game) {
      tx.update(game).set({ status: 'final' }).where(eq(game.id, found.game.id)).run();
    }
    const disputeId = dispute
      ? tx
          .insert(disputeTable)
          .values({
            matchId: found.id,
            evidenceId: request.evidenceId,
            reason: dispute.reason,
            details: dispute.details,
            raisedBy: playerId,
            at: now,
          })
          .returning({ id: disputeTable.id })
          .get().id
      : null;
    tx.insert(auditLog)
      .values({
        actorPlayerId: playerId,
        actorKind: 'user',
        action: `match.${request.action}`,
        entity: 'match',
        entityId: String(found.id),
        beforeJson: { status: found.status },
        // The details stay in the dispute row, shown to staff only, not in the general log.
        afterJson: {
          status,
          evidenceId: request.evidenceId,
          ...(dispute ? { disputeId, reason: dispute.reason } : {}),
        },
        at: now,
      })
      .run();

    const report = latestScoreEvidence(tx, found.id);
    return {
      ok: true,
      match: found,
      status,
      dispute: dispute && disputeId !== null ? { ...dispute, id: disputeId } : null,
      post: publicPostOf(report),
      posts:
        status === 'validated'
          ? queuePostsOf(tx, { entity: 'match', entityId: found.id }, report?.at ?? 0)
          : [],
      queueChannelId: league.guild.alertsChannelId,
      resultsChannelId: resultsChannelFor(league, found),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Staff validate, reject or annul

export type StaffStepError =
  'not_linked' | 'not_staff' | 'match_not_found' | 'stale' | 'wrong_status' | 'reason_required';

/** A dispute the staff step settled, with its posts in the staff queue. */
export interface SettledDispute extends DisputeDetails {
  id: number;
  /** The Discord user who raised it, as its post names them. */
  raisedBy: string | null;
  posts: PostRef[];
}

export type StaffStepReply =
  | {
      ok: true;
      match: LeagueMatch;
      status: 'validated' | 'scheduled' | 'void';
      resultsChannelId: string | null;
      /**
       * The staff queue posts about the current report, to mark as handled wherever staff
       * decided: in Discord or on the website. Posts about older reports were marked already.
       */
      posts: PostRef[];
      /** The report's public post, whose buttons for the other team no longer apply. */
      post: PostRef | null;
      disputes: SettledDispute[];
    }
  | { ok: false; error: StaffStepError };

const REASON_MAX_LENGTH = 500;

const SETTLED_BY = {
  validate: 'validated',
  reject: 'rejected',
  void: 'voided',
} as const satisfies Record<string, DisputeResolution>;

function staffStep(
  db: Db,
  actor: Actor,
  request: { matchId: number; evidenceId?: number; reason?: string },
  action: Extract<MatchAction, 'validate' | 'reject' | 'void'>,
  apply: (tx: Tx, found: LeagueMatch, staffPlayerId: number) => void,
  now: number,
): StaffStepReply {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const { league } = staff;

  return db.transaction((tx): StaffStepReply => {
    const found = leagueMatch(tx, league, request.matchId);
    if (!found) return { ok: false, error: 'match_not_found' };
    // From a button, the click must be on the current report, not on an older one.
    if (
      request.evidenceId !== undefined &&
      latestScoreEvidence(tx, found.id)?.id !== request.evidenceId
    ) {
      return { ok: false, error: 'stale' };
    }
    const step = nextMatchStatus({
      status: found.status,
      action,
      actor: 'staff',
      validation: league.competition.rulesetJson.result_validation,
    });
    if (!step.ok) return { ok: false, error: 'wrong_status' };
    // `validate`, `reject` and `void` lead to exactly these three statuses.
    const status = step.status as 'validated' | 'scheduled' | 'void';

    const staffPlayer = ensurePlayer(
      tx,
      { orgId: league.org.id, discordUserId: actor.user.id, displayName: actor.user.displayName },
      now,
    );
    const handled = handledPosts(tx, league, found.id);
    apply(tx, found, staffPlayer.id);
    settleDisputes(tx, found.id, SETTLED_BY[action], staffPlayer.id, now);
    tx.insert(auditLog)
      .values({
        actorPlayerId: staffPlayer.id,
        actorKind: 'user',
        action: `match.${action}`,
        entity: 'match',
        entityId: String(found.id),
        beforeJson: { status: found.status, ...scoreOf(found.game) },
        afterJson: { status, ...(request.reason ? { reason: request.reason } : {}) },
        at: now,
      })
      .run();
    return {
      ok: true,
      match: found,
      status,
      resultsChannelId: resultsChannelFor(league, found),
      ...handled,
    };
  });
}

/** The queue posts of the match's current report, and of the disputes still open about it. */
function handledPosts(
  tx: Tx,
  league: GuildLeague,
  matchId: number,
): { posts: PostRef[]; post: PostRef | null; disputes: SettledDispute[] } {
  const report = latestScoreEvidence(tx, matchId);
  const since = report?.at ?? 0;
  const reasons = league.competition.rulesetJson.dispute_reasons;
  const open = tx
    .select({ dispute: disputeTable, raisedBy: player.discordUserId })
    .from(disputeTable)
    .innerJoin(player, eq(disputeTable.raisedBy, player.id))
    .where(and(eq(disputeTable.matchId, matchId), isNull(disputeTable.resolution)))
    .all();
  return {
    posts: queuePostsOf(tx, { entity: 'match', entityId: matchId }, since),
    post: publicPostOf(report),
    disputes: open.map(({ dispute: row, raisedBy }) => ({
      id: row.id,
      reason: row.reason,
      label: reasons.find((reason) => reason.key === row.reason)?.label ?? null,
      details: row.details,
      raisedBy,
      posts: queuePostsOf(tx, { entity: 'dispute', entityId: row.id }),
    })),
  };
}

const setGameStatus = (tx: Tx, found: LeagueMatch, status: 'final' | 'void') => {
  if (found.game) tx.update(game).set({ status }).where(eq(game.id, found.game.id)).run();
};

/** Staff accept a reported result: from now on it counts in the standings. */
export function validateResult(
  db: Db,
  actor: Actor,
  request: { matchId: number; evidenceId?: number },
  now: number,
): StaffStepReply {
  return staffStep(
    db,
    actor,
    request,
    'validate',
    (tx, found, staffPlayerId) => {
      setGameStatus(tx, found, 'final');
      tx.update(match)
        .set({ status: 'validated', validatedBy: staffPlayerId, validatedAt: now })
        .where(eq(match.id, found.id))
        .run();
    },
    now,
  );
}

/** Staff refuse a reported result: the match is to be reported again. The audit log keeps it. */
export function rejectResult(
  db: Db,
  actor: Actor,
  request: { matchId: number; evidenceId?: number },
  now: number,
): StaffStepReply {
  return staffStep(
    db,
    actor,
    request,
    'reject',
    (tx, found) => {
      setGameStatus(tx, found, 'void');
      tx.update(match)
        .set({ status: 'scheduled', reportedBy: null, confirmedBy: null })
        .where(eq(match.id, found.id))
        .run();
    },
    now,
  );
}

/** Staff annul a match, with a reason. Nothing is deleted: the match keeps its rows. */
export function voidMatch(
  db: Db,
  actor: Actor,
  request: { matchId: number; reason: string },
  now: number,
): StaffStepReply {
  const reason = request.reason.trim().slice(0, REASON_MAX_LENGTH);
  if (reason === '') {
    const staff = requireStaff(db, actor);
    return staff.ok ? { ok: false, error: 'reason_required' } : staff;
  }
  return staffStep(
    db,
    actor,
    { matchId: request.matchId, reason },
    'void',
    (tx, found) => {
      setGameStatus(tx, found, 'void');
      tx.update(match).set({ status: 'void' }).where(eq(match.id, found.id)).run();
    },
    now,
  );
}
