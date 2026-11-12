import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { slugify } from './slug.ts';

describe('slugify', () => {
  it.each([
    ['RCK Esport', 'rck-esport'],
    ["Origin's Esport", 'origins-esport'],
    ['Origin’s Esport', 'origins-esport'],
    ['  Vaevictis  ', 'vaevictis'],
    ['Évry Gaming Élite', 'evry-gaming-elite'],
    ['Cœur de Lion', 'coeur-de-lion'],
    ['Team -- 2.0 !', 'team-2-0'],
    ['Ligue 1', 'ligue-1'],
    ['ALREADY-A-SLUG', 'already-a-slug'],
  ])('%j becomes %j', (input, slug) => {
    expect(slugify(input)).toEqual({ ok: true, slug });
  });

  it.each(['', '   ', '!!!', "'", '日本'])('reports %j as having no usable characters', (input) => {
    expect(slugify(input)).toEqual({ ok: false, error: 'empty' });
  });

  it('only ever produces lowercase words joined by single dashes', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (input) => {
        const result = slugify(input);
        if (result.ok) expect(result.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      }),
    );
  });

  it('leaves a slug unchanged', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (input) => {
        const first = slugify(input);
        if (first.ok) expect(slugify(first.slug)).toEqual(first);
      }),
    );
  });
});
