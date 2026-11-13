// Calendar arithmetic in a league's time zone. Storage is Unix milliseconds UTC; a week of play
// starts at local midnight, which is not a fixed number of hours apart when the clocks change.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** How far the zone's wall clock is ahead of UTC at that instant, in milliseconds. */
function zoneOffset(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);
  const wallClock = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return wallClock - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The instant of 00:00 on a calendar date (`YYYY-MM-DD`) in a time zone, `days` days later.
 * Throws on a malformed date or zone: both come from validated storage, never from user input.
 */
export function zonedMidnight(date: string, timeZone: string, days = 0): number {
  const match = ISO_DATE.exec(date);
  if (!match) throw new RangeError(`Not a YYYY-MM-DD date: "${date}"`);
  // Date.UTC carries a day count past the end of the month into the following months.
  const naive = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days);
  // The offset at the naive instant can be the one from before a clock change that happens
  // between it and local midnight; a second pass with the corrected instant settles it.
  const firstGuess = naive - zoneOffset(naive, timeZone);
  return naive - zoneOffset(firstGuess, timeZone);
}

/**
 * The play window of week `week` (from 1) of a season starting on `startsOn`: local midnight to
 * local midnight seven days later. `end` is exclusive and equals the next week's `start`.
 */
export function weekWindow(
  startsOn: string,
  week: number,
  timeZone: string,
): { start: number; end: number } {
  if (!Number.isInteger(week) || week < 1) throw new RangeError(`Not a week number: ${week}`);
  return {
    start: zonedMidnight(startsOn, timeZone, 7 * (week - 1)),
    end: zonedMidnight(startsOn, timeZone, 7 * week),
  };
}

const CLOCK_TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** The wall clock of an instant in a time zone: its date, its time and its ISO weekday. */
export function zonedDate(
  utcMs: number,
  timeZone: string,
): { date: string; time: string; weekday: number } {
  const local = new Date(utcMs + zoneOffset(utcMs, timeZone));
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
    // getUTCDay counts Sunday as 0; ISO counts Monday as 1 and Sunday as 7.
    weekday: local.getUTCDay() === 0 ? 7 : local.getUTCDay(),
  };
}

export type ZonedDateTimeResult =
  | { ok: true; at: number }
  | { ok: false; error: 'invalid_date' | 'invalid_time' | 'nonexistent_time' };

/**
 * The instant of a date (`YYYY-MM-DD`) and a time (`HH:MM`) in a time zone, as people type them.
 * A time the clocks skip is refused; of a time they repeat, the first is taken.
 */
export function zonedDateTime(date: string, time: string, timeZone: string): ZonedDateTimeResult {
  const day = ISO_DATE.exec(date);
  const clock = CLOCK_TIME.exec(time);
  if (!day) return { ok: false, error: 'invalid_date' };
  if (!clock) return { ok: false, error: 'invalid_time' };
  const [year, month, dayOfMonth] = [Number(day[1]), Number(day[2]), Number(day[3])];
  const naive = Date.UTC(year, month - 1, dayOfMonth, Number(clock[1]), Number(clock[2]));
  // Date.UTC carries 30 February into March: such a date was not a real one.
  const check = new Date(naive);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== dayOfMonth) {
    return { ok: false, error: 'invalid_date' };
  }
  // Both offsets around the instant; the earlier instant first, so a repeated time gives the
  // first of the two. Whichever reads back as the typed wall clock is the answer.
  const candidates = [
    naive - zoneOffset(naive - 12 * 3_600_000, timeZone),
    naive - zoneOffset(naive + 12 * 3_600_000, timeZone),
  ].sort((x, y) => x - y);
  const normalised = `${String(Number(clock[1])).padStart(2, '0')}:${clock[2] ?? ''}`;
  for (const candidate of candidates) {
    const local = zonedDate(candidate, timeZone);
    if (local.date === date && local.time === normalised) return { ok: true, at: candidate };
  }
  return { ok: false, error: 'nonexistent_time' };
}
