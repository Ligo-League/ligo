import { listLeagueMatches, schema } from '@ligo/db';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fakeEvidenceStore } from '../assets/evidence-store.ts';
import { fakeGateway } from '../discord/testing.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { matchRolesOf, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';
import { answerReport, reportResult, type ReportDetails } from './reports.ts';
import { fileRequest } from './requests.ts';
import { answerProposal, proposeTime } from './scheduling.ts';
import { matchMentions, setTeamOwner } from './team-staff.ts';
import { chooseVetoStep, startVeto } from './veto.ts';

// The captain acts for their roster in matches like its officials: proposes and accepts a time,
// runs the veto, reports and confirms a result. It is the captain's job by default, and an
// official can always do it too. The captain has no say over the team's officials (M-19,
// maintainer, 14 November 2026).

const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const member = (n: number): Actor => ({
  guildId: TEST_GUILD,
  user: { id: `70000000000000000${String(n)}`, displayName: `Member ${String(n)}` },
  memberRoleIds: [],
});
// Match 3 is Bravo (team 2, side A) v Charlie (team 3, side B), Ligue 1 week 3: Monday 2 to
// Sunday 8 November 2026. In its veto, Bravo bans first.
const BRAVO_OWNER = member(1);
const BRAVO_CAPTAIN = member(5);
const CHARLIE_CAPTAIN = member(6);
const NOW = Date.parse('2026-11-03T12:00:00Z');
const THURSDAY_21H = Date.parse('2026-11-05T20:00:00Z');

/** Bravo and Charlie each have a captain on their roster of match 3's season. */
function league() {
  const db = leagueDatabase();
  const [found] = listLeagueMatches(db, { matchId: 3 });
  if (!found) throw new Error('no match 3');
  const captain = (actor: Actor, teamId: number) => {
    const id = ensurePlayer(
      db,
      { orgId: 1, discordUserId: actor.user.id, displayName: actor.user.displayName },
      100,
    ).id;
    db.insert(schema.rosterEntry)
      .values({
        seasonId: found.seasonId,
        teamId,
        playerId: id,
        role: 'player',
        captain: true,
        validFrom: 100,
      })
      .run();
    return id;
  };
  const bravo = captain(BRAVO_CAPTAIN, 2);
  const charlie = captain(CHARLIE_CAPTAIN, 3);
  return { db, found, bravo, charlie };
}

describe('the captain in matches (M-19)', () => {
  it('proposes a time, and the other side’s captain is told and accepts it', () => {
    const { db } = league();
    const proposed = proposeTime(db, BRAVO_CAPTAIN, { matchId: 3, at: THURSDAY_21H }, NOW);
    expect(proposed).toMatchObject({ ok: true, side: 'a', opponentIds: [CHARLIE_CAPTAIN.user.id] });
    if (!proposed.ok) return;
    // Bravo's own captain cannot answer for Charlie.
    const request = { matchId: 3, proposalId: proposed.proposalId, action: 'accept' } as const;
    expect(answerProposal(db, BRAVO_CAPTAIN, request, NOW)).toMatchObject({ ok: false });
    expect(answerProposal(db, CHARLIE_CAPTAIN, request, NOW)).toMatchObject({ ok: true });
    expect(db.select().from(schema.match).where(eq(schema.match.id, 3)).get()?.scheduledAt).toBe(
      THURSDAY_21H,
    );
  });

  it('reports a result, and the other side’s captain confirms it', async () => {
    const { db, bravo, charlie } = league();
    db.update(schema.leagueGuild).set({ alertsChannelId: '800000000000000001' }).run();
    const reply = await reportResult(
      db,
      fakeGateway(),
      fakeEvidenceStore(),
      BRAVO_CAPTAIN,
      {
        matchId: 3,
        scoreA: 7,
        scoreB: 5,
        screenshot: {
          url: 'https://cdn.discordapp.com/attachments/1/2/score.png',
          contentType: 'image/png',
          size: 250_000,
        },
      },
      (report: ReportDetails) => ({ content: `queue ${String(report.match.id)}` }),
      9000,
    );
    expect(reply).toMatchObject({ ok: true, side: 'a', opponentIds: [CHARLIE_CAPTAIN.user.id] });
    if (!reply.ok) return;
    const answer = { matchId: 3, evidenceId: reply.evidenceId, action: 'confirm' } as const;
    // The reporting side cannot confirm its own result.
    expect(answerReport(db, BRAVO_CAPTAIN, answer, 9500)).toMatchObject({ ok: false });
    expect(answerReport(db, CHARLIE_CAPTAIN, answer, 9500)).toMatchObject({ ok: true });
    expect(db.select().from(schema.match).where(eq(schema.match.id, 3)).get()).toMatchObject({
      reportedBy: bravo,
      confirmedBy: charlie,
    });
  });

  it('starts the veto, is told of it, and plays their side’s turns only', () => {
    const { db } = league();
    const started = startVeto(db, CHARLIE_CAPTAIN, { matchId: 3 }, NOW, () => 'b');
    expect(started).toMatchObject({ ok: true });
    if (!started.ok) return;
    expect(started.mentionUserIds).toEqual([BRAVO_CAPTAIN.user.id, CHARLIE_CAPTAIN.user.id]);
    const state = started.view.state;
    if (state.status !== 'turn') throw new Error('the veto is over');
    const choice = { matchId: 3, step: state.step, choice: state.choices[0] ?? '' };
    expect(chooseVetoStep(db, CHARLIE_CAPTAIN, choice, NOW, () => 'a')).toEqual({
      ok: false,
      error: 'not_your_turn',
    });
    expect(chooseVetoStep(db, BRAVO_CAPTAIN, choice, NOW, () => 'a')).toMatchObject({ ok: true });
  });

  it('shares the match with the roster’s officials, who are all told', () => {
    const { db, found } = league();
    setTeamOwner(db, STAFF, { teamId: 2, member: BRAVO_OWNER.user }, 100);
    expect(proposeTime(db, BRAVO_OWNER, { matchId: 3, at: THURSDAY_21H }, NOW)).toMatchObject({
      ok: true,
      side: 'a',
    });
    expect(matchMentions(db, found)).toEqual([
      BRAVO_OWNER.user.id,
      BRAVO_CAPTAIN.user.id,
      CHARLIE_CAPTAIN.user.id,
    ]);
  });

  it('acts only in their roster’s season, and only while captain', () => {
    const { db, found, bravo } = league();
    expect(matchRolesOf(db, bravo, found.seasonId)).toEqual([
      { teamId: 2, clubId: expect.any(Number) as number, role: 'captain' },
    ]);
    expect(matchRolesOf(db, bravo, found.seasonId + 1)).toEqual([]);
    expect(matchRolesOf(db, bravo, null)).toEqual([]);

    // A captain who left the roster, or handed the captaincy over, acts no more.
    db.update(schema.rosterEntry)
      .set({ validTo: 200 })
      .where(and(eq(schema.rosterEntry.playerId, bravo), eq(schema.rosterEntry.teamId, 2)))
      .run();
    expect(proposeTime(db, BRAVO_CAPTAIN, { matchId: 3, at: THURSDAY_21H }, NOW)).toEqual({
      ok: false,
      error: 'no_team',
    });
    expect(matchMentions(db, found)).toEqual([CHARLIE_CAPTAIN.user.id]);
  });

  it('has no say over the team’s officials', () => {
    const { db } = league();
    expect(
      fileRequest(
        db,
        BRAVO_CAPTAIN,
        { kind: 'team_member_add', member: member(7).user, role: 'manager', teamId: 2, note: null },
        NOW,
      ),
    ).toEqual({ ok: false, error: 'not_official' });
  });
});
