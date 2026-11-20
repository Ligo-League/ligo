import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ARCHIVED_TEAM_PERMISSIONS,
  BOT_PERMISSIONS,
  matchChannelKey,
  matchChannelPlan,
  OPEN_PERMISSIONS,
  type ChannelMatch,
  type MatchChannelContext,
} from './match-channels.ts';
import { discordSettingsSchema } from './settings.ts';

// Match channels (design doc section 6, "Match channel lifecycle"; M-44): one private channel per
// match, opened `open_days_before_week` days before its week (or earlier when staff open the
// week), in its week's category, and moved to an archive category
// `archive_hours_after_result` hours after its result counts, never by the calendar.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const GUILD = '900000000000000000';
const STAFF = '900000000000000001';
const BOT = '900000000000000002';
const STAFF_L1 = '900000000000000003';
/** Monday of week 3. */
const WEEK_3 = Date.UTC(2027, 0, 18);

const match = (id: number, overrides: Partial<ChannelMatch> = {}): ChannelMatch => ({
  id,
  division: { id: 1, prefix: 'L1', staffRoleId: STAFF_L1 },
  week: 3,
  windowStart: WEEK_3,
  countedAt: null,
  openEarly: false,
  a: { tag: 'GRD', roleKey: 'team:1' },
  b: { tag: 'RCK', roleKey: 'team:2' },
  ...overrides,
});

const context = (overrides: Partial<MatchChannelContext> = {}): MatchChannelContext => ({
  settings: discordSettingsSchema.parse({ manage: true }),
  everyoneId: GUILD,
  staffRoleId: STAFF,
  botUserId: BOT,
  existing: new Set(),
  now: WEEK_3 - 2 * DAY,
  ...overrides,
});

describe('matchChannelPlan', () => {
  it('opens a week’s channels two days before it starts, in the week’s category', () => {
    const before = matchChannelPlan([match(10)], context({ now: WEEK_3 - 2 * DAY - 1 }));
    expect(before).toEqual({ categories: [], channels: [] });
    const plan = matchChannelPlan([match(10)], context());
    expect(plan.categories).toEqual([
      { kind: 'week_category', key: 'division:1:week:3:1', name: 'L1 · Semaine 3' },
    ]);
    expect(plan.channels).toEqual([
      {
        kind: 'match_channel',
        key: matchChannelKey(10),
        name: 'w3-grd-rck',
        parent: { kind: 'week_category', key: 'division:1:week:3:1' },
        overwrites: [
          { target: { role: { id: GUILD } }, allow: [], deny: ['view_channel'] },
          { target: { role: { key: 'team:1' } }, allow: OPEN_PERMISSIONS, deny: [] },
          { target: { role: { key: 'team:2' } }, allow: OPEN_PERMISSIONS, deny: [] },
          { target: { role: { id: STAFF } }, allow: OPEN_PERMISSIONS, deny: [] },
          { target: { role: { id: STAFF_L1 } }, allow: OPEN_PERMISSIONS, deny: [] },
          { target: { member: BOT }, allow: BOT_PERMISSIONS, deny: [] },
        ],
      },
    ]);
  });

  it('opens a week staff opened early, at any time', () => {
    const plan = matchChannelPlan(
      [match(10, { openEarly: true })],
      context({ now: WEEK_3 - 30 * DAY }),
    );
    expect(plan.channels).toHaveLength(1);
  });

  it('uses the league’s templates, and leaves out a team with no role and a division without staff', () => {
    const settings = discordSettingsSchema.parse({
      manage: true,
      channel_template: '{division} {tagA} vs {tagB}',
      category_template: 'Matchs {division}',
      open_days_before_week: 0,
    });
    const plan = matchChannelPlan(
      [
        match(10, {
          division: { id: 1, prefix: 'L1', staffRoleId: null },
          b: { tag: 'RCK', roleKey: null },
        }),
      ],
      context({ settings, now: WEEK_3 }),
    );
    expect(plan.categories).toEqual([
      { kind: 'week_category', key: 'division:1:1', name: 'Matchs L1' },
    ]);
    expect(plan.channels[0]?.name).toBe('l1-grd-vs-rck');
    expect(plan.channels[0]?.overwrites.map((overwrite) => overwrite.target)).toEqual([
      { role: { id: GUILD } },
      { role: { key: 'team:1' } },
      { role: { id: STAFF } },
      { member: BOT },
    ]);
  });

  it('keeps a channel open after its week until the result counts, then archives it 48 hours later', () => {
    const late = WEEK_3 + 20 * DAY;
    const open = matchChannelPlan([match(10)], context({ now: late }));
    expect(open.channels[0]?.parent.kind).toBe('week_category');
    const counted = late - 47 * HOUR;
    const waiting = matchChannelPlan(
      [match(10, { countedAt: counted })],
      context({ now: late, existing: new Set([matchChannelKey(10)]) }),
    );
    expect(waiting.channels[0]?.parent.kind).toBe('week_category');
    const archived = matchChannelPlan(
      [match(10, { countedAt: counted })],
      context({ now: late + HOUR, existing: new Set([matchChannelKey(10)]) }),
    );
    expect(archived.categories).toEqual([
      { kind: 'archive_category', key: 'division:1:1', name: 'Archives · L1' },
    ]);
    expect(archived.channels[0]?.parent).toEqual({
      kind: 'archive_category',
      key: 'division:1:1',
    });
    // The teams keep reading but can no longer write; staff are unchanged.
    expect(archived.channels[0]?.overwrites.slice(1, 4)).toEqual([
      {
        target: { role: { key: 'team:1' } },
        allow: ARCHIVED_TEAM_PERMISSIONS,
        deny: ['send_messages'],
      },
      {
        target: { role: { key: 'team:2' } },
        allow: ARCHIVED_TEAM_PERMISSIONS,
        deny: ['send_messages'],
      },
      { target: { role: { id: STAFF } }, allow: OPEN_PERMISSIONS, deny: [] },
    ]);
  });

  it('never makes a channel for a match whose result counted long ago and that never had one', () => {
    const plan = matchChannelPlan(
      [match(10, { countedAt: WEEK_3 })],
      context({ now: WEEK_3 + 10 * DAY }),
    );
    expect(plan).toEqual({ categories: [], channels: [] });
  });

  it('adds a numbered category when one is full, and keeps each channel where it was', () => {
    const settings = discordSettingsSchema.parse({ category_template: 'Organisation {division}' });
    const many = Array.from({ length: 52 }, (_, index) =>
      match(index + 1, { a: { tag: `T${String(index)}`, roleKey: null } }),
    );
    const plan = matchChannelPlan(many, context({ settings }));
    expect(plan.categories.map((category) => category.name)).toEqual([
      'Organisation L1',
      'Organisation L1 (2)',
    ]);
    // Archiving the first channels moves none of the others.
    const existing = new Set(many.map((one) => matchChannelKey(one.id)));
    const later = matchChannelPlan(
      many.map((one) => (one.id <= 5 ? { ...one, countedAt: WEEK_3 - 5 * DAY } : one)),
      context({ settings, existing }),
    );
    const parentOf = (planned: typeof plan, id: number) =>
      planned.channels.find((channel) => channel.key === matchChannelKey(id))?.parent.key;
    expect(parentOf(later, 51)).toBe(parentOf(plan, 51));
    expect(parentOf(later, 6)).toBe(parentOf(plan, 6));
    expect(parentOf(later, 1)).toBe('division:1:1');
    expect(later.categories.map((category) => category.kind)).toEqual([
      'week_category',
      'week_category',
      'archive_category',
    ]);
  });

  it('keeps every channel inside a wanted category of at most 50 channels', () => {
    const arbitraryMatch = fc.record({
      division: fc.constantFrom(1, 2),
      week: fc.integer({ min: 1, max: 4 }),
      counted: fc.option(fc.integer({ min: 0, max: 10 * DAY }), { nil: null }),
      openEarly: fc.boolean(),
      known: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc.array(arbitraryMatch, { maxLength: 130 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 40 * DAY }),
        (rows, perWeek, now) => {
          const matches = rows.map((row, index) =>
            match(index + 1, {
              division: { id: row.division, prefix: `L${String(row.division)}`, staffRoleId: null },
              week: row.week,
              windowStart: WEEK_3 + (row.week - 3) * 7 * DAY,
              countedAt: row.counted === null ? null : WEEK_3 + row.counted,
              openEarly: row.openEarly,
            }),
          );
          const existing = new Set(
            rows.flatMap((row, index) => (row.known ? [matchChannelKey(index + 1)] : [])),
          );
          const settings = discordSettingsSchema.parse({
            category_template: perWeek ? '{division} · Semaine {week}' : 'Organisation {division}',
          });
          const plan = matchChannelPlan(
            matches,
            context({ settings, existing, now: WEEK_3 + now }),
          );
          const categories = new Set(
            plan.categories.map((category) => `${category.kind}:${category.key}`),
          );
          expect(categories.size).toBe(plan.categories.length);
          const counts = new Map<string, number>();
          for (const channel of plan.channels) {
            const parent = `${channel.parent.kind}:${channel.parent.key}`;
            expect(categories.has(parent)).toBe(true);
            counts.set(parent, (counts.get(parent) ?? 0) + 1);
          }
          expect(counts.size).toBe(categories.size);
          for (const count of counts.values()) expect(count).toBeLessThanOrEqual(50);
        },
      ),
    );
  });
});
