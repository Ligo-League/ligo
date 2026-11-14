import { findLeague, schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { fakeGateway } from '../discord/testing.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import type { Actor } from './permissions.ts';
import { answerReport, reportResult, validateResult } from './reports.ts';
import { answerRequest, fileRequest } from './requests.ts';
import { staffQueue } from './staff-queue.ts';
import { setTeamOwner } from './team-staff.ts';

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
// In leagueDatabase(), match 3 is Bravo (team 2, side A) v Charlie (team 3), still to play.
const BRAVO = member(1);
const CHARLIE = member(2);
const SCREENSHOT = {
  url: 'https://cdn.discordapp.com/attachments/1/2/score.png?ex=1&is=2&hm=3',
  contentType: 'image/png',
  size: 1000,
};

function league() {
  const db = leagueDatabase();
  setTeamOwner(db, STAFF, { teamId: 2, member: BRAVO.user }, 100);
  setTeamOwner(db, STAFF, { teamId: 3, member: CHARLIE.user }, 100);
  db.update(schema.leagueGuild).set({ alertsChannelId: '800000000000000001' }).run();
  const queue = () => {
    const found = findLeague(db, 1);
    if (!found) throw new Error('No league');
    return staffQueue(db, found);
  };
  const report = async () => {
    const reply = await reportResult(
      db,
      fakeGateway(),
      BRAVO,
      { matchId: 3, scoreA: 7, scoreB: 5, screenshot: SCREENSHOT },
      () => ({ content: 'queue' }),
      9000,
    );
    if (!reply.ok) throw new Error(reply.error);
    return reply.evidenceId;
  };
  return { db, queue, report };
}

describe('staffQueue', () => {
  it('is empty while nothing waits', () => {
    expect(league().queue()).toEqual({ reports: [], disputed: [], requests: [] });
  });

  it('lists a reported result with its screenshot and who reported it, until validated', async () => {
    const { db, queue, report } = league();
    const evidenceId = await report();
    expect(queue().reports).toMatchObject([
      {
        match: { id: 3, status: 'reported', game: { scoreA: 7, scoreB: 5 } },
        evidence: { id: evidenceId, at: 9000 },
        reportedBy: 'Member 1',
        reportingTeam: 'Bravo',
        disputes: [],
      },
    ]);
    // The bot's post in the staff queue keeps the screenshot: the upload's address expires.
    expect(queue().reports[0]?.evidence?.url).toMatch(/^https:\/\/discord\.com\/channels\//);

    answerReport(db, CHARLIE, { matchId: 3, evidenceId, action: 'confirm' }, 9100);
    expect(queue().reports).toMatchObject([{ match: { status: 'confirmed' } }]);

    validateResult(db, STAFF, { matchId: 3, evidenceId }, 9200);
    expect(queue()).toEqual({ reports: [], disputed: [], requests: [] });
  });

  it('lists a disputed result apart, with the reason and the team’s words', async () => {
    const { db, queue, report } = league();
    const evidenceId = await report();
    answerReport(
      db,
      CHARLIE,
      { matchId: 3, evidenceId, action: 'dispute', reason: 'wrong_score', details: 'Faux.' },
      9100,
    );
    const { reports, disputed } = queue();
    expect(reports).toEqual([]);
    expect(disputed).toMatchObject([
      {
        match: { id: 3, status: 'disputed' },
        disputes: [
          {
            reason: 'wrong_score',
            label: { fr: expect.any(String) as string },
            details: 'Faux.',
            raisedBy: 'Member 2',
            at: 9100,
          },
        ],
      },
    ]);
  });

  it('lists the requests waiting for staff, oldest first, and drops answered ones', () => {
    const { db, queue } = league();
    const add = (n: number, at: number) =>
      fileRequest(
        db,
        BRAVO,
        {
          kind: 'team_member_add',
          member: member(n).user,
          role: 'manager',
          teamId: null,
          note: null,
        },
        at,
      );
    const late = add(6, 2000);
    const early = add(5, 1000);
    if (!late.ok || !early.ok) throw new Error('Not filed');
    expect(queue().requests.map((request) => request.id)).toEqual([
      early.request.id,
      late.request.id,
    ]);
    answerRequest(
      db,
      STAFF,
      { requestId: early.request.id, decision: 'approve', reason: null },
      3000,
    );
    expect(queue().requests.map((request) => request.id)).toEqual([late.request.id]);
  });
});
