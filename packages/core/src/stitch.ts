import { isPossibleGameScore } from './game-score.ts';
import type { ReplaySide, Segment } from './replay-groups.ts';
import type { GameScoreSettings } from './settings.ts';

// Stitching a game's lobbies into the official map (design doc section 8, "Stitching re-hosted
// games"). A restart keeps the score (rulebook 4.3), so the map is the lobbies' complete rounds
// joined in order: a round with no winner is void as `interrupted`, and the rounds after the map
// was decided as `after_end`. The checks say whether the plan applies by itself; any failure, or
// a score not yet reported, leaves it to staff. Facts stay keyed by (lobby, round): a new plan
// only changes which rounds count.

export type StitchSegment = Segment;

export interface StitchInput {
  segments: readonly StitchSegment[];
  rule: GameScoreSettings;
  /** Lobbies beyond the first that need no staff (O-14: one re-host per team and map). */
  maxRehosts: number;
  /** The score reported and confirmed for the game, or null while there is none. */
  reported: Score | null;
}

export interface Score {
  A: number;
  B: number;
}

export interface PlannedRound {
  lobbyId: string;
  number: number;
  fileId: number;
  winner: ReplaySide | null;
  /** Null when the round counts. */
  void_reason: 'interrupted' | 'after_end' | null;
  /** The map's score after this round. */
  score: Score;
}

export type StitchCheckCode = 'decided' | 'no_overlap' | 'sides' | 'rehosts' | 'reported_score';

/** `ok` is null when the check cannot run yet (no reported score). */
export interface StitchCheck {
  code: StitchCheckCode;
  ok: boolean | null;
}

export interface StitchPlan {
  /** The lobbies in play order, with what each added to the score. */
  lobbies: { lobbyId: string; score: Score }[];
  rounds: PlannedRound[];
  score: Score;
  checks: StitchCheck[];
  /** Every check passed: the plan applies without staff. */
  ok: boolean;
}

export function stitchGame(input: StitchInput): StitchPlan {
  const first = (segment: StitchSegment) => segment.rounds[0]?.startedAt ?? Infinity;
  const segments = [...input.segments]
    .filter((segment) => segment.rounds.length > 0)
    .sort((x, y) => first(x) - first(y));

  const score: Score = { A: 0, B: 0 };
  let decided = false;
  const rounds: PlannedRound[] = [];
  const lobbies = segments.map((segment) => {
    const added: Score = { A: 0, B: 0 };
    for (const round of segment.rounds) {
      const reason = round.winner === null ? 'interrupted' : decided ? 'after_end' : null;
      if (reason === null && round.winner !== null) {
        score[round.winner] += 1;
        added[round.winner] += 1;
        decided = isPossibleGameScore(input.rule, score.A, score.B);
      }
      rounds.push({
        lobbyId: segment.lobbyId,
        number: round.number,
        fileId: round.fileId,
        winner: round.winner,
        void_reason: reason,
        score: { ...score },
      });
    }
    return { lobbyId: segment.lobbyId, score: added };
  });

  const checks: StitchCheck[] = [
    { code: 'decided', ok: decided },
    { code: 'no_overlap', ok: noOverlap(segments) },
    { code: 'sides', ok: sidesFit(segments, input.rule) },
    { code: 'rehosts', ok: segments.length - 1 <= input.maxRehosts },
    {
      code: 'reported_score',
      ok:
        input.reported === null
          ? null
          : input.reported.A === score.A && input.reported.B === score.B,
    },
  ];
  return { lobbies, rounds, score, checks, ok: checks.every((c) => c.ok === true) };
}

/** Each lobby starts after the previous one's last round. */
function noOverlap(segments: StitchSegment[]): boolean {
  return segments.every((segment, i) => {
    const previous = segments[i - 1]?.rounds.at(-1)?.startedAt;
    const start = segment.rounds[0]?.startedAt;
    return previous === undefined || start === undefined || previous < start;
  });
}

/**
 * In regulation a team attacks one half and defends the other, the halves being `win_at - 1`
 * rounds (6 in R6). Overtime is not checked: who attacks its first round depends on the league's
 * side choice, and a re-host in overtime may restart it differently.
 */
function sidesFit(segments: StitchSegment[], rule: GameScoreSettings): boolean {
  const half = rule.win_at - 1;
  const counted = segments
    .flatMap((segment) => segment.rounds)
    .filter((round) => round.winner !== null)
    .slice(0, 2 * half);
  const opener = counted[0]?.attacker;
  return counted.every((round, i) => i < half === (round.attacker === opener));
}
