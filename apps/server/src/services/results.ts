import { listLeagueMatches, schema, type Db, type LeagueMatch } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { requireStaff, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';

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
  screenshot?: Screenshot | null;
}

export type RecordResultError =
  | 'not_linked'
  | 'not_staff'
  | 'match_not_found'
  | 'match_closed'
  | 'unsupported_series'
  | 'invalid_score'
  | 'invalid_screenshot';

export type RecordResultReply =
  | {
      ok: true;
      match: LeagueMatch;
      scoreA: number;
      scoreB: number;
      /** The result this one replaced, when the match already had one. */
      previous: { scoreA: number; scoreB: number } | null;
    }
  | { ok: false; error: RecordResultError };

// Statuses a direct staff result may overwrite. A forfeit or an annulled match is changed by its
// own staff action, with its own consequences (forfeit counters, the 50% rule).
const OPEN_STATUSES: readonly LeagueMatch['status'][] = [
  'scheduled',
  'reported',
  'confirmed',
  'disputed',
  'validated',
];

// A screenshot attached to a slash command is hosted by Discord; anything else was not uploaded
// through the command and is refused.
const SCREENSHOT_HOSTS = ['cdn.discordapp.com', 'media.discordapp.net'];
const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const SCREENSHOT_MAX_BYTES = 20 * 1024 * 1024;

function isAcceptableScreenshot(screenshot: Screenshot): boolean {
  if (!URL.canParse(screenshot.url)) return false;
  const url = new URL(screenshot.url);
  return (
    url.protocol === 'https:' &&
    SCREENSHOT_HOSTS.includes(url.hostname) &&
    screenshot.contentType !== null &&
    SCREENSHOT_TYPES.includes(screenshot.contentType) &&
    screenshot.size > 0 &&
    screenshot.size <= SCREENSHOT_MAX_BYTES
  );
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
  const validScore = [scoreA, scoreB].every((score) => Number.isSafeInteger(score) && score >= 0);
  if (!validScore || scoreA === scoreB) return { ok: false, error: 'invalid_score' };
  if (request.screenshot && !isAcceptableScreenshot(request.screenshot)) {
    return { ok: false, error: 'invalid_screenshot' };
  }
  const screenshot = request.screenshot ?? null;

  return db.transaction((tx): RecordResultReply => {
    const [found] = listLeagueMatches(tx, { matchId: request.matchId });
    // A match of another league is reported as missing: staff of one league learn nothing
    // about another's.
    if (found?.competitionId !== league.competition.id) {
      return { ok: false, error: 'match_not_found' };
    }
    if (!OPEN_STATUSES.includes(found.status)) return { ok: false, error: 'match_closed' };
    if (found.bestOf !== 1) return { ok: false, error: 'unsupported_series' };

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

    const evidenceId = screenshot
      ? tx
          .insert(evidence)
          .values({
            matchId: found.id,
            gameId,
            kind: 'score_screenshot',
            url: screenshot.url,
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

    return { ok: true, match: found, scoreA, scoreB, previous };
  });
}

const pickScore = (stored: { scoreA: number; scoreB: number }) => ({
  scoreA: stored.scoreA,
  scoreB: stored.scoreB,
});

/**
 * The current season's matches a staff member can pick for a result, narrowed by what they have
 * typed so far (a team, a division prefix, "s3" for a week). Matches still to play come first.
 */
export function searchMatches(
  db: Pick<Db, 'select'>,
  actor: Pick<Actor, 'guildId' | 'memberRoleIds'>,
  query: string,
  limit: number,
): LeagueMatch[] {
  const staff = requireStaff(db, actor);
  if (!staff.ok || !staff.league.season) return [];

  // Each typed word must start one of the match's words, so "1" finds Ligue 1 but not week "s1".
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const searchable = (candidate: LeagueMatch) =>
    [
      candidate.division?.name ?? '',
      candidate.division?.categoryPrefix ?? '',
      candidate.week === null ? '' : `s${candidate.week}`,
      candidate.a.name,
      candidate.a.tag,
      candidate.b.name,
      candidate.b.tag,
    ]
      .join(' ')
      .toLowerCase()
      .split(/\s+/);
  const matches = (candidate: LeagueMatch) => {
    const tokens = searchable(candidate);
    return words.every((word) => tokens.some((token) => token.startsWith(word)));
  };
  const toPlay = (candidate: LeagueMatch) => (candidate.status === 'validated' ? 1 : 0);

  return listLeagueMatches(db, { seasonId: staff.league.season.id })
    .filter((candidate) => OPEN_STATUSES.includes(candidate.status) && candidate.bestOf === 1)
    .filter(matches)
    .sort((x, y) => toPlay(x) - toPlay(y))
    .slice(0, limit);
}
