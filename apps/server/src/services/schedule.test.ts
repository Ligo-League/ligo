import { schema } from '@ligo/db';
import { and, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { registrationDatabase } from '../testing.ts';
import { ensurePlayer } from './players.ts';
import {
  publishSchedule,
  reshuffleSchedule,
  saveScheduleDraft,
  scheduleAdmin,
  type ScheduleDivision,
} from './schedule.ts';

// A season's schedule (phase 4; design doc section 5, "Scheduling"; M-45): staff draw each
// division's round robin as a draft, mark weeks off or weeks with one round more, look at the
// calendar, then publish it, which creates the matches. A published schedule is never drawn again.
// Season 4 runs from Monday 4 January to Sunday 14 March 2027 (the seed's placeholder dates).

const NOW = 1_800_000_000_000;
const OWNER_ID = '994597181476569170';
const SEASON_3 = 1;
const SEASON_4 = 2;

function league(teams = 10) {
  const db = registrationDatabase();
  const owner = {
    discordUserId: OWNER_ID,
    playerId: ensurePlayer(db, { orgId: 1, discordUserId: OWNER_ID, displayName: 'Owner' }, 1).id,
  };
  const stranger = {
    discordUserId: '333333333333333333',
    playerId: ensurePlayer(
      db,
      { orgId: 1, discordUserId: '333333333333333333', displayName: 'X' },
      1,
    ).id,
  };
  const ligue1 = db
    .select()
    .from(schema.division)
    .where(and(eq(schema.division.seasonId, SEASON_4), eq(schema.division.name, 'Ligue 1')))
    .get();
  if (!ligue1) throw new Error('Season 4 has no Ligue 1');
  // New rosters register for Season 4's Ligue 1: Team 1 (T1) to Team n.
  for (let n = 1; n <= teams; n += 1) {
    const clubRow = db
      .insert(schema.club)
      .values({
        orgId: 1,
        name: `Club ${String(n)}`,
        slug: `club-${String(n)}`,
        colorsJson: ['#112233', '#FFFFFF'],
        socialsJson: [],
      })
      .returning()
      .get();
    const teamRow = db
      .insert(schema.team)
      .values({
        orgId: 1,
        clubId: clubRow.id,
        title: 'r6',
        name: `Team ${String(n)}`,
        tag: `T${String(n)}`,
        slug: `team-${String(n)}`,
      })
      .returning()
      .get();
    db.insert(schema.slot).values({ divisionId: ligue1.id, teamId: teamRow.id }).run();
  }
  const key = { orgSlug: 'mlb-group', compSlug: 'lfr', seasonId: SEASON_4, staffIds: [] };
  let seed = 1000;
  const newSeed = () => (seed += 1);
  const division = (seasonKey = key): ScheduleDivision => {
    const view = scheduleAdmin(db, owner, seasonKey);
    if (!view.ok) throw new Error(view.error);
    const found = view.divisions.find((candidate) => candidate.id === ligue1.id);
    if (!found) throw new Error('Ligue 1 is not listed');
    return found;
  };
  const draft = (
    form: Partial<{ weeksOff: string[]; extraRoundWeeks: string[]; bestOf: string }> = {},
  ) =>
    saveScheduleDraft(
      db,
      owner,
      key,
      ligue1.id,
      { weeksOff: [], extraRoundWeeks: [], bestOf: '1', ...form },
      newSeed,
      NOW,
    );
  const matchesOf = () => {
    const stages = db
      .select({ id: schema.stage.id })
      .from(schema.stage)
      .where(eq(schema.stage.divisionId, ligue1.id))
      .all()
      .map((row) => row.id);
    return stages.length === 0
      ? []
      : db.select().from(schema.match).where(inArray(schema.match.stageId, stages)).all();
  };
  const audits = (action: string) =>
    db.select().from(schema.auditLog).where(eq(schema.auditLog.action, action)).all();
  return { db, owner, stranger, ligue1, key, newSeed, division, draft, matchesOf, audits };
}

describe('the schedule page', () => {
  it('lists the season’s divisions, with a division that has no draft yet', () => {
    const { division } = league();
    const ligue1 = division();
    expect(ligue1).toMatchObject({ name: 'Ligue 1', status: 'none', problem: null, preview: null });
    expect(ligue1.teams).toHaveLength(10);
  });

  it('shows Season 3’s divisions as published, from the seeded schedule', () => {
    const { db, owner, key } = league();
    const view = scheduleAdmin(db, owner, { ...key, seasonId: SEASON_3 });
    if (!view.ok) throw new Error(view.error);
    expect(view.divisions.map((entry) => entry.status)).toEqual(['published', 'published']);
    expect(view.divisions[0]?.published?.matches).toBeGreaterThan(0);
  });

  it('is for the organisation’s owner and the competition’s staff only', () => {
    const { db, stranger, key } = league();
    expect(scheduleAdmin(db, stranger, key)).toEqual({ ok: false, error: 'not_allowed' });
    expect(scheduleAdmin(db, stranger, { ...key, staffIds: [1] }).ok).toBe(true);
    expect(scheduleAdmin(db, stranger, { ...key, staffIds: [1], seasonId: 99 })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('says when a division has too few teams to draw, or more than its limit', () => {
    expect(league(1).division().problem).toBe('too_few_teams');
    expect(league(13).division().problem).toBe('too_many_teams');
  });
});

describe('a draft', () => {
  it('draws 10 teams over 9 weeks inside the season, every pair once', () => {
    const { draft, division, audits } = league();
    expect(draft()).toEqual({ ok: true });
    const ligue1 = division();
    expect(ligue1.status).toBe('draft');
    const preview = ligue1.preview;
    if (!preview) throw new Error('no preview');
    expect(preview.weeks).toHaveLength(9);
    expect(preview.weeks.every((week) => week.matches.length === 5)).toBe(true);
    expect(preview).toMatchObject({ lastDay: '2027-03-07', overrun: false });
    const pairs = new Set(
      preview.weeks.flatMap((week) =>
        week.matches.map(({ a, b }) => [a.slotId, b.slotId].sort().join('-')),
      ),
    );
    expect(pairs.size).toBe(45);
    expect(audits('schedule.draft')).toHaveLength(1);
  });

  it('warns when the last week passes the season’s end: 12 teams play 11 weeks', () => {
    const { draft, division } = league(12);
    draft();
    expect(division().preview).toMatchObject({ lastDay: '2027-03-21', overrun: true });
  });

  it('skips a week off and gives a week one round more, as staff mark them', () => {
    const { draft, division } = league(12);
    draft({ weeksOff: ['2027-02-15'], extraRoundWeeks: ['2027-01-11', '2027-01-18'] });
    const ligue1 = division();
    const preview = ligue1.preview;
    if (!preview) throw new Error('no preview');
    expect(preview.weeks).toHaveLength(9);
    expect(preview.weeks[1]?.matches).toHaveLength(12);
    expect(preview.weeks.map((week) => week.calendarWeek)).not.toContain(7);
    expect(preview).toMatchObject({ lastDay: '2027-03-14', overrun: false });
    const marked = ligue1.calendarWeeks.filter((week) => week.off || week.extra);
    expect(marked.map((week) => [week.firstDay, week.off, week.extra])).toEqual([
      ['2027-01-11', false, true],
      ['2027-01-18', false, true],
      ['2027-02-15', true, false],
    ]);
  });

  it('keeps its draw when the weeks change, and draws again only when staff reshuffle', () => {
    const { db, owner, key, ligue1, draft, division, newSeed, audits } = league();
    draft();
    const first = division().preview?.weeks[0]?.matches;
    draft({ weeksOff: ['2027-01-04'] });
    expect(division().preview?.weeks[0]?.matches).toEqual(first);
    expect(reshuffleSchedule(db, owner, key, ligue1.id, newSeed, NOW)).toEqual({ ok: true });
    expect(division().preview?.weeks[0]?.matches).not.toEqual(first);
    expect(audits('schedule.reshuffle')).toHaveLength(1);
  });

  it('shows the team that rests each week when the count is odd', () => {
    const { draft, division } = league(9);
    draft();
    const weeks = division().preview?.weeks ?? [];
    expect(weeks).toHaveLength(9);
    expect(weeks.every((week) => week.rests.length === 1)).toBe(true);
  });

  it('refuses a day outside the dates format and a best-of other than 1, 3 or 5', () => {
    const { draft } = league();
    expect(draft({ weeksOff: ['15/02/2027'] })).toMatchObject({ ok: false, error: 'invalid' });
    expect(draft({ bestOf: '2' })).toMatchObject({ ok: false, error: 'invalid' });
  });
});

describe('publishing', () => {
  it('creates every match in its week’s window, as BO1, and audits it', () => {
    const { db, owner, key, ligue1, draft, division, matchesOf, audits } = league();
    draft();
    expect(publishSchedule(db, owner, key, ligue1.id, { acceptOverrun: false }, NOW)).toEqual({
      ok: true,
    });
    const matches = matchesOf();
    expect(matches).toHaveLength(45);
    expect(matches.every((row) => row.status === 'scheduled' && row.bestOf === 1)).toBe(true);
    const first = matches.filter((row) => row.week === 1);
    expect(first).toHaveLength(5);
    expect(first[0]?.windowEnd).toBeGreaterThan(first[0]?.windowStart ?? Infinity);
    // Matches are created week by week: channel categories fill in that order (4-7).
    expect(matches.map((row) => row.week)).toEqual(
      [...matches.map((row) => row.week)].sort((a, b) => (a ?? 0) - (b ?? 0)),
    );
    const sides = db
      .select()
      .from(schema.matchSlot)
      .where(
        inArray(
          schema.matchSlot.matchId,
          matches.map((row) => row.id),
        ),
      )
      .all();
    expect(sides).toHaveLength(90);
    expect(division()).toMatchObject({ status: 'published', published: { matches: 45, weeks: 9 } });
    expect(audits('schedule.publish')[0]?.afterJson).toMatchObject({ matches: 45, weeks: 9 });
  });

  it('places each match as the preview showed it', () => {
    const { db, owner, key, ligue1, draft, division, matchesOf } = league();
    draft();
    const shown = (division().preview?.weeks ?? []).flatMap((week) =>
      week.matches.map(({ a, b }) => `${week.week}:${a.slotId}-${b.slotId}`),
    );
    publishSchedule(db, owner, key, ligue1.id, { acceptOverrun: false }, NOW);
    const entrySlot = new Map(
      db
        .select()
        .from(schema.stageEntry)
        .all()
        .map((entry) => [entry.id, entry.slotId]),
    );
    const sides = db.select().from(schema.matchSlot).all();
    const made = matchesOf().map((row) => {
      const side = (s: 'a' | 'b') =>
        entrySlot.get(sides.find((x) => x.matchId === row.id && x.side === s)?.sourceRef ?? 0);
      return `${String(row.week)}:${String(side('a'))}-${String(side('b'))}`;
    });
    expect(made).toEqual(shown);
  });

  it('asks staff to confirm before publishing past the season’s end', () => {
    const { db, owner, key, ligue1, draft, matchesOf } = league(12);
    draft();
    expect(publishSchedule(db, owner, key, ligue1.id, { acceptOverrun: false }, NOW)).toEqual({
      ok: false,
      error: 'overrun',
    });
    expect(matchesOf()).toHaveLength(0);
    expect(publishSchedule(db, owner, key, ligue1.id, { acceptOverrun: true }, NOW).ok).toBe(true);
    expect(matchesOf()).toHaveLength(66);
  });

  it('plays the chosen best-of', () => {
    const { db, owner, key, ligue1, draft, matchesOf } = league(4);
    draft({ bestOf: '3' });
    publishSchedule(db, owner, key, ligue1.id, { acceptOverrun: false }, NOW);
    expect(matchesOf().every((row) => row.bestOf === 3)).toBe(true);
  });

  it('never draws a published schedule again: no new draft, reshuffle or publish', () => {
    const { db, owner, key, ligue1, draft, newSeed, matchesOf } = league();
    draft();
    publishSchedule(db, owner, key, ligue1.id, { acceptOverrun: false }, NOW);
    expect(draft()).toEqual({ ok: false, error: 'published' });
    expect(reshuffleSchedule(db, owner, key, ligue1.id, newSeed, NOW)).toEqual({
      ok: false,
      error: 'published',
    });
    expect(publishSchedule(db, owner, key, ligue1.id, { acceptOverrun: false }, NOW)).toEqual({
      ok: false,
      error: 'published',
    });
    expect(matchesOf()).toHaveLength(45);
  });

  it('refuses without a draft, and with too few or too many teams', () => {
    const one = league();
    expect(
      publishSchedule(one.db, one.owner, one.key, one.ligue1.id, { acceptOverrun: false }, NOW),
    ).toEqual({ ok: false, error: 'no_draft' });
    const crowded = league(13);
    expect(crowded.draft()).toEqual({ ok: false, error: 'too_many_teams' });
    const lonely = league(1);
    expect(lonely.draft()).toEqual({ ok: false, error: 'too_few_teams' });
  });

  it('refuses a division of another season, and people who are not staff', () => {
    const { db, owner, stranger, key, ligue1, draft } = league();
    draft();
    expect(
      publishSchedule(
        db,
        owner,
        { ...key, seasonId: SEASON_3 },
        ligue1.id,
        { acceptOverrun: false },
        NOW,
      ),
    ).toEqual({ ok: false, error: 'not_found' });
    expect(publishSchedule(db, stranger, key, ligue1.id, { acceptOverrun: false }, NOW)).toEqual({
      ok: false,
      error: 'not_allowed',
    });
  });
});
