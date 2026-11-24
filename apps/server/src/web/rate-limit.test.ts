import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit.ts';

const rule = { limit: 5, windowMs: 1000 };

describe('createRateLimiter', () => {
  it('allows up to the limit in a window, then says how long to wait', () => {
    const limiter = createRateLimiter();
    expect(limiter.take([{ key: 'u', count: 3, rule }], 100)).toBe(0);
    expect(limiter.take([{ key: 'u', count: 2, rule }], 200)).toBe(0);
    expect(limiter.take([{ key: 'u', count: 1, rule }], 300)).toBe(800);
    expect(limiter.take([{ key: 'u', count: 5, rule }], 1100)).toBe(0);
  });

  it('charges every key or none', () => {
    const limiter = createRateLimiter();
    limiter.take([{ key: 'match', count: 4, rule }], 0);
    expect(
      limiter.take(
        [
          { key: 'user', count: 2, rule },
          { key: 'match', count: 2, rule },
        ],
        10,
      ),
    ).toBe(990);
    // The user's allowance was not spent by the refused request.
    expect(limiter.take([{ key: 'user', count: 5, rule }], 20)).toBe(0);
  });

  it('keeps keys apart', () => {
    const limiter = createRateLimiter();
    expect(limiter.take([{ key: 'a', count: 5, rule }], 0)).toBe(0);
    expect(limiter.take([{ key: 'b', count: 5, rule }], 0)).toBe(0);
  });
});
