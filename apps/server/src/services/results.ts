import { isPossibleGameScore, type GameScoreSettings } from '@ligo/core';
import { listLeagueMatches, schema, type Db, type GuildLeague, type LeagueMatch } from '@ligo/db';
import type { EvidenceStore } from '../assets/evidence-store.ts';
import { eq } from 'drizzle-orm';
import { isDiscordAttachmentUrl } from './attachments.ts';
import { requireStaff, type Actor } from './permissions.ts';
import { resultsChannelFor } from './league-channels.ts';
import { ensurePlayer } from './players.ts';
import { settleDisputes } from './disputes.ts';
import { evidenceKeyOf, imageTypeOf } from './evidence.ts';
import { openReportPosts, type OpenReportPosts } from './open-report.ts';

const { auditLog, evidence, game, match } = schema;

export interface Screenshot {
  url: string;
  contentType: string | null;
  size: number;
}

export interface RecordResultRequest {
  matchId: number;
  /** Rounds won by side A and side B of the match. */
  scoreA: number;
  scoreB: number;
  /** The screenshot, already kept by the evidence store (`enterResult`); optional for staff. */
  screenshot?: { objectKey: string } | null;
}

export type RecordResultError =
  | 'not_linked'
  | 'not_staff'
  | 'match_not_found'
  | 'match_closed'
  | 'unsupported_series'
  | 'invalid_score'
  | 'invalid_screenshot'
  | 'screenshot_unstored';

export type RecordResultReply =
  | ({
      ok: true;
      match: LeagueMatch;
      scoreA: number;
      scoreB: number;
      /** The result this one replaced, when the match already had one. */
      previous: { scoreA: number; scoreB: number } | null;
      /** Where results are announced, when the league has set it. */
      resultsChannelId: string | null;
      /** The screenshot's evidence row, for the server to keep its copy once downloaded. */
      evidenceId: number | null;
      // A report still open is superseded: its posts and disputes close (`OpenReportPosts`).
    } & OpenReportPosts)
  | { ok: false; error: RecordResultError }
  // The rule is returned so that the refusal can say which scores are possible.
  | { ok: false; error: 'impossible_score'; rule: GameScoreSettings };

// Statuses a direct staff result may overwrite. A forfeit or an annulled match is changed by its
// own staff action, with its own consequences (forfeit counters, the 50% rule).
export const OPEN_STATUSES: readonly LeagueMatch['status'][] = [
  'scheduled',
  'reported',
  'confirmed',
  'disputed',
  'validated',
];

const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const SCREENSHOT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * A screenshot attached to a slash command is hosted by Discord; anything else was not uploaded
 * through the command and is refused.
 */
export function isAcceptableScreenshot(screenshot: Screenshot): boolean {
  return (
    isDiscordAttachmentUrl(screenshot.url) &&
    screenshot.contentType !== null &&
    SCREENSHOT_TYPES.includes(screenshot.contentType) &&
    screenshot.size > 0 &&
    screenshot.size <= SCREENSHOT_MAX_BYTES
  );
}

type Refusal = Extract<RecordResultReply, { ok: false }>;

/** A score the league's rules allow, or why not. */
function checkScore(league: GuildLeague, scoreA: number, scoreB: number): Refusal | null {
  const validScore = [scoreA, scoreB].every((score) => Number.isSafeInteger(score) && score >= 0);
  if (!validScore || scoreA === scoreB) return { ok: false, error: 'invalid_score' };
  // The league's own rule for how a game is won; without one, any score with a winner passes.
  const rule = league.competition.rulesetJson.game_score;
  if (rule && !isPossibleGameScore(rule, scoreA, scoreB)) {
    return { ok: false, error: 'impossible_score', rule };
  }
  return null;
}

/** The league's best-of-1 match whose result staff may enter, or why not. */
function openMatch(
  db: Pick<Db, 'select'>,
  league: GuildLeague,
  matchId: number,
): { ok: true; found: LeagueMatch } | Refusal {
  const [found] = listLeagueMatches(db, { matchId });
  // A match of another league is reported as missing: staff of one league learn nothing
  // about another's.
  if (found?.competitionId !== league.competition.id) {
    return { ok: false, error: 'match_not_found' };
  }
  if (!OPEN_STATUSES.includes(found.status)) return { ok: false, error: 'match_closed' };
  if (found.bestOf !== 1) return { ok: false, error: 'unsupported_series' };
  return { ok: true, found };
}

/**
 * Staff enter a result with the screenshot uploaded on the website (phase 3f): everything is
 * checked first, so a refusal stores no file; the file is then kept by the evidence store, and the
 * result recorded with it. Without a screenshot, as `recordResult`.
 */
export async function enterResult(
  db: Db,
  store: EvidenceStore,
  actor: Actor,
  request: Omit<RecordResultRequest, 'screenshot'> & { screenshot: Uint8Array | null },
  now: number,
): Promise<RecordResultReply> {
  const { screenshot, ...entry } = request;
  if (!screenshot) return recordResult(db, actor, entry, now);
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const refusal =
    checkScore(staff.league, entry.scoreA, entry.scoreB) ??
    (() => {
      const opened = openMatch(db, staff.league, entry.matchId);
      return opened.ok ? null : opened;
    })();
  if (refusal) return refusal;
  const type = screenshot.byteLength <= SCREENSHOT_MAX_BYTES ? imageTypeOf(screenshot) : null;
  if (!type) return { ok: false, error: 'invalid_screenshot' };
  const objectKey = evidenceKeyOf(entry.matchId, screenshot, type);
  try {
    await store.put(objectKey, screenshot);
  } catch {
    // Without the server's copy the screenshot would be lost: nothing is recorded.
    return { ok: false, error: 'screenshot_unstored' };
  }
  return recordResult(db, actor, { ...entry, screenshot: { objectKey } }, now);
}

/**
 * Staff enter, or correct, the result of a best-of-1 match. The match counts in standings at
 * once: a staff entry is the validation. The change and its audit entry are one transaction.
 */
export function recordResult(
  db: Db,
  actor: Actor,
  request: RecordResultRequest,
  now: number,
): RecordResultReply {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const { league } = staff;
  const { scoreA, scoreB } = request;
  const scoreRefusal = checkScore(league, scoreA, scoreB);
  if (scoreRefusal) return scoreRefusal;
  const screenshot = request.screenshot ?? null;

  return db.transaction((tx): RecordResultReply => {
    const opened = openMatch(tx, league, request.matchId);
    if (!opened.ok) return opened;
    const { found } = opened;

    const staffPlayer = ensurePlayer(
      tx,
      { orgId: league.org.id, discordUserId: actor.user.id, displayName: actor.user.displayName },
      now,
    );

    let gameId = found.game?.id;
    if (gameId === undefined) {
      gameId = tx
        .insert(game)
        .values({ matchId: found.id, n: 1, bansJson: [], scoreA, scoreB, status: 'final' })
        .returning({ id: game.id })
        .get().id;
    } else {
      tx.update(game)
        .set({ scoreA, scoreB, forfeitSide: null, status: 'final' })
        .where(eq(game.id, gameId))
        .run();
    }
    tx.update(match)
      .set({ status: 'validated', validatedBy: staffPlayer.id, validatedAt: now })
      .where(eq(match.id, found.id))
      .run();
    // Read before the disputes are settled, which would leave none open to name.
    const open = openReportPosts(tx, league, found.id);
    settleDisputes(tx, found.id, 'result_entered', staffPlayer.id, now);

    const evidenceId = screenshot
      ? tx
          .insert(evidence)
          .values({
            matchId: found.id,
            gameId,
            kind: 'score_screenshot',
            objectKey: screenshot.objectKey,
            uploadedBy: staffPlayer.id,
            at: now,
          })
          .returning({ id: evidence.id })
          .get().id
      : null;

    const hadResult = found.status === 'validated' && found.game !== null;
    const previous = hadResult && found.game ? pickScore(found.game) : null;
    tx.insert(auditLog)
      .values({
        actorPlayerId: staffPlayer.id,
        actorKind: 'user',
        action: 'match.result',
        entity: 'match',
        entityId: String(found.id),
        beforeJson: { status: found.status, ...(found.game ? pickScore(found.game) : {}) },
        // The evidence row is named by ID: its address is a signed link and stays out of logs.
        afterJson: { status: 'validated', scoreA, scoreB, evidenceId },
        at: now,
      })
      .run();

    return {
      ok: true,
      match: found,
      scoreA,
      scoreB,
      previous,
      resultsChannelId: resultsChannelFor(league, found),
      evidenceId,
      ...open,
    };
  });
}

const pickScore = (stored: { scoreA: number; scoreB: number }) => ({
  scoreA: stored.scoreA,
  scoreB: stored.scoreB,
});
