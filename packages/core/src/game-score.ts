import type { GameScoreSettings } from './settings.ts';

// Whether a game (one map) can end on a given score, from the league's `game_score` setting.
// One rule covers the round-based shooters: regulation is won at `win_at`; when both teams are one
// round short of it, overtime is played in periods of `overtime_rounds`, each won by taking more
// than half of its rounds, and an even period that ends level is followed by another.
//   R6        win_at 7,  overtime 3: 7-0 to 7-5, then 8-6 or 8-7
//   Valorant  win_at 13, overtime 2: 13-0 to 13-11, then 14-12, 15-13, ... (win by two)
//   CS2       win_at 13, overtime 6: 13-0 to 13-11, then 16-12 to 16-14, 19-15, ...

type Score = [winner: number, loser: number];

interface OvertimeShape {
  /** The score both teams hold when overtime starts. */
  level: number;
  /** Rounds that win a period. */
  need: number;
  /** The most rounds the loser of a period can take in it. */
  loserMax: number;
  /** Rounds each team adds when a period ends level; null when a period cannot end level. */
  levelStep: number | null;
}

function overtimeShape(rule: GameScoreSettings): OvertimeShape {
  const period = rule.overtime_rounds;
  const need = Math.floor(period / 2) + 1;
  return {
    level: rule.win_at - 1,
    need,
    loserMax: period - need,
    levelStep: period % 2 === 0 ? period / 2 : null,
  };
}

/**
 * True when a game can end `scoreA`-`scoreB` under the rule. With no rule (`null`), any two
 * different whole scores are possible. A draw is never possible.
 */
export function isPossibleGameScore(
  rule: GameScoreSettings | null,
  scoreA: number,
  scoreB: number,
): boolean {
  const whole = [scoreA, scoreB].every((score) => Number.isSafeInteger(score) && score >= 0);
  if (!whole || scoreA === scoreB) return false;
  if (rule === null) return true;

  const winner = Math.max(scoreA, scoreB);
  const loser = Math.min(scoreA, scoreB);
  const { level, need, loserMax, levelStep } = overtimeShape(rule);

  // Regulation: the loser one round short would mean both teams were level, hence overtime.
  if (winner === rule.win_at && loser < level) return true;

  // Overtime: `levelled` rounds each from periods that ended level, then the deciding period.
  const levelled = winner - level - need;
  if (levelled < 0) return false;
  if (levelled > 0 && (levelStep === null || levelled % levelStep !== 0)) return false;
  const loserInLastPeriod = loser - level - levelled;
  return loserInLastPeriod >= 0 && loserInLastPeriod <= loserMax;
}

export interface GameScoreDescription {
  /** The widest and the closest win in regulation, e.g. 7-0 and 7-5. */
  regulation: { from: Score; to: Score };
  /**
   * Overtime scores: all of them when overtime is one period; otherwise those of the first period
   * and the first of the second, to show how they continue.
   */
  overtime: Score[];
  /** True when overtime can go on, so `overtime` is only its beginning. */
  endless: boolean;
}

/** The scores a game can end on, for telling someone why theirs was refused. */
export function describeGameScores(rule: GameScoreSettings): GameScoreDescription {
  const { level, need, loserMax, levelStep } = overtimeShape(rule);
  const period = (start: number): Score[] =>
    Array.from({ length: loserMax + 1 }, (_, lost): Score => [start + need, start + lost]);
  const overtime = period(level);
  if (levelStep !== null) overtime.push([level + levelStep + need, level + levelStep]);

  return {
    regulation: { from: [rule.win_at, 0], to: [rule.win_at, rule.win_at - 2] },
    overtime,
    endless: levelStep !== null,
  };
}
