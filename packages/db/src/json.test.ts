import { describe, expect, it } from 'vitest';
import { themeSchema } from './json.ts';

describe('themeSchema', () => {
  it('accepts an empty theme: every colour then takes the default', () => {
    expect(themeSchema.parse({})).toEqual({});
  });

  it('accepts any subset of the colours as #RRGGBB', () => {
    const theme = { background: '#0F1218', accent: '#f7be50' };
    expect(themeSchema.parse(theme)).toEqual(theme);
  });

  it.each([
    ['a colour name', { accent: 'gold' }],
    ['a short code', { accent: '#FB0' }],
    ['an unknown key', { accent: '#F7BE50', acent: '#000000' }],
  ])('refuses %s', (_name, theme) => {
    expect(themeSchema.safeParse(theme).success).toBe(false);
  });
});
