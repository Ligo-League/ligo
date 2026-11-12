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
