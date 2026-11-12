import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { weekWindow, zonedMidnight } from './time.ts';

const PARIS = 'Europe/Paris';
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe('zonedMidnight', () => {
  it.each([
    ['2026-10-19', PARIS, '2026-10-18T22:00:00.000Z'], // summer time, UTC+2
    ['2026-10-26', PARIS, '2026-10-25T23:00:00.000Z'], // the day after clocks go back, UTC+1
    ['2026-12-20', PARIS, '2026-12-19T23:00:00.000Z'],
    ['2027-03-29', PARIS, '2027-03-28T22:00:00.000Z'], // the day after clocks go forward
    ['2026-10-19', 'UTC', '2026-10-19T00:00:00.000Z'],
    ['2026-11-02', 'America/New_York', '2026-11-02T05:00:00.000Z'],
    ['2026-07-01', 'Asia/Tokyo', '2026-06-30T15:00:00.000Z'],
  ])('%s in %s is %s', (date, zone, expected) => {
    expect(iso(zonedMidnight(date, zone))).toBe(expected);
  });

  it('adds days across the end of a month and of a year', () => {
    expect(iso(zonedMidnight('2026-12-28', PARIS, 7))).toBe('2027-01-03T23:00:00.000Z');
    expect(zonedMidnight('2026-10-19', PARIS, 7)).toBe(zonedMidnight('2026-10-26', PARIS));
  });

  it.each(['19/10/2026', '2026-10-19T00:00', ''])('throws on %j', (date) => {
    expect(() => zonedMidnight(date, PARIS)).toThrow(RangeError);
  });

  it('throws on an unknown time zone', () => {
    expect(() => zonedMidnight('2026-10-19', 'Europe/Lutece')).toThrow(RangeError);
  });
});

describe('weekWindow', () => {
  it('gives LFR Season 3 its first week, one hour longer because the clocks go back', () => {
    const { start, end } = weekWindow('2026-10-19', 1, PARIS);
    expect(iso(start)).toBe('2026-10-18T22:00:00.000Z');
    expect(iso(end)).toBe('2026-10-25T23:00:00.000Z');
    expect((end - start) / HOUR).toBe(169);
  });

  it('gives week 9 the last week before the season ends on 20 December', () => {
    const { start, end } = weekWindow('2026-10-19', 9, PARIS);
    expect(iso(start)).toBe('2026-12-13T23:00:00.000Z');
    expect(iso(end)).toBe('2026-12-20T23:00:00.000Z');
  });

  it('gives a 167-hour week when the clocks go forward', () => {
    const { start, end } = weekWindow('2027-03-22', 1, PARIS);
    expect((end - start) / HOUR).toBe(167);
  });

  it.each([0, -1, 1.5])('throws on week %j', (week) => {
    expect(() => weekWindow('2026-10-19', week, PARIS)).toThrow(RangeError);
  });

  it('chains weeks without gap or overlap, each starting at local midnight', () => {
    const zone = fc.constantFrom(PARIS, 'UTC', 'America/New_York', 'Australia/Sydney');
    const start = fc
      .date({ min: new Date('2020-01-01'), max: new Date('2035-12-31'), noInvalidDate: true })
      .map((date) => date.toISOString().slice(0, 10));
    fc.assert(
      fc.property(start, fc.integer({ min: 1, max: 60 }), zone, (startsOn, week, timeZone) => {
        const current = weekWindow(startsOn, week, timeZone);
        const next = weekWindow(startsOn, week + 1, timeZone);
        expect(current.end).toBe(next.start);
        expect([167, 168, 169]).toContain((current.end - current.start) / HOUR);
        const localTime = new Intl.DateTimeFormat('en-GB', {
          timeZone,
          hourCycle: 'h23',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(current.start));
        expect(localTime).toBe('00:00');
      }),
    );
  });
});
