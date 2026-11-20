// The round robin by the circle method (design doc section 5, "Scheduling"; M-45).

export interface RoundRobinMatch<T> {
  /** Only an order: sides, host and bans come from the ranks at match time (section 5). */
  a: T;
  b: T;
}

export interface RoundRobinRound<T> {
  /** From 1; the second leg follows the first (rounds n to 2n − 2 for n teams). */
  round: number;
  matches: RoundRobinMatch<T>[];
  /** The team without a match this round, with an odd count; null otherwise. */
  rest: T | null;
}

export type RoundRobinResult<T> =
  | { ok: true; rounds: RoundRobinRound<T>[] }
  | { ok: false; error: 'too_few_entries' | 'duplicate_entries' };

export interface RoundRobinOptions {
  /** The stored shuffle seed (`stage.config_json.seed`): the same seed gives the same schedule. */
  seed: number;
  /** 1: each pair meets once; 2: twice, the second leg with the sides swapped. */
  legs: 1 | 2;
}

/** mulberry32: a small seeded generator, enough to shuffle a draw the same way every time. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffled<T>(entries: readonly T[], seed: number): T[] {
  const random = seededRandom(seed);
  const order = [...entries];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j] as T, order[i] as T];
  }
  return order;
}

/**
 * Every entry meets every other once per leg. The draw is shuffled with the seed, then position
 * 0 stays fixed while the others turn one place each round, and position i plays position
 * n − 1 − i. The upper half is side A, so a team that turns through every position is side A
 * half the time, give or take one; the fixed team alternates. With an odd count, a rest sits in
 * the fixed position, so its partner of the round rests and the sides balance exactly.
 */
export function roundRobin<T>(
  entries: readonly T[],
  options: RoundRobinOptions,
): RoundRobinResult<T> {
  if (entries.length < 2) return { ok: false, error: 'too_few_entries' };
  if (new Set(entries).size !== entries.length) return { ok: false, error: 'duplicate_entries' };

  const draw = shuffled(entries, options.seed);
  // `null` is the rest: it takes the fixed position, so it never moves.
  const positions: (T | null)[] = entries.length % 2 === 1 ? [null, ...draw] : draw;
  const n = positions.length;
  const first: RoundRobinRound<T>[] = [];

  for (let r = 0; r < n - 1; r += 1) {
    const matches: RoundRobinMatch<T>[] = [];
    let rest: T | null = null;
    for (let i = 0; i < n / 2; i += 1) {
      const top = positions[i] ?? null;
      const bottom = positions[n - 1 - i] ?? null;
      if (top === null || bottom === null) {
        rest = top ?? bottom;
        continue;
      }
      // The fixed team alternates; every other pair keeps the upper half as side A.
      matches.push(i === 0 && r % 2 === 1 ? { a: bottom, b: top } : { a: top, b: bottom });
    }
    first.push({ round: r + 1, matches, rest });
    // Turn every position but the first one place: the last comes to position 1.
    const last = positions.pop() ?? null;
    positions.splice(1, 0, last);
  }

  if (options.legs === 1) return { ok: true, rounds: first };
  const second = first.map((round) => ({
    round: round.round + first.length,
    matches: round.matches.map(({ a, b }) => ({ a: b, b: a })),
    rest: round.rest,
  }));
  return { ok: true, rounds: [...first, ...second] };
}
