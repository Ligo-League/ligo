// Weeks follow rounds (design doc section 5, "Scheduling"; M-45, maintainer, 20 November 2026).
import { weekWindow } from './time.ts';

export interface CalendarInput {
  /** The season's first and last days, `YYYY-MM-DD`; weeks start on `startsOn`. */
  startsOn: string;
  endsOn: string;
  timeZone: string;
  /** How many rounds the schedule has (`roundRobin`). */
  rounds: number;
  /** `scheduling_json.rounds_per_week`. */
  roundsPerWeek: number;
  /** Days inside weeks without matches (a holiday break): each skips its whole week. */
  weeksOff: readonly string[];
  /** Days inside weeks that hold one round more, to bring the last week back inside. */
  extraRoundWeeks: readonly string[];
}

export interface PlayWeek {
  /** The play week's number (`w1`, `w2`, …): weeks off are not counted. */
  week: number;
  /** The week of the season it falls in, from 1, weeks off included. */
  calendarWeek: number;
  firstDay: string;
  /** Its window, local midnight to local midnight (`weekWindow`); `end` is exclusive. */
  start: number;
  end: number;
  /** The rounds played that week, in order. */
  rounds: number[];
}

export interface SeasonCalendar {
  weeks: PlayWeek[];
  /** The last play week's Sunday (its last day). */
  lastDay: string;
  /** True when `lastDay` is after the season's `endsOn`: staff are warned. */
  overrun: boolean;
}

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar dates as day numbers, so weeks are counted in days, whatever the clocks do. */
function dayNumber(date: string): number {
  const match = ISO_DATE.exec(date);
  if (!match) throw new RangeError(`Not a YYYY-MM-DD date: "${date}"`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
}
const dateOf = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/**
 * Puts the rounds into play weeks, in order: each week holds `roundsPerWeek` rounds (one more
 * in an extra-round week), weeks off hold none, and the last week takes what is left.
 */
export function seasonCalendar(input: CalendarInput): SeasonCalendar {
  if (!Number.isInteger(input.rounds) || input.rounds < 1)
    throw new RangeError(`Not a round count: ${input.rounds}`);
  if (!Number.isInteger(input.roundsPerWeek) || input.roundsPerWeek < 1)
    throw new RangeError(`Not a weekly round count: ${input.roundsPerWeek}`);

  const first = dayNumber(input.startsOn);
  // The season's weeks the given days fall in; days before the season are ignored.
  const weeksOf = (days: readonly string[]) =>
    new Set(
      days
        .map((day) => dayNumber(day) - first)
        .filter((offset) => offset >= 0)
        .map((offset) => Math.floor(offset / 7) + 1),
    );
  const off = weeksOf(input.weeksOff);
  const extra = weeksOf(input.extraRoundWeeks);

  const weeks: PlayWeek[] = [];
  let next = 1;
  for (let calendarWeek = 1; next <= input.rounds; calendarWeek += 1) {
    if (off.has(calendarWeek)) continue;
    const count = input.roundsPerWeek + (extra.has(calendarWeek) ? 1 : 0);
    const rounds: number[] = [];
    for (; rounds.length < count && next <= input.rounds; next += 1) rounds.push(next);
    const window = weekWindow(input.startsOn, calendarWeek, input.timeZone);
    weeks.push({
      week: weeks.length + 1,
      calendarWeek,
      firstDay: dateOf(first + 7 * (calendarWeek - 1)),
      start: window.start,
      end: window.end,
      rounds,
    });
  }

  const lastWeek = weeks.at(-1)?.calendarWeek ?? 0;
  const lastDay = dateOf(first + 7 * lastWeek - 1);
  return { weeks, lastDay, overrun: dayNumber(lastDay) > dayNumber(input.endsOn) };
}
