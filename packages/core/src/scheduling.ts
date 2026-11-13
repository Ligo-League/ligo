import type { SchedulingSettings } from './settings.ts';
import { zonedDate, zonedDateTime, zonedMidnight } from './time.ts';

// When a league match can be played, and what the bot does when the teams agree no time
// (design doc section 5, "Scheduling"): one extension week, then an automatic time.

export interface PlayPeriod {
  /** The planned week: `start` included, `end` excluded. */
  start: number;
  end: number;
  /** The end of the extension, excluded: the last moment a match can be set by the teams. */
  extensionEnd: number;
  /** The time the match is set to when the extension starts; null when the league has none. */
  autoSlotAt: number | null;
}

/** The planned week of a match and its extension, in the league's time zone. */
export function playPeriod(
  window: { start: number; end: number },
  settings: Pick<SchedulingSettings, 'time_zone' | 'extension_weeks' | 'auto_slot'>,
): PlayPeriod {
  const zone = settings.time_zone;
  // The week ends at local midnight: its date is the first day of the extension.
  const firstDay = zonedDate(window.end, zone).date;
  const days = 7 * settings.extension_weeks;
  const extensionEnd = zonedMidnight(firstDay, zone, days);

  let autoSlotAt: number | null = null;
  const slot = settings.auto_slot;
  if (slot) {
    // The last day of the extension that falls on the wanted weekday.
    for (let offset = days - 1; offset >= 0 && autoSlotAt === null; offset -= 1) {
      const day = zonedDate(zonedMidnight(firstDay, zone, offset), zone);
      if (day.weekday !== slot.weekday) continue;
      // A time the clocks skip that night gives no automatic time that day.
      const at = zonedDateTime(day.date, slot.time, zone);
      if (at.ok) autoSlotAt = at.at;
    }
  }
  return { start: window.start, end: window.end, extensionEnd, autoSlotAt };
}

export type ProposeRefusal = 'in_past' | 'outside_period';

/** Whether the teams may agree to play at `when`: in the future, in the week or its extension. */
export function canProposeAt(
  when: number,
  period: PlayPeriod,
  now: number,
): { ok: true } | { ok: false; error: ProposeRefusal } {
  if (when <= now) return { ok: false, error: 'in_past' };
  if (when < period.start || when >= period.extensionEnd) {
    return { ok: false, error: 'outside_period' };
  }
  return { ok: true };
}

/**
 * What the clock must do for a match now. The extension starts, with its automatic time, once the
 * week is over and no time is agreed. Once the automatic time has passed (the bot was off), it
 * does nothing: setting a time in the past would mislead, and staff decide instead.
 */
export function dueSchedulingAction(
  match: { status: string; scheduledAt: number | null },
  period: PlayPeriod,
  now: number,
): 'none' | 'start_extension' {
  if (match.status !== 'scheduled' || match.scheduledAt !== null) return 'none';
  if (period.autoSlotAt === null) return 'none';
  return now >= period.end && now < period.autoSlotAt ? 'start_extension' : 'none';
}
