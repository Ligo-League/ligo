import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { fakeGateway } from '../discord/testing.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import type { Actor } from './permissions.ts';
import {
  answerReport,
  checkDispute,
  checkReport,
  rejectResult,
  reportResult,
  searchMatchesForStaff,
  searchReportableMatches,
  validateResult,
  voidMatch,
  type ReportDetails,
  type ReportRequest,
} from './reports.ts';
import { recordForfeit } from './forfeits.ts';
import { recordResult } from './results.ts';
import { getStandings } from './standings.ts';
import { addTeamMember, setTeamOwner } from './team-staff.ts';

const { auditLog, competition, dispute, evidence, game, leagueGuild, match } = schema;

const QUEUE = '800000000000000001';
const RESULTS = '800000000000000002';
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
// In leagueDatabase(): match 3 is Bravo (team 2, side A) v Charlie (team 3, side B), to play.
const BRAVO_MANAGER = member(1);
const CHARLIE_MANAGER = member(2);
const CHARLIE_STAFF = member(3);
const OUTSIDER = member(4);
// Manages Xray (team 4, Ligue 2), which does not play match 3.
const XRAY_MANAGER = member(5);
const SCREENSHOT = {
  url: 'https://cdn.discordapp.com/attachments/1/2/score.png?ex=abc&is=def&hm=123',
  contentType: 'image/png',
  size: 250_000,
};
const REQUEST = { matchId: 3, scoreA: 7, scoreB: 5, screenshot: SCREENSHOT };
const DISPUTE = { action: 'dispute', reason: 'wrong_score', details: null } as const;
const queueMessage = (report: ReportDetails) => ({
  content: `queue ${report.match.id} ${report.scoreA}-${report.scoreB} #${report.evidenceId}`,
});

function league() {
  const db = leagueDatabase();
  setTeamOwner(db, STAFF, { teamId: 2, member: BRAVO_MANAGER.user }, 100);
  setTeamOwner(db, STAFF, { teamId: 3, member: CHARLIE_MANAGER.user }, 100);
  addTeamMember(db, STAFF, { teamId: 3, member: CHARLIE_STAFF.user, role: 'manager' }, 100);
  setTeamOwner(db, STAFF, { teamId: 4, member: XRAY_MANAGER.user }, 100);
  db.update(leagueGuild).set({ alertsChannelId: QUEUE, resultsChannelId: RESULTS }).run();
  const gateway = fakeGateway();
  const report = (actor: Actor = BRAVO_MANAGER, request: ReportRequest = REQUEST, now = 9000) =>
    reportResult(db, gateway, actor, request, queueMessage, now);
  const stored = () => db.select().from(match).all()[2];
  const dump = () => db.$client.serialize().toString('base64');
  return { db, gateway, report, stored, dump };
}
const evidenceIdOf = async (report: ReturnType<typeof league>['report']) => {
  const reply = await report();
  if (!reply.ok) throw new Error(reply.error);
  return reply.evidenceId;
};
const pointsOf = (db: ReturnType<typeof leagueDatabase>) => {
  const standings = getStandings(db, { guildId: TEST_GUILD, division: 'L1' });
  if (!standings.ok) throw new Error(standings.error);
  return Object.fromEntries(
    (standings.tables[0]?.rows ?? []).map((row) => [row.team.tag, row.points]),
  );
};

describe('reportResult', () => {
  it('stores the report without making it count', async () => {
    const { db, report, stored } = league();
    const reply = await report();

    expect(reply).toMatchObject({
      ok: true,
      queued: true,
      side: 'a',
      scoreA: 7,
      scoreB: 5,
      match: { id: 3, a: { tag: 'BRV' }, b: { tag: 'CHA' } },
    });
    expect(stored()).toMatchObject({ status: 'reported', validatedAt: null, confirmedBy: null });
    expect(stored()?.reportedBy).not.toBeNull();
    expect(db.select().from(game).all().at(-1)).toMatchObject({
      matchId: 3,
      scoreA: 7,
      scoreB: 5,
      status: 'pending',
    });
    expect(pointsOf(db)).toEqual({ ALP: 6, CHA: 0, BRV: 0 });
  });

  it('names the other team as the ones who may confirm', async () => {
    const reply = await league().report();
    expect(reply.ok && reply.opponents.map((entry) => [entry.displayName, entry.role])).toEqual([
      ['Member 2', 'owner'],
      ['Member 3', 'manager'],
    ]);
    const fromB = await league().report(CHARLIE_STAFF);
    expect(fromB).toMatchObject({ ok: true, side: 'b', opponents: [{ displayName: 'Member 1' }] });
  });

  it('posts the screenshot in the staff queue and keeps that post as the evidence', async () => {
    const { db, gateway, report } = league();
    const reply = await report();

    expect(gateway.downloads).toEqual([SCREENSHOT.url]);
    expect(gateway.posted).toMatchObject([
      {
        channelId: QUEUE,
        message: { content: 'queue 3 7-5 #1', files: [{ name: 'score-3.png' }] },
      },
    ]);
    const [row] = db.select().from(evidence).all();
    expect(row).toMatchObject({
      matchId: 3,
      kind: 'score_screenshot',
      visibility: 'teams',
      url: `https://discord.com/channels/1/${QUEUE}/${gateway.posted[0]?.messageId}`,
      at: 9000,
    });
    expect(reply.ok && reply.evidenceId).toBe(row?.id);
  });

  it('audits the report without the screenshot address', async () => {
    const { db, report } = league();
    await report();
    const entry = db.select().from(auditLog).all().at(-1);
    expect(entry).toMatchObject({
      actorKind: 'user',
      action: 'match.report',
      entity: 'match',
      entityId: '3',
      beforeJson: { status: 'scheduled' },
      afterJson: { status: 'reported', side: 'a', scoreA: 7, scoreB: 5, evidenceId: 1 },
    });
    expect(JSON.stringify(entry)).not.toContain('discordapp');
  });

  it('keeps the report when the staff queue cannot be reached, and says so', async () => {
    const { db, gateway, report, stored } = league();
    const original = gateway.postMessage.bind(gateway);
    gateway.postMessage = () => Promise.reject(new Error('missing access'));
    expect(await report()).toMatchObject({ ok: true, queued: false });
    expect(stored()?.status).toBe('reported');
    expect(db.select().from(evidence).get()?.url).toBe(SCREENSHOT.url);
    gateway.postMessage = original;
  });

  it('stores nothing when the screenshot cannot be downloaded', async () => {
    const { gateway, report, dump } = league();
    const before = dump();
    gateway.failing = true;
    expect(await report()).toEqual({ ok: false, error: 'screenshot_unreadable' });
    expect(dump()).toBe(before);
  });

  describe('refusals change nothing and reach neither Discord nor the queue', () => {
    it.each([
      ['someone who manages no team', OUTSIDER, REQUEST, 'no_team'],
      ['league staff who manage no team', STAFF, REQUEST, 'no_team'],
      ['the manager of a team not in this match', XRAY_MANAGER, REQUEST, 'not_your_match'],
      ['a server that is not linked', { ...BRAVO_MANAGER, guildId: null }, REQUEST, 'not_linked'],
      ['an unknown match', BRAVO_MANAGER, { ...REQUEST, matchId: 99 }, 'match_not_found'],
      ['a match already validated', BRAVO_MANAGER, { ...REQUEST, matchId: 1 }, 'not_reportable'],
      ['a draw', BRAVO_MANAGER, { ...REQUEST, scoreA: 6, scoreB: 6 }, 'invalid_score'],
      ['no screenshot', BRAVO_MANAGER, { ...REQUEST, screenshot: null }, 'screenshot_required'],
      [
        'a file that is not an image',
        BRAVO_MANAGER,
        { ...REQUEST, screenshot: { ...SCREENSHOT, contentType: 'application/pdf' } },
        'invalid_screenshot',
      ],
    ] as const)('%s', async (_name, actor, request, error) => {
      const { gateway, report, dump } = league();
      const before = dump();
      expect(await report(actor, request)).toEqual({ ok: false, error });
      expect(dump()).toBe(before);
      expect(gateway.downloads).toEqual([]);
      expect(gateway.posted).toEqual([]);
    });

    it('a score a map cannot end on, with the rule', async () => {
      const { report } = league();
      expect(await report(BRAVO_MANAGER, { ...REQUEST, scoreA: 7, scoreB: 6 })).toEqual({
        ok: false,
        error: 'impossible_score',
        rule: { win_at: 7, overtime_rounds: 3 },
      });
    });

    it('a league whose staff queue is not set', async () => {
      const { db, report } = league();
      db.update(leagueGuild).set({ alertsChannelId: null }).run();
      expect(await report()).toEqual({ ok: false, error: 'queue_not_set' });
    });

    it('a second report while the first awaits an answer', async () => {
      const { report } = league();
      await report();
      expect(await report(CHARLIE_MANAGER)).toEqual({ ok: false, error: 'not_reportable' });
    });
  });

  it('checkReport gives the same verdict without writing', () => {
    const { db, dump } = league();
    const before = dump();
    expect(checkReport(db, BRAVO_MANAGER, REQUEST)).toMatchObject({ ok: true, side: 'a' });
    expect(checkReport(db, OUTSIDER, REQUEST)).toEqual({ ok: false, error: 'no_team' });
    expect(dump()).toBe(before);
  });
});

describe('answerReport', () => {
  it('lets the other team confirm, by its manager or its staff', async () => {
    for (const actor of [CHARLIE_MANAGER, CHARLIE_STAFF]) {
      const { db, report, stored } = league();
      const evidenceId = await evidenceIdOf(report);
      const reply = answerReport(db, actor, { matchId: 3, evidenceId, action: 'confirm' }, 9500);
      expect(reply).toMatchObject({ ok: true, status: 'confirmed', queueChannelId: QUEUE });
      expect(stored()).toMatchObject({ status: 'confirmed', validatedAt: null });
      expect(stored()?.confirmedBy).not.toBeNull();
      // Confirmed is not validated: the result still does not count in LFR.
      expect(pointsOf(db)).toEqual({ ALP: 6, CHA: 0, BRV: 0 });
    }
  });

  it('lets the other team dispute with a reason, which leaves the decision to staff', async () => {
    const { db, report, stored } = league();
    const evidenceId = await evidenceIdOf(report);
    const request = { matchId: 3, evidenceId, ...DISPUTE, details: '  On a gagné 7-5, pas 5-7.  ' };
    expect(answerReport(db, CHARLIE_MANAGER, request, 9500)).toMatchObject({
      ok: true,
      status: 'disputed',
      dispute: {
        reason: 'wrong_score',
        label: { fr: 'Score incorrect', en: 'Wrong score' },
        details: 'On a gagné 7-5, pas 5-7.',
      },
    });
    expect(stored()).toMatchObject({ status: 'disputed', confirmedBy: null });
    expect(db.select().from(dispute).all()).toMatchObject([
      {
        matchId: 3,
        evidenceId,
        reason: 'wrong_score',
        details: 'On a gagné 7-5, pas 5-7.',
        at: 9500,
        resolution: null,
      },
    ]);
    // The details can accuse someone: they stay in the dispute row, out of the general log.
    const audit = db.select().from(auditLog).all().at(-1);
    expect(audit).toMatchObject({
      action: 'match.dispute',
      beforeJson: { status: 'reported' },
      afterJson: { status: 'disputed', reason: 'wrong_score' },
    });
    expect(JSON.stringify(audit)).not.toContain('On a gagné');
  });

  it('takes "other" only with details, and keeps details within the limit', async () => {
    const answer = async (reason: string, details: string | null) => {
      const { db, report, dump } = league();
      const evidenceId = await evidenceIdOf(report);
      const before = dump();
      const reply = answerReport(
        db,
        CHARLIE_MANAGER,
        { matchId: 3, evidenceId, action: 'dispute', reason, details },
        9500,
      );
      if (!reply.ok) expect(dump()).toBe(before);
      return reply.ok ? reply.dispute : reply.error;
    };
    expect(await answer('other', 'Ils ont joué à six.')).toEqual({
      id: 1,
      reason: 'other',
      label: null,
      details: 'Ils ont joué à six.',
    });
    expect(await answer('other', null)).toBe('details_required');
    expect(await answer('other', '   ')).toBe('details_required');
    expect(await answer('not_played', null)).toMatchObject({ reason: 'not_played', details: null });
    expect(await answer('cheating', 'x')).toBe('reason_unknown');
    expect(await answer('wrong_score', 'x'.repeat(1001))).toBe('details_too_long');
    expect(await answer('wrong_score', 'x'.repeat(1000))).toMatchObject({ reason: 'wrong_score' });
  });

  it("offers the league's reasons before the form opens, and checks the same as a dispute", async () => {
    const { db, report, dump } = league();
    const evidenceId = await evidenceIdOf(report);
    const before = dump();
    const allowed = checkDispute(db, CHARLIE_MANAGER, { matchId: 3, evidenceId });
    expect(allowed.ok && allowed.reasons.map((reason) => reason.key)).toEqual([
      'wrong_score',
      'screenshot',
      'ineligible_player',
      'not_played',
      'technical',
    ]);
    expect(checkDispute(db, BRAVO_MANAGER, { matchId: 3, evidenceId })).toEqual({
      ok: false,
      error: 'not_opponent',
    });
    expect(checkDispute(db, CHARLIE_MANAGER, { matchId: 3, evidenceId: 999 })).toEqual({
      ok: false,
      error: 'stale',
    });
    expect(dump()).toBe(before);
  });

  it('closes a dispute with the staff decision that ends it, and who took it', async () => {
    const settled = async (decide: (db: ReturnType<typeof leagueDatabase>) => unknown) => {
      const { db, report } = league();
      const evidenceId = await evidenceIdOf(report);
      answerReport(db, CHARLIE_MANAGER, { matchId: 3, evidenceId, ...DISPUTE }, 9500);
      decide(db);
      return db.select().from(dispute).all();
    };
    expect(await settled((db) => validateResult(db, STAFF, { matchId: 3 }, 9600))).toMatchObject([
      { resolution: 'validated', resolvedAt: 9600 },
    ]);
    expect(await settled((db) => rejectResult(db, STAFF, { matchId: 3 }, 9600))).toMatchObject([
      { resolution: 'rejected' },
    ]);
    expect(
      await settled((db) => voidMatch(db, STAFF, { matchId: 3, reason: 'Rejoué' }, 9600)),
    ).toMatchObject([{ resolution: 'voided' }]);
    expect(
      await settled((db) => recordResult(db, STAFF, { matchId: 3, scoreA: 5, scoreB: 7 }, 9600)),
    ).toMatchObject([{ resolution: 'result_entered' }]);
    expect(
      await settled((db) =>
        recordForfeit(
          db,
          STAFF,
          { matchId: 3, side: 'a', warningReason: () => 'x', exclusionReason: () => 'x' },
          9600,
        ),
      ),
    ).toMatchObject([{ resolution: 'forfeit' }]);
    const [row] = await settled((db) => validateResult(db, STAFF, { matchId: 3 }, 9600));
    expect(row?.resolvedBy).not.toBeNull();
    expect(row?.resolvedBy).not.toBe(row?.raisedBy);
  });

  it('validates on confirmation where the league lets the opponent validate', async () => {
    const { db, report, stored } = league();
    const [settings] = db.select().from(competition).all();
    if (!settings) throw new Error('No competition');
    db.update(competition)
      .set({ rulesetJson: { ...settings.rulesetJson, result_validation: 'opponent' } })
      .run();
    const evidenceId = await evidenceIdOf(report);

    expect(
      answerReport(db, CHARLIE_MANAGER, { matchId: 3, evidenceId, action: 'confirm' }, 9500),
    ).toMatchObject({ ok: true, status: 'validated', resultsChannelId: RESULTS });
    expect(stored()).toMatchObject({ status: 'validated', validatedAt: 9500, validatedBy: null });
    expect(db.select().from(game).all().at(-1)?.status).toBe('final');
    expect(pointsOf(db)).toEqual({ ALP: 6, BRV: 3, CHA: 0 });
  });

  it.each([
    ['the team that reported', BRAVO_MANAGER, 'not_opponent'],
    ['someone on neither team', OUTSIDER, 'not_your_match'],
    ['league staff who are on neither team', STAFF, 'not_your_match'],
    ['a server that is not linked', { ...CHARLIE_MANAGER, guildId: null }, 'not_linked'],
  ] as const)('refuses %s, for confirming and for disputing', async (_name, actor, error) => {
    for (const action of ['confirm', 'dispute'] as const) {
      const { db, report, dump } = league();
      const evidenceId = await evidenceIdOf(report);
      const before = dump();
      const request = action === 'confirm' ? { action } : DISPUTE;
      expect(answerReport(db, actor, { matchId: 3, evidenceId, ...request }, 9500)).toEqual({
        ok: false,
        error,
      });
      expect(dump()).toBe(before);
    }
  });

  it('refuses a button of an older report, a second answer and an unknown match', async () => {
    const { db, report } = league();
    const first = await evidenceIdOf(report);
    rejectResult(db, STAFF, { matchId: 3 }, 9100);
    const second = await evidenceIdOf(report);
    const answer = (evidenceId: number, matchId = 3) =>
      answerReport(db, CHARLIE_MANAGER, { matchId, evidenceId, action: 'confirm' }, 9500);

    expect(second).not.toBe(first);
    expect(answer(first)).toEqual({ ok: false, error: 'stale' });
    expect(answer(second).ok).toBe(true);
    expect(answer(second)).toEqual({ ok: false, error: 'wrong_status' });
    expect(answer(second, 99)).toEqual({ ok: false, error: 'match_not_found' });
  });

  it('lets someone who manages both teams confirm their own report', async () => {
    const { db, report } = league();
    setTeamOwner(db, STAFF, { teamId: 3, member: BRAVO_MANAGER.user }, 200);
    const evidenceId = await evidenceIdOf(report);
    expect(
      answerReport(db, BRAVO_MANAGER, { matchId: 3, evidenceId, action: 'confirm' }, 9500).ok,
    ).toBe(true);
  });
});

describe('validateResult and rejectResult', () => {
  it.each(['reported', 'confirmed', 'disputed'] as const)(
    'lets staff validate a %s result, which then counts',
    async (state) => {
      const { db, report, stored } = league();
      const evidenceId = await evidenceIdOf(report);
      if (state !== 'reported') {
        const answer = state === 'confirmed' ? ({ action: 'confirm' } as const) : DISPUTE;
        answerReport(db, CHARLIE_MANAGER, { matchId: 3, evidenceId, ...answer }, 9200);
      }

      const reply = validateResult(db, STAFF, { matchId: 3, evidenceId }, 9500);

      expect(reply).toMatchObject({ ok: true, status: 'validated', resultsChannelId: RESULTS });
      expect(stored()).toMatchObject({ status: 'validated', validatedAt: 9500 });
      expect(stored()?.validatedBy).not.toBeNull();
      expect(db.select().from(game).all().at(-1)?.status).toBe('final');
      expect(pointsOf(db)).toEqual({ ALP: 6, BRV: 3, CHA: 0 });
      expect(db.select().from(auditLog).all().at(-1)).toMatchObject({
        action: 'match.validate',
        beforeJson: { status: state, scoreA: 7, scoreB: 5 },
        afterJson: { status: 'validated' },
      });
    },
  );

  it('lets staff reject a report: the match can be reported again, the audit log keeps it', async () => {
    const { db, report, stored } = league();
    await report();
    expect(rejectResult(db, STAFF, { matchId: 3 }, 9500)).toMatchObject({
      ok: true,
      status: 'scheduled',
    });
    expect(stored()).toMatchObject({ status: 'scheduled', reportedBy: null, confirmedBy: null });
    expect(db.select().from(game).all().at(-1)?.status).toBe('void');
    expect(db.select().from(auditLog).all().at(-1)).toMatchObject({
      action: 'match.reject',
      beforeJson: { status: 'reported', scoreA: 7, scoreB: 5 },
    });

    expect(await report(CHARLIE_MANAGER, { ...REQUEST, scoreA: 5, scoreB: 7 })).toMatchObject({
      ok: true,
      side: 'b',
    });
    expect(
      db
        .select()
        .from(game)
        .all()
        .filter((row) => row.matchId === 3),
    ).toMatchObject([{ scoreA: 5, scoreB: 7, status: 'pending' }]);
  });

  it.each([
    ['validate', validateResult],
    ['reject', rejectResult],
  ] as const)('refuses to %s for anyone but league staff', async (_name, run) => {
    const { db, report, dump } = league();
    const evidenceId = await evidenceIdOf(report);
    const before = dump();
    for (const actor of [BRAVO_MANAGER, CHARLIE_MANAGER, OUTSIDER]) {
      expect(run(db, actor, { matchId: 3, evidenceId }, 9500)).toEqual({
        ok: false,
        error: 'not_staff',
      });
    }
    expect(run(db, { ...STAFF, guildId: null }, { matchId: 3 }, 9500)).toEqual({
      ok: false,
      error: 'not_linked',
    });
    expect(dump()).toBe(before);
  });

  it('refuses a match with nothing to validate, an older button and an unknown match', async () => {
    const { db, report } = league();
    expect(validateResult(db, STAFF, { matchId: 3 }, 9500)).toEqual({
      ok: false,
      error: 'wrong_status',
    });
    const evidenceId = await evidenceIdOf(report);
    expect(validateResult(db, STAFF, { matchId: 3, evidenceId: evidenceId + 1 }, 9500)).toEqual({
      ok: false,
      error: 'stale',
    });
    expect(validateResult(db, STAFF, { matchId: 99 }, 9500)).toEqual({
      ok: false,
      error: 'match_not_found',
    });
    expect(validateResult(db, STAFF, { matchId: 3, evidenceId }, 9500).ok).toBe(true);
    expect(validateResult(db, STAFF, { matchId: 3, evidenceId }, 9600)).toEqual({
      ok: false,
      error: 'wrong_status',
    });
  });
});

describe('voidMatch', () => {
  it('annuls a validated match with a reason; it stops counting and nothing is deleted', () => {
    const { db } = league();
    const rows = () => [db.select().from(match).all().length, db.select().from(game).all().length];
    const before = rows();
    expect(pointsOf(db)).toEqual({ ALP: 6, CHA: 0, BRV: 0 });

    expect(
      voidMatch(db, STAFF, { matchId: 1, reason: '  Joueur non inscrit  ' }, 9500),
    ).toMatchObject({ ok: true, status: 'void' });

    expect(db.select().from(match).all()[0]?.status).toBe('void');
    expect(rows()).toEqual(before);
    expect(pointsOf(db)).toEqual({ ALP: 3, CHA: 0, BRV: 0 });
    expect(db.select().from(auditLog).all().at(-1)).toMatchObject({
      action: 'match.void',
      beforeJson: { status: 'validated', scoreA: 7, scoreB: 4 },
      afterJson: { status: 'void', reason: 'Joueur non inscrit' },
    });
  });

  it('annuls a forfeit and a match still to play', () => {
    const { db } = league();
    expect(voidMatch(db, STAFF, { matchId: 2, reason: 'erreur' }, 9500).ok).toBe(true);
    expect(voidMatch(db, STAFF, { matchId: 3, reason: 'erreur' }, 9500).ok).toBe(true);
  });

  it('needs a reason, league staff, and a match that is not annulled already', () => {
    const { db } = league();
    expect(voidMatch(db, STAFF, { matchId: 1, reason: '   ' }, 9500)).toEqual({
      ok: false,
      error: 'reason_required',
    });
    expect(voidMatch(db, BRAVO_MANAGER, { matchId: 1, reason: 'x' }, 9500)).toEqual({
      ok: false,
      error: 'not_staff',
    });
    expect(voidMatch(db, BRAVO_MANAGER, { matchId: 1, reason: '' }, 9500)).toEqual({
      ok: false,
      error: 'not_staff',
    });
    voidMatch(db, STAFF, { matchId: 1, reason: 'x' }, 9500);
    expect(voidMatch(db, STAFF, { matchId: 1, reason: 'x' }, 9600)).toEqual({
      ok: false,
      error: 'wrong_status',
    });
  });
});

describe('match suggestions', () => {
  it("offers a member their own teams' matches still to play", () => {
    const { db } = league();
    const ids = (actor: Actor, query = '') => {
      const found = searchReportableMatches(db, actor, query, 25);
      return found.ok ? found.matches.map((candidate) => candidate.id) : found.error;
    };
    expect(ids(BRAVO_MANAGER)).toEqual([3]);
    expect(ids(CHARLIE_STAFF)).toEqual([3]);
    expect(ids(BRAVO_MANAGER, 'cha')).toEqual([3]);
    expect(ids(BRAVO_MANAGER, 'xray')).toEqual([]);
    // Xray's only match already has a result: nothing is left to report.
    expect(ids(XRAY_MANAGER)).toEqual([]);
  });

  it('says why it offers nothing, so the member is not left with an empty list', () => {
    const { db } = league();
    const why = (actor: Actor) => searchReportableMatches(db, actor, '', 25);
    expect(why(OUTSIDER)).toEqual({ ok: false, error: 'no_team' });
    expect(why(STAFF)).toEqual({ ok: false, error: 'no_team' });
    expect(why({ ...BRAVO_MANAGER, guildId: null })).toEqual({ ok: false, error: 'not_linked' });
    db.update(schema.season).set({ status: 'registration' }).run();
    expect(why(BRAVO_MANAGER)).toEqual({ ok: false, error: 'no_season' });
  });

  it('offers staff the matches waiting for them, and every match that can be annulled', async () => {
    const { db, report } = league();
    const ids = (purpose: 'validate' | 'void', actor: Actor = STAFF) =>
      searchMatchesForStaff(db, actor, purpose, '', 25).map((found) => found.id);
    expect(ids('validate')).toEqual([]);
    await report();
    expect(ids('validate')).toEqual([3]);
    expect(ids('void')).toEqual([1, 2, 3, 4]);
    expect(ids('validate', BRAVO_MANAGER)).toEqual([]);
  });
});
