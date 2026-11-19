import type { Title } from './titles.ts';
import { R6_STATS } from './r6/stats.ts';

// A title's stats (design doc section 9): the metrics stored for each player and game, which of
// them the manual stat grid asks for, the checks a manual sheet must pass (M-39), and the
// derived metrics, computed from totals: sum first, divide last. No I/O here.

/** What a game gives the checks: its rounds, from its score. */
export interface GameCtx {
  rounds: number;
}

/** One player's values for one game; null where nothing was entered. */
export type StatValues = Readonly<Record<string, number | null>>;

export interface Metric {
  key: string;
  label: { fr: string; en: string };
  /** Asked for in the stat grid. */
  manual: boolean;
  /** In the grid, may stay empty for a player who played. */
  optional?: boolean;
  /** Only from replays with round detail (R6 KOST, entries, trades, clutches). */
  requiresRounds?: boolean;
  min?: number;
  /** The most a player can have, from the game and the player's other values; null when unknown. */
  max?: (ctx: GameCtx, values: StatValues) => number | null;
  /** The most a whole side can have together, from the game. */
  sideMax?: (ctx: GameCtx) => number;
}

export interface Derived {
  key: string;
  label: { fr: string; en: string };
  needs: readonly string[];
  /** From totals; null when it cannot be computed (a zero denominator). */
  compute: (totals: Readonly<Record<string, number>>) => number | null;
  format: 'ratio' | 'percent' | 'signed';
}

export interface TitleStats {
  metrics: readonly Metric[];
  derived: readonly Derived[];
  /** The metrics one side's kills and the other side's deaths are read from, if the title has them. */
  crossCheck: { kills: string; deaths: string } | null;
}

/** The stats of a title, or null for one with no metric schema yet. */
export function statsOf(title: Title): TitleStats | null {
  return title === 'r6' ? R6_STATS : null;
}

/** The metrics the stat grid asks for, in order. */
export function manualMetrics(stats: TitleStats): Metric[] {
  return stats.metrics.filter((metric) => metric.manual);
}

/** Whether a row has any value: an empty row is a player who did not play the game. */
export function played(stats: TitleStats, values: StatValues): boolean {
  return manualMetrics(stats).some((metric) => (values[metric.key] ?? null) !== null);
}

export type CellError =
  | { metric: string; error: 'required' | 'not_integer' }
  | { metric: string; error: 'below_min' | 'above_max'; limit: number };

/** Every problem of one player's row, in the grid's order; none for an empty row. */
export function checkStatRow(stats: TitleStats, ctx: GameCtx, values: StatValues): CellError[] {
  if (!played(stats, values)) return [];
  const errors: CellError[] = [];
  for (const metric of manualMetrics(stats)) {
    const value = values[metric.key] ?? null;
    if (value === null) {
      if (!metric.optional) errors.push({ metric: metric.key, error: 'required' });
      continue;
    }
    if (!Number.isSafeInteger(value)) {
      errors.push({ metric: metric.key, error: 'not_integer' });
      continue;
    }
    const min = metric.min ?? 0;
    if (value < min) {
      errors.push({ metric: metric.key, error: 'below_min', limit: min });
      continue;
    }
    const max = metric.max?.(ctx, values) ?? null;
    if (max !== null && value > max) {
      errors.push({ metric: metric.key, error: 'above_max', limit: max });
    }
  }
  return errors;
}

export interface SideError {
  metric: string;
  error: 'side_above_max';
  total: number;
  limit: number;
}

/** One side's sheet: each row's problems, then what the side cannot have together. */
export function checkSide(
  stats: TitleStats,
  ctx: GameCtx,
  rows: readonly StatValues[],
): { rows: CellError[][]; side: SideError[] } {
  const side: SideError[] = [];
  for (const metric of manualMetrics(stats)) {
    if (!metric.sideMax) continue;
    const total = rows.reduce((sum, values) => sum + (values[metric.key] ?? 0), 0);
    const limit = metric.sideMax(ctx);
    if (total > limit) side.push({ metric: metric.key, error: 'side_above_max', total, limit });
  }
  return { rows: rows.map((values) => checkStatRow(stats, ctx, values)), side };
}

/** A side whose kills and the other side's deaths differ beyond the tolerance. */
export interface CrossWarning {
  side: 'a' | 'b';
  kills: number;
  deaths: number;
}

const total = (rows: readonly StatValues[], key: string) =>
  rows.reduce((sum, values) => sum + (values[key] ?? 0), 0);

/**
 * Warnings, never refusals (M-39): a death is not always a kill (a fall, an explosion), and the
 * other side may not be entered yet, in which case there is nothing to compare.
 */
export function crossCheck(
  stats: TitleStats,
  a: readonly StatValues[],
  b: readonly StatValues[],
  tolerance: number,
): CrossWarning[] {
  const keys = stats.crossCheck;
  const entered = (rows: readonly StatValues[]) => rows.some((values) => played(stats, values));
  if (!keys || !entered(a) || !entered(b)) return [];
  const warnings: CrossWarning[] = [];
  for (const [side, own, other] of [
    ['a', a, b],
    ['b', b, a],
  ] as const) {
    const kills = total(own, keys.kills);
    const deaths = total(other, keys.deaths);
    if (Math.abs(kills - deaths) > tolerance) warnings.push({ side, kills, deaths });
  }
  return warnings;
}

/** Every derived metric from totals; null where it cannot be computed. */
export function computeDerived(
  stats: TitleStats,
  totals: Readonly<Record<string, number>>,
): Record<string, number | null> {
  return Object.fromEntries(
    stats.derived.map((derived) => [
      derived.key,
      derived.needs.every((key) => totals[key] !== undefined) ? derived.compute(totals) : null,
    ]),
  );
}
