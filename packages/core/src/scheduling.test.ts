import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canProposeAt, dueSchedulingAction, playPeriod } from './scheduling.ts';
import { schedulingSchema, type SchedulingSettings } from './settings.ts';
import { weekWindow } from './time.ts';

const DAY = 86_400_000;
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
// LFR's rulebook: one extra week, then Sunday 21:00 French time.
const LFR: SchedulingSettings = schedulingSchema.parse({ rounds_per_week: 1 });
// Season 3, week 6: Monday 23 to Sunday 29 November 2026.
const WEEK_6 = weekWindow('2026-10-19', 6, 'Europe/Paris');
const PERIOD = playPeriod(WEEK_6, LFR);

describe('playPeriod', () => {
  it('adds the extension week and puts the automatic slot on its Sunday at 21:00', () => {
    expect({
      start: iso(PERIOD.start),
      end: iso(PERIOD.end),
      extensionEnd: iso(PERIOD.extensionEnd),
      autoSlotAt: iso(PERIOD.autoSlotAt),
    }).toEqual({
      start: '2026-11-22T23:00:00.000Z',
      end: '2026-11-29T23:00:00.000Z',
      extensionEnd: '2026-12-06T23:00:00.000Z',
      autoSlotAt: '2026-12-06T20:00:00.000Z',
    });
  });

  it('follows the league settings: a longer extension, another day, or no automatic slot', () => {
    const two = playPeriod(WEEK_6, { ...LFR, extension_weeks: 2 });
    expect(iso(two.extensionEnd)).toBe('2026-12-13T23:00:00.000Z');
    // The last Sunday of the extension.
    expect(iso(two.autoSlotAt)).toBe('2026-12-13T20:00:00.000Z');

    const wednesday = playPeriod(WEEK_6, { ...LFR, auto_slot: { weekday: 3, time: '20:30' } });
    expect(iso(wednesday.autoSlotAt)).toBe('2026-12-02T19:30:00.000Z');

    expect(playPeriod(WEEK_6, { ...LFR, auto_slot: null }).autoSlotAt).toBeNull();
  });

  it('keeps 21:00 local across a change of clocks (week 1 ends in summer time)', () => {
    const week1 = playPeriod(weekWindow('2026-10-19', 1, 'Europe/Paris'), LFR);
    // Sunday 1 November is in winter time, UTC+1.
    expect(iso(week1.autoSlotAt)).toBe('2026-11-01T20:00:00.000Z');
  });
});

describe('canProposeAt', () => {
  const now = PERIOD.start + DAY;
  it.each([
    ['during the week', PERIOD.start + 3 * DAY, { ok: true }],
    ['during the extension', PERIOD.end + 2 * DAY, { ok: true }],
    ['in the past', now - 60_000, { ok: false, error: 'in_past' }],
    ['before the week', PERIOD.start - DAY, { ok: false, error: 'in_past' }],
    ['after the extension', PERIOD.extensionEnd, { ok: false, error: 'outside_period' }],
  ])('%s', (_label, when, expected) => {
    expect(canProposeAt(when, PERIOD, now)).toEqual(expected);
  });

  it('refuses a time before the week even when it is still in the future', () => {
    expect(canProposeAt(PERIOD.start - DAY, PERIOD, PERIOD.start - 2 * DAY)).toEqual({
      ok: false,
      error: 'outside_period',
    });
  });
});

describe('dueSchedulingAction', () => {
  const open = { status: 'scheduled' as const, scheduledAt: null };

  it('starts the extension once the week has ended without an agreed time', () => {
    expect(dueSchedulingAction(open, PERIOD, PERIOD.end)).toBe('start_extension');
    expect(dueSchedulingAction(open, PERIOD, PERIOD.end + 3 * DAY)).toBe('start_extension');
  });

  it.each([
    ['during the week', open, PERIOD.end - 1],
    ['once a time is agreed', { ...open, scheduledAt: PERIOD.end - DAY }, PERIOD.end],
    ['once a result is reported', { status: 'reported' as const, scheduledAt: null }, PERIOD.end],
    ['for a forfeit', { status: 'forfeit' as const, scheduledAt: null }, PERIOD.end],
    // The bot was off when it should have acted: staff decide, nothing is set in the past.
    ['once the automatic slot has passed', open, PERIOD.autoSlotAt ?? 0],
  ])('does nothing %s', (_label, current, now) => {
    expect(dueSchedulingAction(current, PERIOD, now)).toBe('none');
  });

  it('does nothing in a league without an automatic slot', () => {
    const period = playPeriod(WEEK_6, { ...LFR, auto_slot: null });
    expect(dueSchedulingAction(open, period, period.end)).toBe('none');
  });

  it('acts exactly between the end of the week and the automatic slot', () => {
    const slot = PERIOD.autoSlotAt ?? 0;
    fc.assert(
      fc.property(fc.integer({ min: PERIOD.start - 7 * DAY, max: slot + 7 * DAY }), (now) => {
        const due = dueSchedulingAction(open, PERIOD, now) === 'start_extension';
        expect(due).toBe(now >= PERIOD.end && now < slot);
      }),
    );
  });
});

describe('schedulingSchema', () => {
  it("defaults to LFR's rulebook, so stored settings without these keys keep reading", () => {
    expect(schedulingSchema.parse({ rounds_per_week: 1 })).toEqual({
      rounds_per_week: 1,
      time_zone: 'Europe/Paris',
      extension_weeks: 1,
      auto_slot: { weekday: 7, time: '21:00' },
    });
  });

  it.each([
    ['an unknown time zone', { time_zone: 'Mars/Olympus' }],
    ['no extension week', { extension_weeks: 0 }],
    ['a weekday out of range', { auto_slot: { weekday: 8, time: '21:00' } }],
    ['a time that is not HH:MM', { auto_slot: { weekday: 7, time: '9pm' } }],
  ])('refuses %s', (_label, value) => {
    expect(schedulingSchema.safeParse({ rounds_per_week: 1, ...value }).success).toBe(false);
  });
});
