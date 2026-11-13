import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { promotionSchema, type PromotionSettings } from './settings.ts';
import { divisionZones, zoneAt, type StandingsZoneKind } from './zones.ts';

// The maintainer's rule (13 November 2026): the last 2 of a division that has a lower one go
// down; the team just above plays a barrage against the lower division's 3rd; the lower
// division's first 2 go up. Every number is a setting.
const LFR: PromotionSettings = promotionSchema.parse({});

const places = (zones: ReturnType<typeof divisionZones>, size: number) =>
  Array.from({ length: size }, (_place, index) => zoneAt(zones, index + 1));

describe('promotionSchema', () => {
  it('defaults to 2 down, 1 relegation barrage against the lower division’s 3rd', () => {
    expect(LFR).toEqual({ relegated: 2, relegation_barrage: 1, barrage_opponent_place: 3 });
  });

  it('refuses a barrage opponent among the teams that go up', () => {
    expect(promotionSchema.safeParse({ relegated: 2, barrage_opponent_place: 2 }).success).toBe(
      false,
    );
  });
});

describe('divisionZones', () => {
  it('Ligue 1, 10 teams, Ligue 2 below: champion, 8th barrage, 9th and 10th down', () => {
    const zones = divisionZones(LFR, { size: 10, hasUpper: false, hasLower: true });
    expect(places(zones, 10)).toEqual([
      'champion',
      null,
      null,
      null,
      null,
      null,
      null,
      'barrage_relegation',
      'relegation',
      'relegation',
    ]);
  });

  it('Ligue 2, 12 teams, nothing below: 1st and 2nd up, 3rd barrage, nobody down', () => {
    const zones = divisionZones(LFR, { size: 12, hasUpper: true, hasLower: false });
    expect(places(zones, 12)).toEqual([
      'promotion',
      'promotion',
      'barrage_promotion',
      ...Array.from({ length: 9 }, () => null),
    ]);
  });

  it('counts relegation from the bottom, whatever the size', () => {
    const zones = divisionZones(LFR, { size: 12, hasUpper: true, hasLower: true });
    expect(places(zones, 12).slice(-3)).toEqual(['barrage_relegation', 'relegation', 'relegation']);
  });

  it('follows the settings', () => {
    const rules = { relegated: 1, relegation_barrage: 2, barrage_opponent_place: 4 };
    const below = divisionZones(rules, { size: 8, hasUpper: true, hasLower: true });
    expect(places(below, 8)).toEqual([
      'promotion',
      null,
      null,
      'barrage_promotion',
      'barrage_promotion',
      'barrage_relegation',
      'barrage_relegation',
      'relegation',
    ]);
    const none = { relegated: 0, relegation_barrage: 0, barrage_opponent_place: 1 };
    expect(divisionZones(none, { size: 8, hasUpper: true, hasLower: true })).toEqual([]);
  });

  it('marks a single division with no other only for its champion', () => {
    const zones = divisionZones(LFR, { size: 6, hasUpper: false, hasLower: false });
    expect(places(zones, 6)).toEqual(['champion', null, null, null, null, null]);
  });

  it('never gives a place two zones, nor a place outside the table, even in tiny divisions', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 14 }),
        fc.record({
          relegated: fc.integer({ min: 0, max: 5 }),
          relegation_barrage: fc.integer({ min: 0, max: 5 }),
        }),
        fc.boolean(),
        fc.boolean(),
        (size, counts, hasUpper, hasLower) => {
          const rules = { ...counts, barrage_opponent_place: counts.relegated + 1 };
          const zones = divisionZones(rules, { size, hasUpper, hasLower });
          const covered: StandingsZoneKind[] = [];
          for (const zone of zones) {
            expect(zone.from).toBeGreaterThanOrEqual(1);
            expect(zone.to).toBeLessThanOrEqual(size);
            expect(zone.from).toBeLessThanOrEqual(zone.to);
            for (let place = zone.from; place <= zone.to; place += 1) covered.push(zone.kind);
          }
          const placesCovered = zones.flatMap((zone) =>
            Array.from({ length: zone.to - zone.from + 1 }, (_p, i) => zone.from + i),
          );
          expect(new Set(placesCovered).size).toBe(placesCovered.length);
          expect(covered.length).toBe(placesCovered.length);
        },
      ),
    );
  });
});

describe('zoneAt', () => {
  it('marks nothing for a place no zone covers', () => {
    expect(zoneAt([], 1)).toBeNull();
    expect(zoneAt([{ from: 1, to: 1, kind: 'champion' }], 2)).toBeNull();
  });
});
