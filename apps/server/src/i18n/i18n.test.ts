import { describe, expect, it } from 'vitest';
import { catalogs, t } from './index.ts';

const placeholders = (message: string) =>
  [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('message catalogs', () => {
  it('define the same keys in French and English', () => {
    expect(Object.keys(catalogs.en).sort()).toEqual(Object.keys(catalogs.fr).sort());
  });

  it.each(Object.keys(catalogs.fr) as (keyof typeof catalogs.fr)[])(
    '"%s" uses the same parameters in both languages and is not empty',
    (key) => {
      expect(catalogs.fr[key]).not.toBe('');
      expect(catalogs.en[key]).not.toBe('');
      expect(placeholders(catalogs.en[key])).toEqual(placeholders(catalogs.fr[key]));
    },
  );
});

describe('t', () => {
  it('fills parameters in the requested language', () => {
    expect(t('fr', 'ping.reply', { gatewayMs: 42 })).toBe(
      'Pong ! Latence de la passerelle : 42 ms.',
    );
    expect(t('en', 'ping.reply', { gatewayMs: 42 })).toBe('Pong! Gateway latency: 42 ms.');
  });

  it('throws when a parameter is missing, instead of showing a raw placeholder', () => {
    expect(() => t('fr', 'ping.reply')).toThrow(/gatewayMs/);
  });
});
