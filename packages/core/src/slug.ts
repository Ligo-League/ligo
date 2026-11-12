export type SlugResult = { ok: true; slug: string } | { ok: false; error: 'empty' };

// Letters that Unicode decomposition leaves whole but that have a usual Latin spelling.
const LATIN_SPELLING: Record<string, string> = { œ: 'oe', æ: 'ae', ß: 'ss', ø: 'o' };

/**
 * Turns a display name into a URL slug: lowercase ASCII words joined by single dashes.
 * A name with no Latin letter or digit has no slug; the caller must ask for one.
 */
export function slugify(input: string): SlugResult {
  const slug = input
    .normalize('NFKD')
    .toLowerCase()
    // Lowercasing can itself produce combining marks (İ), so strip them only now.
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[œæßø]/g, (letter) => LATIN_SPELLING[letter] ?? '')
    // "Origin's" reads better as "origins" than as "origin-s".
    .replace(/['’ʼ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug === '' ? { ok: false, error: 'empty' } : { ok: true, slug };
}
