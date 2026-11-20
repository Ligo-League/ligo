// The names of what Ligo creates in a league's Discord server (design doc section 6; M-44).
// Templates are stored in the competition's settings; Discord finds nothing by name, Ligo keeps
// every object's ID, so a name only has to be readable and accepted.

/** Discord's limit for channel, category and role names, in characters. */
export const DISCORD_NAME_MAX = 100;
/** Discord's limit of channels in one category. */
export const CATEGORY_CAPACITY = 50;

/** What a match channel's and a week category's templates may use. */
export const CHANNEL_PLACEHOLDERS = ['week', 'tagA', 'tagB', 'division'] as const;
/** What a team's role name may use. */
export const TEAM_PLACEHOLDERS = ['tag', 'name'] as const;
/** What a week category may use. */
export const CATEGORY_PLACEHOLDERS = ['week', 'division'] as const;
/** What an archive category may use. */
export const DIVISION_PLACEHOLDERS = ['division'] as const;

const PLACEHOLDER = /\{([^{}]*)\}/g;

/** Replaces `{name}` with its value; an unknown or missing one stays as it is. */
export function fillTemplate(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}

/** The placeholders a template uses that are not allowed, each once, in order. */
export function templateProblems(template: string, allowed: readonly string[]): string[] {
  const unknown = [...template.matchAll(PLACEHOLDER)]
    .map((match) => match[1] ?? '')
    .filter((name) => !allowed.includes(name));
  return [...new Set(unknown)];
}

/**
 * The start of a name, at most `max` UTF-16 units long, never splitting a character. Discord's
 * limit is counted in characters or in UTF-16 units depending on where it is checked: this
 * fits both.
 */
function cut(name: string, max = DISCORD_NAME_MAX): string {
  let kept = '';
  for (const character of name) {
    if (kept.length + character.length > max) break;
    kept += character;
  }
  return kept;
}

/**
 * A text channel name as Discord makes it: lower case, hyphens for spaces, no punctuation but
 * `-` and `_`. Letters of any alphabet and emoji stay.
 */
export function channelName(raw: string): string {
  const name = raw
    .toLowerCase()
    .replace(/[\s]+/gu, '-')
    .replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/gu, '')
    .replace(/-{2,}/gu, '-')
    .replace(/^-+|-+$/gu, '');
  const kept = cut(name).replace(/-+$/u, '');
  return kept === '' ? 'match' : kept;
}

/** A category or role name: any characters, spaces squeezed, at most 100 characters. */
export function categoryName(raw: string): string {
  const name = cut(raw.replace(/\s+/gu, ' ').trim()).trim();
  return name === '' ? 'Ligo' : name;
}

/** The `index`-th of several categories sharing a name: `Name`, then `Name (2)`, `Name (3)`… */
export function numberedName(base: string, index: number): string {
  if (index <= 1) return categoryName(base);
  const suffix = ` (${String(index)})`;
  return `${cut(categoryName(base), DISCORD_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
}

/**
 * Shares items out among categories of `capacity` each, in order. An item keeps its category
 * as long as items are only added after it (matches are listed by ID), so nothing moves when a
 * week is published.
 */
export function packIntoCategories<T>(
  items: readonly T[],
  capacity: number = CATEGORY_CAPACITY,
): { index: number; items: T[] }[] {
  const packed: { index: number; items: T[] }[] = [];
  for (let start = 0; start < items.length; start += capacity)
    packed.push({ index: packed.length + 1, items: items.slice(start, start + capacity) });
  return packed;
}
