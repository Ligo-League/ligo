// A fixed-window counter kept in memory: the server is one process, and a restart forgetting the
// counts only gives a few more requests. Used by the replay API (design doc section 13: upload
// signing is rate-limited per user and per match).

export interface RateLimit {
  /** What one key may use in one window. */
  limit: number;
  windowMs: number;
}

export interface RateCharge {
  key: string;
  count: number;
  rule: RateLimit;
}

export interface RateLimiter {
  /**
   * Uses `count` of each key's allowance, all or nothing: refused when one key has too little
   * left. Returns 0 when allowed, else the milliseconds until enough is free again.
   */
  take(charges: readonly RateCharge[], now: number): number;
}

/** Keys kept before those of windows already over are dropped. */
const PRUNE_AT = 10_000;

export function createRateLimiter(): RateLimiter {
  const used = new Map<string, { endsAt: number; count: number }>();
  const spentOf = (key: string, now: number) => {
    const entry = used.get(key);
    return entry && entry.endsAt > now ? entry : null;
  };
  return {
    take(charges, now) {
      if (used.size > PRUNE_AT) {
        for (const [key, entry] of used) if (entry.endsAt <= now) used.delete(key);
      }
      let wait = 0;
      for (const { key, count, rule } of charges) {
        const entry = spentOf(key, now);
        if ((entry?.count ?? 0) + count > rule.limit) {
          // A charge above the whole allowance never passes: waiting a window is the honest answer.
          wait = Math.max(wait, entry ? entry.endsAt - now : rule.windowMs);
        }
      }
      if (wait > 0) return wait;
      for (const { key, count, rule } of charges) {
        const entry = spentOf(key, now);
        used.set(key, {
          endsAt: entry?.endsAt ?? now + rule.windowMs,
          count: (entry?.count ?? 0) + count,
        });
      }
      return 0;
    },
  };
}
