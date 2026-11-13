import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assignSides } from './sides.ts';

// Design doc section 5, "Sides and host": the lower-ranked team picks the starting side and
// starts the veto, the other picks the overtime side, the higher-ranked team hosts.
describe('assignSides', () => {
  it('lets the lower-ranked team pick the starting side, and the higher-ranked host', () => {
    expect(assignSides(7, 2, 'a')).toEqual({
      sideChooser: 'a',
      otSideChooser: 'b',
      host: 'b',
      byCoin: false,
    });
    expect(assignSides(1, 10, 'a')).toEqual({
      sideChooser: 'b',
      otSideChooser: 'a',
      host: 'a',
      byCoin: false,
    });
  });

  it('follows the coin when both teams share a rank (O-12, until the owner answers)', () => {
    expect(assignSides(3, 3, 'b')).toEqual({
      sideChooser: 'b',
      otSideChooser: 'a',
      host: 'a',
      byCoin: true,
    });
    expect(assignSides(1, 1, 'a')).toMatchObject({ sideChooser: 'a', host: 'b', byCoin: true });
  });

  it('always gives the three roles to the two teams, the side chooser never hosting', () => {
    const side = fc.constantFrom('a' as const, 'b' as const);
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        side,
        (a, b, coin) => {
          const sides = assignSides(a, b, coin);
          expect(sides.otSideChooser).not.toBe(sides.sideChooser);
          expect(sides.host).toBe(sides.otSideChooser);
          expect(sides.byCoin).toBe(a === b);
        },
      ),
    );
  });
});
