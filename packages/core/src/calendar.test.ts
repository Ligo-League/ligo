import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { seasonCalendar, type CalendarInput } from './calendar.ts';
import { weekWindow, zonedMidnight } from './time.ts';

// Weeks follow rounds (design doc section 5, "Scheduling"; M-45, maintainer, 20 November 2026).
// Season 4's placeholder dates: Monday 4 January to Sunday 14 March 2027, ten weeks.

const PARIS = 'Europe/Paris';
const SEASON_4: CalendarInput = {
  startsOn: '2027-01-04',
  endsOn: '2027-03-14',
  timeZone: PARIS,
  rounds: 11,
  roundsPerWeek: 1,
  weeksOff: [],
  extraRoundWeeks: [],
};
const calendar = (changes: Partial<CalendarInput>) => seasonCalendar({ ...SEASON_4, ...changes });

describe('seasonCalendar', () => {
  it('gives 12 teams (11 rounds) 11 weeks, one past Season 4’s placeholder end', () => {
    const result = calendar({});
    expect(result.weeks).toHaveLength(11);
    expect(result.weeks.map((week) => week.week)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(result.weeks.map((week) => week.rounds)).toEqual(
      Array.from({ length: 11 }, (_, i) => [i + 1]),
    );
    expect(result.weeks[0]?.firstDay).toBe('2027-01-04');
    expect(result.lastDay).toBe('2027-03-21');
    expect(result.overrun).toBe(true);
  });

  it('fits 10 teams (9 rounds) inside the season, ending on its last Sunday but one', () => {
    const result = calendar({ rounds: 9 });
    expect(result.lastDay).toBe('2027-03-07');
    expect(result.overrun).toBe(false);
  });

  it('is not an overrun when the last week ends on the season’s last day', () => {
    expect(calendar({ rounds: 10 })).toMatchObject({ lastDay: '2027-03-14', overrun: false });
  });

  it('skips a week off, given by any day inside it, and numbers play weeks in order', () => {
    // Wednesday 17 February is in the season's 7th calendar week (15 to 21 February).
    const result = calendar({ rounds: 9, weeksOff: ['2027-02-17'] });
    expect(result.weeks.map((week) => week.week)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(result.weeks.map((week) => week.calendarWeek)).toEqual([1, 2, 3, 4, 5, 6, 8, 9, 10]);
    expect(result.weeks[6]?.firstDay).toBe('2027-02-22');
    expect(result.lastDay).toBe('2027-03-14');
    expect(result.overrun).toBe(false);
  });

  it('ignores a week off before the season, and several dates in one week skip it once', () => {
    const result = calendar({ rounds: 3, weeksOff: ['2026-12-28', '2027-01-12', '2027-01-15'] });
    expect(result.weeks.map((week) => week.calendarWeek)).toEqual([1, 3, 4]);
  });

  it('holds `roundsPerWeek` rounds a week, the last week taking what is left', () => {
    const result = calendar({ roundsPerWeek: 2 });
    expect(result.weeks.map((week) => week.rounds)).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
      [9, 10],
      [11],
    ]);
    expect(result.overrun).toBe(false);
  });

  it('gives a week one round more when staff ask, which brings 11 rounds back inside', () => {
    const result = calendar({ extraRoundWeeks: ['2027-01-11'] });
    expect(result.weeks[1]?.rounds).toEqual([2, 3]);
    expect(result.weeks).toHaveLength(10);
    expect(result).toMatchObject({ lastDay: '2027-03-14', overrun: false });
  });

  it('keeps a week off when it is also asked to hold an extra round', () => {
    const result = calendar({
      rounds: 2,
      weeksOff: ['2027-01-04'],
      extraRoundWeeks: ['2027-01-04'],
    });
    expect(result.weeks.map((week) => [week.calendarWeek, week.rounds])).toEqual([
      [2, [1]],
      [3, [2]],
    ]);
  });

  it('takes each week’s window from the season’s first day, across the clock change', () => {
    // The clocks go forward on Sunday 28 March 2027, inside the 12th calendar week.
    const result = calendar({ rounds: 12 });
    for (const week of result.weeks) {
      expect({ start: week.start, end: week.end }).toEqual(
        weekWindow(SEASON_4.startsOn, week.calendarWeek, PARIS),
      );
      expect(week.start).toBe(zonedMidnight(week.firstDay, PARIS));
    }
    const twelfth = result.weeks[11];
    expect(twelfth && twelfth.end - twelfth.start).toBe(7 * 24 * 3_600_000 - 3_600_000);
  });

  it('places every round once, in order, never in a week off', () => {
    const day = fc
      .integer({ min: 0, max: 200 })
      .map((offset) => new Date(Date.UTC(2027, 0, 4 + offset)).toISOString().slice(0, 10));
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: 1, max: 3 }),
        fc.array(day, { maxLength: 8 }),
        fc.array(day, { maxLength: 8 }),
        (rounds, roundsPerWeek, weeksOff, extraRoundWeeks) => {
          const result = calendar({ rounds, roundsPerWeek, weeksOff, extraRoundWeeks });
          expect(result.weeks.flatMap((week) => week.rounds)).toEqual(
            Array.from({ length: rounds }, (_, i) => i + 1),
          );
          expect(result.weeks.map((week) => week.week)).toEqual(
            Array.from({ length: result.weeks.length }, (_, i) => i + 1),
          );
          const off = new Set(
            weeksOff.map(
              (date) => Math.floor((Date.parse(date) - Date.parse('2027-01-04')) / 6.048e8) + 1,
            ),
          );
          for (const [i, week] of result.weeks.entries()) {
            expect(off.has(week.calendarWeek)).toBe(false);
            expect(week.rounds.length).toBeGreaterThanOrEqual(1);
            expect(week.rounds.length).toBeLessThanOrEqual(roundsPerWeek + 1);
            const next = result.weeks[i + 1];
            if (next) expect(next.calendarWeek).toBeGreaterThan(week.calendarWeek);
          }
          expect(result.overrun).toBe(result.lastDay > SEASON_4.endsOn);
        },
      ),
    );
  });

  it('refuses a round count or a weekly count below one, which settings never allow', () => {
    expect(() => calendar({ rounds: 0 })).toThrow(RangeError);
    expect(() => calendar({ roundsPerWeek: 0 })).toThrow(RangeError);
  });
});
