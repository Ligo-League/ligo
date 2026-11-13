import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import type { Actor } from './permissions.ts';
import {
  answerProposal,
  proposeTime,
  proposalDays,
  readMatchTime,
  runSchedulingTick,
  searchSchedulableMatches,
  setMatchTime,
} from './scheduling.ts';
import { addTeamStaff, setTeamManager } from './team-staff.ts';

const { auditLog, leagueGuild, match, matchProposal } = schema;

const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const member = (n: number): Actor => ({
  guildId: TEST_GUILD,
  user: { id: `70000000000000000${n}`, displayName: `Member ${n}` },
  memberRoleIds: [],
});
// Match 3 is Bravo (side A) v Charlie (side B), Ligue 1 week 3: Monday 2 to Sunday 8 November
// 2026, extension until Sunday 15 November, automatic time that Sunday at 21:00 Paris time.
const BRAVO = member(1);
const CHARLIE = member(2);
const CHARLIE_STAFF = member(3);
const OUTSIDER = member(4);
const NOW = Date.parse('2026-11-03T12:00:00Z');
const THURSDAY_21H = Date.parse('2026-11-05T20:00:00Z');
const WEEK_END = Date.parse('2026-11-08T23:00:00Z');
const AUTO_SLOT = Date.parse('2026-11-15T20:00:00Z');
const SCHEDULE = '800000000000000004';

function league() {
  const db = leagueDatabase();
  setTeamManager(db, STAFF, { teamId: 2, member: BRAVO.user }, 100);
  setTeamManager(db, STAFF, { teamId: 3, member: CHARLIE.user }, 100);
  addTeamStaff(db, STAFF, { teamId: 3, member: CHARLIE_STAFF.user }, 100);
  db.update(leagueGuild).set({ scheduleChannelId: SCHEDULE }).run();
  const stored = () => db.select().from(match).where(eq(match.id, 3)).get();
  const proposals = () => db.select().from(matchProposal).all();
  const dump = () => db.$client.serialize().toString('base64');
  const propose = (actor: Actor = BRAVO, at = THURSDAY_21H, now = NOW) =>
    proposeTime(db, actor, { matchId: 3, at }, now);
  return { db, stored, proposals, dump, propose };
}
const idOf = (reply: ReturnType<typeof proposeTime>) => {
  if (!reply.ok) throw new Error(reply.error);
  return reply.proposalId;
};

describe('proposeTime', () => {
  it("stores a team's proposal and names who may answer it", () => {
    const { db, propose, proposals, stored } = league();
    const reply = propose();
    expect(reply).toMatchObject({
      ok: true,
      side: 'a',
      at: THURSDAY_21H,
      match: { id: 3 },
      opponents: [{ discordUserId: CHARLIE.user.id }, { discordUserId: CHARLIE_STAFF.user.id }],
    });
    expect(proposals()).toMatchObject([
      { matchId: 3, side: 'a', at: THURSDAY_21H, createdAt: NOW, status: 'pending' },
    ]);
    // A proposal sets no time by itself.
    expect(stored()?.scheduledAt).toBeNull();
    expect(db.select().from(auditLog).all().at(-1)).toMatchObject({
      action: 'match.propose_time',
      entity: 'match',
      entityId: '3',
      afterJson: { at: THURSDAY_21H, side: 'a' },
    });
  });

  it("replaces the team's own pending proposal, and leaves the other team's alone", () => {
    const { propose, proposals } = league();
    propose(BRAVO);
    propose(CHARLIE, THURSDAY_21H + 3_600_000);
    propose(BRAVO, THURSDAY_21H + 86_400_000);
    expect(proposals().map((row) => [row.side, row.status])).toEqual([
      ['a', 'superseded'],
      ['b', 'pending'],
      ['a', 'pending'],
    ]);
  });

  it('accepts a time in the extension week', () => {
    expect(league().propose(BRAVO, AUTO_SLOT - 86_400_000).ok).toBe(true);
  });

  it.each([
    ['someone who manages no team', OUTSIDER, THURSDAY_21H, 'no_team'],
    ['a time in the past', BRAVO, NOW - 60_000, 'in_past'],
    ['a time after the extension', BRAVO, AUTO_SLOT + 7 * 86_400_000, 'outside_period'],
    ['a server linked to no league', { ...BRAVO, guildId: null }, THURSDAY_21H, 'not_linked'],
  ] as const)('refuses %s and stores nothing', (_label, actor, at, error) => {
    const { propose, dump } = league();
    const before = dump();
    expect(propose(actor, at)).toEqual({ ok: false, error });
    expect(dump()).toBe(before);
  });

  it('refuses a match of another team, and one that already has a result', () => {
    const { db } = league();
    setTeamManager(db, STAFF, { teamId: 4, member: OUTSIDER.user }, 100);
    expect(proposeTime(db, OUTSIDER, { matchId: 3, at: THURSDAY_21H }, NOW)).toEqual({
      ok: false,
      error: 'not_your_match',
    });
    expect(proposeTime(db, BRAVO, { matchId: 1, at: THURSDAY_21H }, NOW)).toEqual({
      ok: false,
      error: 'not_schedulable',
    });
  });
});

describe('answerProposal', () => {
  it('lets the other team accept: the match gets its time, other proposals lapse', () => {
    const { db, propose, proposals, stored } = league();
    const charlies = idOf(propose(CHARLIE, THURSDAY_21H + 3_600_000));
    const bravos = idOf(propose(BRAVO));
    const reply = answerProposal(
      db,
      CHARLIE_STAFF,
      { matchId: 3, proposalId: bravos, action: 'accept' },
      NOW + 1000,
    );
    expect(reply).toMatchObject({ ok: true, status: 'accepted', at: THURSDAY_21H });
    expect(stored()).toMatchObject({ scheduledAt: THURSDAY_21H, autoScheduled: false });
    expect(proposals().find((row) => row.id === charlies)?.status).toBe('superseded');
    expect(proposals().find((row) => row.id === bravos)).toMatchObject({
      status: 'accepted',
      answeredAt: NOW + 1000,
    });
    expect(db.select().from(auditLog).all().at(-1)).toMatchObject({
      action: 'match.accept_time',
      afterJson: { scheduledAt: THURSDAY_21H, proposalId: bravos },
    });
  });

  it('lets the other team decline: nothing is set', () => {
    const { db, propose, proposals, stored } = league();
    const id = idOf(propose());
    expect(
      answerProposal(db, CHARLIE, { matchId: 3, proposalId: id, action: 'decline' }, NOW),
    ).toMatchObject({ ok: true, status: 'declined' });
    expect(proposals()[0]?.status).toBe('declined');
    expect(stored()?.scheduledAt).toBeNull();
  });

  it('replaces an automatic time with the one the teams agree', () => {
    const { db, propose, stored } = league();
    runSchedulingTick(db, WEEK_END);
    expect(stored()).toMatchObject({ scheduledAt: AUTO_SLOT, autoScheduled: true });
    const id = idOf(propose(BRAVO, AUTO_SLOT - 86_400_000, WEEK_END + 1000));
    answerProposal(db, CHARLIE, { matchId: 3, proposalId: id, action: 'accept' }, WEEK_END + 2000);
    expect(stored()).toMatchObject({ scheduledAt: AUTO_SLOT - 86_400_000, autoScheduled: false });
  });

  it.each([
    ['the team that proposed', BRAVO, 'not_opponent'],
    ['someone on neither team', OUTSIDER, 'not_your_match'],
    ['a server linked to no league', { ...CHARLIE, guildId: null }, 'not_linked'],
  ] as const)('refuses %s, and changes nothing', (_label, actor, error) => {
    const { db, propose, dump } = league();
    const id = idOf(propose());
    const before = dump();
    expect(
      answerProposal(db, actor, { matchId: 3, proposalId: id, action: 'accept' }, NOW),
    ).toEqual({ ok: false, error });
    expect(dump()).toBe(before);
  });

  it('refuses a proposal already answered or replaced, one of another match, and a past time', () => {
    const { db, propose } = league();
    const first = idOf(propose());
    const second = idOf(propose(BRAVO, THURSDAY_21H + 3_600_000));
    const answer = (proposalId: number, now = NOW, matchId = 3) =>
      answerProposal(db, CHARLIE, { matchId, proposalId, action: 'accept' }, now);
    expect(answer(first)).toEqual({ ok: false, error: 'stale' });
    expect(answer(second, NOW, 1)).toEqual({ ok: false, error: 'stale' });
    expect(answer(second, THURSDAY_21H + 3_600_000)).toEqual({ ok: false, error: 'in_past' });
    expect(answer(second).ok).toBe(true);
    expect(answer(second)).toEqual({ ok: false, error: 'stale' });
  });
});

describe('setMatchTime', () => {
  it('lets staff set any time, ending the pending proposals', () => {
    const { db, propose, proposals, stored } = league();
    propose();
    const late = AUTO_SLOT + 30 * 86_400_000;
    expect(setMatchTime(db, STAFF, { matchId: 3, at: late }, NOW)).toMatchObject({ ok: true });
    expect(stored()).toMatchObject({ scheduledAt: late, autoScheduled: false });
    expect(proposals()[0]?.status).toBe('withdrawn');
    expect(db.select().from(auditLog).all().at(-1)).toMatchObject({
      action: 'match.schedule',
      afterJson: { scheduledAt: late },
    });
  });

  it('is for league staff only, on a match still to play', () => {
    const { db } = league();
    expect(setMatchTime(db, BRAVO, { matchId: 3, at: THURSDAY_21H }, NOW)).toEqual({
      ok: false,
      error: 'not_staff',
    });
    expect(setMatchTime(db, STAFF, { matchId: 1, at: THURSDAY_21H }, NOW)).toEqual({
      ok: false,
      error: 'not_schedulable',
    });
  });
});

describe('runSchedulingTick', () => {
  it('sets the automatic time once the week has ended, and says where to tell the teams', () => {
    const { db, stored } = league();
    expect(runSchedulingTick(db, WEEK_END - 1)).toEqual([]);
    const notices = runSchedulingTick(db, WEEK_END);
    expect(notices).toMatchObject([
      {
        match: { id: 3 },
        at: AUTO_SLOT,
        extensionEnd: Date.parse('2026-11-15T23:00:00Z'),
        channelIds: [SCHEDULE],
        mentionUserIds: [BRAVO.user.id, CHARLIE.user.id, CHARLIE_STAFF.user.id],
      },
    ]);
    expect(stored()).toMatchObject({ scheduledAt: AUTO_SLOT, autoScheduled: true });
    expect(db.select().from(auditLog).all().at(-1)).toMatchObject({
      actorKind: 'system',
      actorPlayerId: null,
      action: 'match.auto_schedule',
      afterJson: { scheduledAt: AUTO_SLOT, autoScheduled: true },
    });
  });

  it('does nothing twice', () => {
    const { db, dump } = league();
    runSchedulingTick(db, WEEK_END);
    const before = dump();
    expect(runSchedulingTick(db, WEEK_END + 60_000)).toEqual([]);
    expect(dump()).toBe(before);
  });

  it('leaves alone a match whose automatic time has already passed: staff decide', () => {
    const { db, stored } = league();
    expect(runSchedulingTick(db, AUTO_SLOT)).toEqual([]);
    expect(stored()?.scheduledAt).toBeNull();
  });

  it('still sets the time when no schedule channel is set, with nowhere to post', () => {
    const { db, stored } = league();
    db.update(leagueGuild).set({ scheduleChannelId: null }).run();
    expect(runSchedulingTick(db, WEEK_END)).toMatchObject([{ channelIds: [] }]);
    expect(stored()?.autoScheduled).toBe(true);
  });
});

describe('proposalDays', () => {
  it("lists the days left in the match's week and extension, in the league's time zone", () => {
    const { db } = league();
    const days = proposalDays(db, BRAVO, 3, NOW);
    // From Tuesday 3 November (today) to Sunday 15 November.
    expect(days[0]).toEqual({ date: '2026-11-03', weekday: 2 });
    expect(days.at(-1)).toEqual({ date: '2026-11-15', weekday: 7 });
    expect(days).toHaveLength(13);
  });

  it('lists the next two weeks when no match is chosen yet, or for a match of nobody', () => {
    const { db } = league();
    expect(proposalDays(db, BRAVO, null, NOW)).toHaveLength(14);
    expect(proposalDays(db, OUTSIDER, 3, NOW)).toHaveLength(14);
  });
});

describe('readMatchTime and searchSchedulableMatches', () => {
  it("reads a typed date and time in the league's time zone", () => {
    const { db } = league();
    expect(readMatchTime(db, BRAVO, ' 2026-11-05 ', '21:00')).toEqual({
      ok: true,
      at: THURSDAY_21H,
    });
    expect(readMatchTime(db, BRAVO, '05/11', '21:00')).toEqual({
      ok: false,
      error: 'invalid_date',
    });
  });

  it('offers staff the matches still to play, and nobody else anything', () => {
    const { db } = league();
    expect(searchSchedulableMatches(db, STAFF, '', 25).map((found) => found.id)).toEqual([3]);
    expect(searchSchedulableMatches(db, BRAVO, '', 25)).toEqual([]);
  });

  it('names the schedule channel where an agreed or staff-set time is announced', () => {
    const { db, propose } = league();
    const id = idOf(propose());
    expect(
      answerProposal(db, CHARLIE, { matchId: 3, proposalId: id, action: 'accept' }, NOW),
    ).toMatchObject({ scheduleChannelId: SCHEDULE });
    // An agreed time can still be changed by staff: the match is still to play.
    expect(setMatchTime(db, STAFF, { matchId: 3, at: THURSDAY_21H }, NOW)).toMatchObject({
      ok: true,
      scheduleChannelId: SCHEDULE,
    });
  });
});
