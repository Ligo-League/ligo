import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import type { Actor } from './permissions.ts';
import { recordQueuePost } from './queue-posts.ts';
import {
  answerRequest,
  fileRequest,
  listRequests,
  runRequestTick,
  submitTeamChange,
  teamChoices,
  teamOfficials,
  withdrawRequest,
  type RequestInput,
} from './requests.ts';
import { addTeamMember, listTeamStaff, setTeamOwner } from './team-staff.ts';

const { auditLog, leagueGuild, request } = schema;

const QUEUE = '900000000000000001';
const HOUR = 3_600_000;
const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const person = (n: number) => ({ id: `70000000000000000${n}`, displayName: `Member ${n}` });
const as = (n: number): Actor => ({ guildId: TEST_GUILD, user: person(n), memberRoleIds: [] });
// In leagueDatabase(), team 1 is Alpha Esport (ALP) and team 2 Bravo, both in Ligue 1.
const ALPHA = 1;
const BRAVO = 2;
const OWNER = 1;
const MANAGER = 2;
const COACH = 3;

/** Alpha with an owner, a manager and a coach, and a staff queue. */
function league() {
  const db = leagueDatabase();
  db.update(leagueGuild).set({ alertsChannelId: QUEUE }).run();
  setTeamOwner(db, STAFF, { teamId: ALPHA, member: person(OWNER) }, 100);
  addTeamMember(db, STAFF, { teamId: ALPHA, member: person(MANAGER), role: 'manager' }, 100);
  addTeamMember(db, STAFF, { teamId: ALPHA, member: person(COACH), role: 'coach' }, 100);
  return db;
}
const rolesOf = (db: ReturnType<typeof leagueDatabase>, teamId = ALPHA) =>
  listTeamStaff(db, teamId).map((member) => [member.displayName, member.role]);
const add = (n: number, role: 'manager' | 'coach' = 'coach'): RequestInput => ({
  kind: 'team_member_add',
  member: person(n),
  role,
  teamId: null,
  note: null,
});
const remove = (n: number | null): RequestInput => ({
  kind: 'team_member_remove',
  member: n === null ? null : person(n),
  teamId: null,
  note: null,
});

describe('fileRequest', () => {
  it('lets a manager ask to add a coach: it waits for staff, and the team is unchanged', () => {
    const db = league();
    db.update(schema.competition)
      .set({ rulesetJson: { ...rulesetOf(db), team_roles: { managers_max: 3, coaches_max: 2 } } })
      .run();
    const reply = fileRequest(db, as(MANAGER), { ...add(5), note: '  Notre nouveau coach ' }, 1000);
    expect(reply).toMatchObject({
      ok: true,
      applied: false,
      queueChannelId: QUEUE,
      request: {
        kind: 'team_member_add',
        role: 'coach',
        status: 'pending',
        approval: 'staff',
        team: { teamId: ALPHA, tag: 'ALP' },
        subject: { displayName: 'Member 5' },
        requester: { displayName: 'Member 2' },
        note: 'Notre nouveau coach',
        deadline: 1000 + 24 * HOUR,
      },
    });
    expect(rolesOf(db)).toHaveLength(3);
  });

  it('applies at once when the owner removes someone, or someone leaves', () => {
    const db = league();
    expect(fileRequest(db, as(OWNER), remove(COACH), 1000)).toMatchObject({
      ok: true,
      applied: true,
      request: { status: 'approved', approval: 'auto' },
    });
    expect(fileRequest(db, as(MANAGER), remove(null), 1001)).toMatchObject({
      ok: true,
      applied: true,
    });
    expect(rolesOf(db)).toEqual([['Member 1', 'owner']]);
    const actions = db
      .select()
      .from(auditLog)
      .all()
      .map((entry) => entry.action);
    expect(actions.filter((action) => action === 'team.member.remove')).toHaveLength(2);
  });

  it('refuses what the team rules forbid', () => {
    const db = league();
    expect(fileRequest(db, as(COACH), add(5), 1)).toEqual({ ok: false, error: 'not_allowed' });
    expect(fileRequest(db, as(MANAGER), remove(COACH), 1)).toEqual({
      ok: false,
      error: 'owner_only',
    });
    expect(fileRequest(db, as(OWNER), remove(null), 1)).toEqual({
      ok: false,
      error: 'owner_cannot_leave',
    });
    expect(fileRequest(db, as(OWNER), add(MANAGER), 1)).toEqual({
      ok: false,
      error: 'already_on_team',
    });
    // Alpha already has its one coach.
    expect(fileRequest(db, as(OWNER), add(5), 1)).toEqual({
      ok: false,
      error: 'role_full',
      max: 1,
    });
    expect(fileRequest(db, as(OWNER), remove(9), 1)).toEqual({ ok: false, error: 'not_on_team' });
    expect(fileRequest(db, as(9), add(5, 'manager'), 1)).toEqual({
      ok: false,
      error: 'not_official',
    });
    expect(db.select().from(request).all()).toEqual([]);
  });

  it('asks which team when the member acts for several, and refuses one they do not', () => {
    const db = league();
    setTeamOwner(db, STAFF, { teamId: BRAVO, member: person(OWNER) }, 100);
    expect(fileRequest(db, as(OWNER), add(5, 'manager'), 1)).toEqual({
      ok: false,
      error: 'team_required',
    });
    expect(fileRequest(db, as(MANAGER), { ...add(5, 'manager'), teamId: BRAVO }, 1)).toEqual({
      ok: false,
      error: 'not_official',
    });
    expect(fileRequest(db, as(OWNER), { ...add(5, 'manager'), teamId: BRAVO }, 1)).toMatchObject({
      ok: true,
      request: { team: { teamId: BRAVO } },
    });
  });

  it('refuses the same request twice while it waits, and needs a staff queue', () => {
    const db = league();
    expect(fileRequest(db, as(OWNER), add(5, 'manager'), 1).ok).toBe(true);
    expect(fileRequest(db, as(MANAGER), add(5, 'manager'), 2)).toEqual({
      ok: false,
      error: 'already_requested',
    });
    db.update(leagueGuild).set({ alertsChannelId: null }).run();
    expect(fileRequest(db, as(OWNER), add(6, 'manager'), 3)).toEqual({
      ok: false,
      error: 'queue_not_set',
    });
  });
});

describe('answerRequest', () => {
  it('applies an approved request, audited, and names who to tell', () => {
    const db = league();
    const filed = fileRequest(db, as(MANAGER), add(5, 'manager'), 1000);
    if (!filed.ok) throw new Error(filed.error);
    const reply = answerRequest(
      db,
      STAFF,
      { requestId: filed.request.id, decision: 'approve', reason: null },
      2000,
    );
    expect(reply).toMatchObject({
      ok: true,
      request: { status: 'approved', decidedBy: { displayName: 'Léa Staff' } },
      recipientIds: [person(MANAGER).id, person(OWNER).id, person(5).id],
    });
    expect(rolesOf(db)).toContainEqual(['Member 5', 'manager']);
    const entries = db.select().from(auditLog).all();
    expect(entries.map((entry) => entry.action).slice(-2)).toEqual([
      'team.member.add',
      'request.approve',
    ]);
    expect(entries.at(-2)?.afterJson).toMatchObject({ requestId: filed.request.id });
  });

  it('refuses with a reason, which is required, and decides once', () => {
    const db = league();
    const filed = fileRequest(db, as(OWNER), add(5, 'manager'), 1000);
    if (!filed.ok) throw new Error(filed.error);
    const answer = (decision: 'approve' | 'reject', reason: string | null) =>
      answerRequest(db, STAFF, { requestId: filed.request.id, decision, reason }, 2000);
    expect(answer('reject', '  ')).toEqual({ ok: false, error: 'reason_required' });
    expect(answer('reject', 'Hors mercato')).toMatchObject({
      ok: true,
      request: { status: 'rejected', reason: 'Hors mercato' },
    });
    expect(answer('approve', null)).toEqual({ ok: false, error: 'not_pending' });
    expect(rolesOf(db)).toHaveLength(3);
  });

  it('checks the team again: a limit reached since then leaves the request waiting', () => {
    const db = league();
    const filed = fileRequest(db, as(OWNER), add(5, 'manager'), 1000);
    if (!filed.ok) throw new Error(filed.error);
    for (const n of [6, 7]) {
      addTeamMember(db, STAFF, { teamId: ALPHA, member: person(n), role: 'manager' }, 1500);
    }
    expect(
      answerRequest(
        db,
        STAFF,
        { requestId: filed.request.id, decision: 'approve', reason: null },
        2000,
      ),
    ).toEqual({ ok: false, error: 'role_full', max: 3 });
    expect(db.select().from(request).get()?.status).toBe('pending');
  });

  it('hands the team over: the previous owner leaves it', () => {
    const db = league();
    const filed = fileRequest(
      db,
      as(OWNER),
      { kind: 'team_owner', member: person(MANAGER), teamId: null, note: null },
      1000,
    );
    if (!filed.ok) throw new Error(filed.error);
    expect(
      fileRequest(
        db,
        as(MANAGER),
        { kind: 'team_owner', member: person(5), teamId: null, note: null },
        1,
      ),
    ).toEqual({
      ok: false,
      error: 'owner_only',
    });
    answerRequest(
      db,
      STAFF,
      { requestId: filed.request.id, decision: 'approve', reason: null },
      2000,
    );
    expect(rolesOf(db)).toEqual([
      ['Member 2', 'owner'],
      ['Member 3', 'coach'],
    ]);
  });

  it('is for league staff only, and only for their league', () => {
    const db = league();
    const filed = fileRequest(db, as(OWNER), add(5, 'manager'), 1000);
    if (!filed.ok) throw new Error(filed.error);
    const input = { requestId: filed.request.id, decision: 'approve', reason: null } as const;
    expect(answerRequest(db, as(OWNER), input, 2)).toEqual({ ok: false, error: 'not_staff' });
    expect(answerRequest(db, STAFF, { ...input, requestId: 99 }, 2)).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});

describe('withdrawRequest', () => {
  it('lets whoever asked, or the owner, take a waiting request back', () => {
    const db = league();
    const first = fileRequest(db, as(MANAGER), add(5, 'manager'), 1000);
    const second = fileRequest(db, as(MANAGER), add(6, 'manager'), 1000);
    if (!first.ok || !second.ok) throw new Error('not filed');
    expect(withdrawRequest(db, as(COACH), { requestId: first.request.id }, 2)).toEqual({
      ok: false,
      error: 'not_yours',
    });
    expect(withdrawRequest(db, as(MANAGER), { requestId: first.request.id }, 2)).toMatchObject({
      ok: true,
      request: { status: 'withdrawn' },
    });
    expect(withdrawRequest(db, as(OWNER), { requestId: second.request.id }, 2).ok).toBe(true);
    expect(withdrawRequest(db, as(OWNER), { requestId: second.request.id }, 3)).toEqual({
      ok: false,
      error: 'not_pending',
    });
  });

  it('returns the posts in the staff queue, to mark them as handled', () => {
    const db = league();
    const filed = fileRequest(db, as(OWNER), add(5, 'manager'), 1000);
    if (!filed.ok) throw new Error(filed.error);
    const post = { channelId: QUEUE, messageId: '123' };
    recordQueuePost(db, { entity: 'request', entityId: filed.request.id }, post, 1000);
    expect(withdrawRequest(db, as(OWNER), { requestId: filed.request.id }, 2)).toMatchObject({
      posts: [post],
    });
  });
});

describe('listRequests', () => {
  it('shows staff every waiting request, and officials their own team’s', () => {
    const db = league();
    setTeamOwner(db, STAFF, { teamId: BRAVO, member: person(8) }, 100);
    fileRequest(db, as(OWNER), add(5, 'manager'), 1000);
    fileRequest(db, as(8), add(6, 'manager'), 2000);
    fileRequest(db, as(OWNER), remove(COACH), 3000);
    const ids = (reply: ReturnType<typeof listRequests>) =>
      reply.ok ? reply.requests.map((entry) => entry.subject.displayName) : reply.error;
    expect(ids(listRequests(db, STAFF, null))).toEqual(['Member 5', 'Member 6']);
    expect(ids(listRequests(db, STAFF, BRAVO))).toEqual(['Member 6']);
    expect(ids(listRequests(db, as(MANAGER), null))).toEqual(['Member 5']);
    expect(ids(listRequests(db, as(9), null))).toBe('not_official');
  });
});

describe('submitTeamChange', () => {
  it('changes the team directly for league staff, and files a request for its officials', () => {
    const db = league();
    expect(submitTeamChange(db, STAFF, { ...add(5, 'manager'), teamId: ALPHA }, 1)).toMatchObject({
      mode: 'direct',
      reply: { ok: true },
    });
    expect(submitTeamChange(db, STAFF, add(6, 'manager'), 1)).toEqual({
      mode: 'direct',
      reply: { ok: false, error: 'team_required' },
    });
    expect(submitTeamChange(db, as(OWNER), add(6, 'manager'), 1)).toMatchObject({
      mode: 'request',
      reply: { ok: true, applied: false },
    });
    expect(rolesOf(db)).toContainEqual(['Member 5', 'manager']);
  });
});

describe('teamChoices and teamOfficials', () => {
  it('offers league staff every team, and officials their own', () => {
    const db = league();
    expect(teamChoices(db, STAFF, '', 25)).toHaveLength(5);
    expect(teamChoices(db, as(MANAGER), '', 25).map((t) => t.tag)).toEqual(['ALP']);
    expect(teamChoices(db, as(9), '', 25)).toEqual([]);
    expect(teamOfficials(db, as(COACH), null)).toMatchObject({ ok: true, team: { tag: 'ALP' } });
    expect(teamOfficials(db, as(COACH), BRAVO)).toEqual({ ok: false, error: 'not_official' });
    expect(teamOfficials(db, STAFF, BRAVO)).toMatchObject({ ok: true, members: [] });
  });
});

describe('runRequestTick', () => {
  it('reminds staff once, 6 hours before the deadline, of a request still waiting', () => {
    const db = league();
    const filed = fileRequest(db, as(OWNER), add(5, 'manager'), 0);
    fileRequest(db, as(OWNER), remove(COACH), 0);
    if (!filed.ok) throw new Error(filed.error);
    expect(runRequestTick(db, 18 * HOUR - 1)).toEqual([]);
    expect(runRequestTick(db, 18 * HOUR)).toMatchObject([
      {
        request: { id: filed.request.id },
        guildId: TEST_GUILD,
        queueChannelId: QUEUE,
        staffRoleId: TEST_STAFF_ROLE,
        post: null,
      },
    ]);
    expect(runRequestTick(db, 30 * HOUR)).toEqual([]);
  });

  it('skips a request answered in time', () => {
    const db = league();
    const filed = fileRequest(db, as(OWNER), add(5, 'manager'), 0);
    if (!filed.ok) throw new Error(filed.error);
    answerRequest(db, STAFF, { requestId: filed.request.id, decision: 'approve', reason: null }, 1);
    expect(runRequestTick(db, 30 * HOUR)).toEqual([]);
  });
});

function rulesetOf(db: ReturnType<typeof leagueDatabase>) {
  const row = db.select().from(schema.competition).get();
  if (!row) throw new Error('No competition');
  return row.rulesetJson;
}
