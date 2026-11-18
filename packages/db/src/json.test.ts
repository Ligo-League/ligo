import { describe, expect, it } from 'vitest';
import { requestPayloadSchema, rosterMovePayloadSchema, themeSchema } from './json.ts';

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

describe('a mercato move’s payload', () => {
  const move = {
    outId: 2,
    in: { playerId: 7, role: 'player' },
    windowId: 1,
    counted: true,
    fromTeamId: null,
    exceptionReason: null,
  };

  it('is a request payload, a swap, an arrival or a departure', () => {
    expect(requestPayloadSchema.parse(move)).toEqual(move);
    expect(rosterMovePayloadSchema.parse({ ...move, outId: null })).toMatchObject({ outId: null });
    expect(rosterMovePayloadSchema.parse({ ...move, in: null })).toMatchObject({ in: null });
  });

  it('refuses a role that is not a starter or a substitute, and unknown keys', () => {
    expect(() =>
      rosterMovePayloadSchema.parse({ ...move, in: { playerId: 7, role: 'coach' } }),
    ).toThrow();
    expect(() => rosterMovePayloadSchema.parse({ ...move, extra: 1 })).toThrow();
  });
});
