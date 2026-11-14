import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { assignSides } from './sides.ts';

// Design doc section 5, "Sides and host": the lower-ranked team has side selection and bans
// first, the other picks the overtime side, the higher-ranked team hosts. Equal ranks go to
// BLAST's coin toss, and the teams agree on the host (O-12).
describe('assignSides', () => {
  it('lets the lower-ranked team lead the veto, and the higher-ranked host', () => {
    expect(assignSides(7, 2, 'b')).toEqual({
      lead: 'a',
      byCoin: false,
      sideChooser: 'a',
      otSideChooser: 'b',
      host: 'b',
    });
    expect(assignSides(1, 10, 'a')).toEqual({
      lead: 'b',
      byCoin: false,
      sideChooser: 'b',
      otSideChooser: 'a',
      host: 'a',
    });
  });

  it('lets the coin winner lead between equal ranks, the rest decided in the veto, no host', () => {
    expect(assignSides(3, 3, 'b')).toEqual({
      lead: 'b',
      byCoin: true,
      sideChooser: null,
      otSideChooser: null,
      host: null,
    });
    expect(assignSides(1, 1, 'a')).toMatchObject({ lead: 'a', byCoin: true, host: null });
  });

  it('gives the roles to two different teams, the side chooser never hosting', () => {
    const side = fc.constantFrom('a' as const, 'b' as const);
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        side,
        (a, b, coin) => {
          const sides = assignSides(a, b, coin);
          expect(sides.byCoin).toBe(a === b);
          if (sides.byCoin) {
            expect(sides.lead).toBe(coin);
            return;
          }
          expect(sides.sideChooser).toBe(sides.lead);
          expect(sides.otSideChooser).not.toBe(sides.sideChooser);
          expect(sides.host).toBe(sides.otSideChooser);
        },
      ),
    );
  });
});
