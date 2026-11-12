import { en } from './en.ts';
import { fr, type MessageKey } from './fr.ts';

export type { MessageKey };
export type Locale = 'fr' | 'en';

/** French first: used until a reply can follow the org's `locale`. */
export const DEFAULT_LOCALE: Locale = 'fr';

export const catalogs: Record<Locale, Record<MessageKey, string>> = { fr, en };

/**
 * Returns the message for `key`, with each `{name}` placeholder replaced from `params`.
 * A missing parameter is a programmer error and throws.
 */
export function t(
  locale: Locale,
  key: MessageKey,
  params: Record<string, string | number> = {},
): string {
  return catalogs[locale][key].replace(/\{(\w+)\}/g, (_placeholder, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Message "${key}" needs the parameter "${name}"`);
    return String(value);
  });
}
