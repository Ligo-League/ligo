import type { PromotionSettings } from './settings.ts';

/** What a place in a division's table leads to, shown so that teams see where they stand. */
export const STANDINGS_ZONE_KINDS = [
  'champion',
  'promotion',
  'barrage_promotion',
  'barrage_relegation',
  'relegation',
] as const;
export type StandingsZoneKind = (typeof STANDINGS_ZONE_KINDS)[number];

/** Places `from` to `to` (1 = first) of a table, both included. */
export interface StandingsZone {
  from: number;
  to: number;
  kind: StandingsZoneKind;
}

/**
 * The zones of a division's table: its first is champion when no division is above it; with a
 * lower division, the last places go down and those just above play a barrage; with an upper one,
 * the first places go up and the barrage opponents follow. Counted from each end, so they follow
 * the division's size. In a division too small for all of them, a place keeps the first zone
 * given to it, in the order above, and a zone shrinks to the places left.
 */
export function divisionZones(
  rules: PromotionSettings,
  division: { size: number; hasUpper: boolean; hasLower: boolean },
): StandingsZone[] {
  const { size, hasUpper, hasLower } = division;
  const wanted: StandingsZone[] = [];
  const add = (from: number, count: number, kind: StandingsZoneKind) => {
    if (count > 0) wanted.push({ from, to: from + count - 1, kind });
  };
  if (!hasUpper) add(1, 1, 'champion');
  if (hasUpper) add(1, rules.relegated, 'promotion');
  if (hasLower) add(size - rules.relegated + 1, rules.relegated, 'relegation');
  if (hasUpper) add(rules.barrage_opponent_place, rules.relegation_barrage, 'barrage_promotion');
  if (hasLower) {
    add(
      size - rules.relegated - rules.relegation_barrage + 1,
      rules.relegation_barrage,
      'barrage_relegation',
    );
  }

  const taken = new Set<number>();
  const zones: StandingsZone[] = [];
  for (const zone of wanted) {
    const free: number[] = [];
    for (let place = Math.max(1, zone.from); place <= Math.min(size, zone.to); place += 1) {
      if (!taken.has(place)) free.push(place);
    }
    // Zones keep one run of places each: a gap would split a zone in two.
    const [first] = free;
    if (first === undefined) continue;
    let last = first;
    while (free.includes(last + 1)) last += 1;
    for (let place = first; place <= last; place += 1) taken.add(place);
    zones.push({ from: first, to: last, kind: zone.kind });
  }
  return zones.sort((a, b) => a.from - b.from);
}

/** The zone a place in the table (1 = first) falls in, or null. */
export function zoneAt(zones: readonly StandingsZone[], place: number): StandingsZoneKind | null {
  return zones.find((zone) => place >= zone.from && place <= zone.to)?.kind ?? null;
}
