import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CHANNEL_PLACEHOLDERS,
  categoryName,
  channelName,
  fillTemplate,
  numberedName,
  packIntoCategories,
  templateProblems,
} from './discord-names.ts';

// The names of the channels, categories and roles Ligo manages (design doc section 6; M-44).

describe('fillTemplate', () => {
  it('replaces each placeholder, every time it appears', () => {
    expect(fillTemplate('w{week}-{tagA}-{tagB}', { week: 3, tagA: 'GRD', tagB: 'RCK' })).toBe(
      'w3-GRD-RCK',
    );
    expect(fillTemplate('{division} · Semaine {week}', { division: 'L1', week: 10 })).toBe(
      'L1 · Semaine 10',
    );
    expect(fillTemplate('{tag}-{tag}', { tag: 'x' })).toBe('x-x');
  });

  it('leaves an unknown or missing placeholder as it is, for templateProblems to catch', () => {
    expect(fillTemplate('{tagA}-{team}', { tagA: 'A' })).toBe('A-{team}');
  });
});

describe('templateProblems', () => {
  it('accepts the defaults and a template without the week', () => {
    expect(templateProblems('w{week}-{tagA}-{tagB}', CHANNEL_PLACEHOLDERS)).toEqual([]);
    expect(templateProblems('{tagA}-{tagB}', CHANNEL_PLACEHOLDERS)).toEqual([]);
  });

  it('names each placeholder it does not know, once', () => {
    expect(templateProblems('{tagA}-{team}-{team}-{Week}', CHANNEL_PLACEHOLDERS)).toEqual([
      'team',
      'Week',
    ]);
  });
});

describe('channelName', () => {
  it('lowers the case, turns spaces into hyphens and drops what Discord refuses', () => {
    expect(channelName('w3-GRD-RCK')).toBe('w3-grd-rck');
    expect(channelName('W1 RCK vs. GREED2!')).toBe('w1-rck-vs-greed2');
    expect(channelName('moss-Évry_Élite')).toBe('moss-évry_élite');
  });

  it('collapses repeated hyphens and trims them from the ends', () => {
    expect(channelName('--a -- b--')).toBe('a-b');
  });

  it('keeps at most 100 characters, never splitting one', () => {
    expect(channelName(`w1-${'é'.repeat(120)}`)).toHaveLength(100);
    // An emoji takes two UTF-16 units: the 51st would pass 100, so it is left out whole.
    expect(channelName('😀'.repeat(60))).toBe('😀'.repeat(50));
  });

  it('falls back when nothing is left', () => {
    expect(channelName('!!! ???')).toBe('match');
  });

  it('always gives a name Discord accepts', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (raw) => {
        const name = channelName(raw);
        expect(name.length).toBeGreaterThanOrEqual(1);
        expect(name.length).toBeLessThanOrEqual(100);
        expect(name).toBe(name.toLowerCase());
        expect(name).not.toMatch(/\s|--|^-|-$/);
      }),
    );
  });
});

describe('categoryName', () => {
  it('keeps the case and the separators, squeezes spaces and keeps 100 characters', () => {
    expect(categoryName('  Organisation   Ligue 1 ')).toBe('Organisation Ligue 1');
    expect(categoryName('L1 · Semaine 3')).toBe('L1 · Semaine 3');
    expect(categoryName('x'.repeat(150))).toHaveLength(100);
    expect(categoryName('   ')).toBe('Ligo');
  });
});

describe('numberedName', () => {
  it('leaves the first as it is and numbers the next, within 100 characters', () => {
    expect(numberedName('Organisation Ligue 1', 1)).toBe('Organisation Ligue 1');
    expect(numberedName('Organisation Ligue 1', 2)).toBe('Organisation Ligue 1 (2)');
    const long = numberedName('y'.repeat(100), 12);
    expect(long).toHaveLength(100);
    expect(long.endsWith(' (12)')).toBe(true);
  });
});

describe('packIntoCategories', () => {
  it('fills each category up to the capacity, in order, then opens the next', () => {
    const items = Array.from({ length: 120 }, (_, i) => i);
    const packed = packIntoCategories(items, 50);
    expect(packed.map((category) => category.items.length)).toEqual([50, 50, 20]);
    expect(packed.map((category) => category.index)).toEqual([1, 2, 3]);
    expect(packed.flatMap((category) => category.items)).toEqual(items);
  });

  it('keeps an item in its category when items are added after it', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), fc.integer({ min: 0, max: 200 }), (n, more) => {
        const before = packIntoCategories(
          Array.from({ length: n }, (_, i) => i),
          50,
        );
        const after = packIntoCategories(
          Array.from({ length: n + more }, (_, i) => i),
          50,
        );
        for (const category of before)
          expect(after[category.index - 1]?.items.slice(0, category.items.length)).toEqual(
            category.items,
          );
      }),
    );
  });

  it('gives nothing for nothing', () => {
    expect(packIntoCategories([], 50)).toEqual([]);
  });
});
