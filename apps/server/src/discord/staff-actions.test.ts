import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setAutoExclusion } from '../services/exclusions.ts';
import { recordForfeit } from '../services/forfeits.ts';
import type { Actor } from '../services/permissions.ts';
import { recordResult } from '../services/results.ts';
import { proposeTime, recordProposalPost, setMatchTime } from '../services/scheduling.ts';
import { setTeamOwner } from '../services/team-staff.ts';
import { disputedReport, leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { announceForfeit, announceMatchTime, announceStaffResult } from './staff-actions.ts';
import { fakeContext, fakeGateway } from './testing.ts';

// What Discord shows after a staff action taken on the website (phase 3f): the result or forfeit
// announced with its picture, exclusions told to the team and to staff, a new time announced, and
// whatever the action superseded (a report still open, a time proposal) closed.
// In leagueDatabase(): match 3 is Bravo v Charlie (Ligue 1, week 3), still to play; Charlie has
// already forfeited match 2.

const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const STAFF_MENTION = '<@222222222222222222>';
const QUEUE = '800000000000000001';
const RESULTS = '800000000000000002';
const SCHEDULE = '800000000000000004';
const NOW = 9000;
const warningReason = (count: number) => `Avertissement automatique : ${String(count)} forfaits.`;
const exclusionReason = (count: number) => `Exclusion automatique : ${String(count)} forfaits.`;

function league() {
  const db = leagueDatabase();
  db.update(schema.leagueGuild)
    .set({ alertsChannelId: QUEUE, resultsChannelId: RESULTS, scheduleChannelId: SCHEDULE })
    .run();
  const gateway = fakeGateway();
  const context = fakeContext({ db, gateway });
  const enter = async (scoreA: number, scoreB: number, matchId = 3) => {
    const reply = recordResult(db, STAFF, { matchId, scoreA, scoreB }, NOW);
    if (!reply.ok) throw new Error(reply.error);
    await announceStaffResult(context, reply, STAFF.user.id);
  };
  const forfeit = async (side: 'a' | 'b' | 'both', target = context) => {
    const reply = recordForfeit(
      db,
      STAFF,
      { matchId: 3, side, warningReason, exclusionReason },
      NOW,
    );
    if (!reply.ok) throw new Error(reply.error);
    await announceForfeit(target, reply, STAFF.user.id);
  };
  /** The report's posts, made by the bot with their buttons, then the report on record. */
  const openReport = async () => {
    const buttons = [{ customId: 'x', label: 'x', style: 'success' as const }];
    const queue = await gateway.postMessage(QUEUE, { content: 'À valider', buttons });
    const report = await gateway.postMessage(SCHEDULE, { content: 'Signalé', buttons });
    const dispute = await gateway.postMessage(QUEUE, { content: 'Contesté', buttons });
    disputedReport(db, {
      queue: { channelId: QUEUE, messageId: queue.messageId },
      report: { channelId: SCHEDULE, messageId: report.messageId },
      dispute: { channelId: QUEUE, messageId: dispute.messageId },
    });
  };
  return { db, gateway, context, enter, forfeit, openReport };
}

describe('announceStaffResult', () => {
  it('announces the result, then its correction, in the results channel, with the picture', async () => {
    const { gateway, enter } = league();
    await enter(7, 5);
    await enter(5, 7);
    expect(gateway.posted).toMatchObject([
      {
        channelId: RESULTS,
        message: { content: 'Résultat validé — Ligue 1, semaine 3 : Bravo 7–5 Charlie.' },
      },
      {
        channelId: RESULTS,
        message: {
          content: 'Résultat corrigé — Ligue 1, semaine 3 : Bravo 5–7 Charlie (au lieu de 7–5).',
        },
      },
    ]);
    expect(gateway.posted.map((post) => post.message.files?.[0]?.name)).toEqual([
      'match-3-result.png',
      'match-3-result.png',
    ]);
  });

  it("announces in the division's own channel when it has one, else in the league's", async () => {
    const { db, gateway, enter } = league();
    db.update(schema.division)
      .set({ resultsChannelId: '800000000000000003' })
      .where(eq(schema.division.name, 'Ligue 1'))
      .run();
    // Match 4 (Xray v Yankee) is in Ligue 2.
    await enter(7, 5);
    await enter(7, 5, 4);
    expect(gateway.posted.map((post) => post.channelId)).toEqual(['800000000000000003', RESULTS]);
  });

  it('closes the report it replaces: its posts lose their buttons, the dispute keeps its words', async () => {
    const { gateway, enter, openReport } = league();
    await openReport();
    await enter(7, 4);
    const replaced = `**Ligue 1, semaine 3 : Bravo 7–5 Charlie** — remplacé par le résultat saisi par ${STAFF_MENTION} : Ligue 1, semaine 3 : Bravo 7–4 Charlie.`;
    const [queue, report, dispute, announced] = gateway.posted;
    for (const post of [queue, report]) {
      expect(post).toMatchObject({ edits: 1, message: { content: replaced } });
      expect(post?.message.buttons).toBeUndefined();
    }
    expect(dispute?.edits).toBe(1);
    expect(dispute?.message.content).toContain(
      `✏️ Résultat saisi par ${STAFF_MENTION} : Ligue 1, semaine 3 : Bravo 7–4 Charlie.`,
    );
    expect(dispute?.message.content).toContain('>>> Round 9 replayed');
    expect(dispute?.message.buttons).toBeUndefined();
    expect(announced?.message.content).toBe(
      'Résultat validé — Ligue 1, semaine 3 : Bravo 7–4 Charlie.',
    );
  });
});

describe('announceForfeit', () => {
  const exclusionAtTwo = (db: ReturnType<typeof leagueDatabase>) =>
    db
      .update(schema.season)
      .set({
        settingsJson: {
          forfeit_score: [0, 0],
          exclusion_forfeit_score: null,
          map_pool: [],
          forfeits: { warning_at: null, exclusion_at: 2 },
        },
      })
      .run();
  const CHARLIE_MANAGER = { id: '700000000000000002', displayName: 'Manager' };
  const RULE =
    "Elle a joué 0 de ses 2 matchs, moins de la moitié : tous ses matchs deviennent des victoires par forfait pour ses adversaires, sauf ceux où l'adversaire avait lui-même déclaré forfait.";

  it('announces the forfeit in the results channel, with the picture', async () => {
    const { gateway, forfeit } = league();
    await forfeit('a');
    expect(gateway.posted).toMatchObject([
      {
        channelId: RESULTS,
        message: {
          content: 'Forfait — Ligue 1, semaine 3 : Bravo – Charlie. Bravo déclare forfait.',
          files: [{ name: 'match-3-result.png' }],
        },
      },
    ]);
  });

  it('announces a forfeit by both teams (O-28)', async () => {
    const { gateway, forfeit } = league();
    await forfeit('both');
    expect(gateway.posted[0]?.message.content).toBe(
      'Forfait — Ligue 1, semaine 3 : Bravo – Charlie. Aucune des deux équipes ne s’est présentée : défaite par forfait pour Bravo et pour Charlie.',
    );
  });

  it('excludes the team at the threshold: tells it directly, announces it, alerts staff', async () => {
    const { db, gateway, forfeit } = league();
    exclusionAtTwo(db);
    setTeamOwner(db, STAFF, { teamId: 3, member: CHARLIE_MANAGER }, 100);
    await forfeit('b');
    expect(gateway.direct).toEqual([
      {
        userId: CHARLIE_MANAGER.id,
        message: {
          content: `Ton équipe Charlie est exclue de la saison Saison 3 (LFR).\nRaison : Exclusion automatique : 2 forfaits.\n${RULE}\nTu peux faire appel auprès du staff de la ligue, qui peut annuler l'exclusion.`,
        },
      },
    ]);
    expect(gateway.posted.map((post) => [post.channelId, post.message.content])).toEqual([
      [RESULTS, 'Forfait — Ligue 1, semaine 3 : Bravo – Charlie. Charlie déclare forfait.'],
      [RESULTS, `Charlie est exclue de la saison. ${RULE}`],
      [
        QUEUE,
        `Charlie est exclue automatiquement : 2 forfaits (Ligue 1, semaine 3 : Bravo – Charlie). ${RULE} Pour l'annuler en appel : la page des sanctions du staff, sur le site.`,
      ],
    ]);
  });

  it('tells staff when a direct message could not be delivered', async () => {
    const { db, gateway, context, forfeit } = league();
    exclusionAtTwo(db);
    setTeamOwner(db, STAFF, { teamId: 3, member: CHARLIE_MANAGER }, 100);
    const failing = {
      ...gateway,
      sendDirectMessage: () => Promise.reject(new Error('Direct messages are closed')),
    };
    await forfeit('b', { ...context, gateway: failing });
    expect(gateway.posted.at(-1)?.message.content).toContain(
      'Message privé non remis à 1 membre(s) de Charlie',
    );
  });

  it('only alerts staff when automatic exclusion is switched off for the team', async () => {
    const { db, gateway, forfeit } = league();
    exclusionAtTwo(db);
    setAutoExclusion(db, STAFF, { teamId: 3, enabled: false, reason: 'Absence prévue' }, 100);
    await forfeit('b');
    expect(gateway.posted.at(-1)?.message.content).toBe(
      "Charlie atteint le seuil d'exclusion avec 2 forfaits (Ligue 1, semaine 3 : Bravo – Charlie), mais son exclusion automatique est désactivée : Absence prévue",
    );
    expect(gateway.direct).toEqual([]);
  });

  it('closes the report it replaces', async () => {
    const { gateway, forfeit, openReport } = league();
    await openReport();
    await forfeit('b');
    const [queue, report, dispute] = gateway.posted;
    const replaced = `**Ligue 1, semaine 3 : Bravo 7–5 Charlie** — remplacé par un forfait enregistré par ${STAFF_MENTION}.`;
    expect(queue?.message).toEqual({ content: replaced });
    expect(report?.message).toEqual({ content: replaced });
    expect(dispute?.message.content).toContain(`🏳️ Forfait enregistré par ${STAFF_MENTION}.`);
  });
});

describe('announceMatchTime', () => {
  const THURSDAY_21H = Date.parse('2026-11-05T20:00:00Z');
  const SUNDAY_21H = Date.parse('2026-11-08T20:00:00Z');
  const at = (ms: number) => `<t:${String(ms / 1000)}:F>`;

  it('announces the time with its picture, and closes the proposal it ended', async () => {
    const { db, gateway, context } = league();
    setTeamOwner(
      db,
      STAFF,
      { teamId: 2, member: { id: '700000000000000001', displayName: 'A' } },
      1,
    );
    const proposed = proposeTime(
      db,
      {
        guildId: TEST_GUILD,
        user: { id: '700000000000000001', displayName: 'A' },
        memberRoleIds: [],
      },
      { matchId: 3, at: THURSDAY_21H },
      Date.parse('2026-11-03T12:00:00Z'),
    );
    if (!proposed.ok) throw new Error(proposed.error);
    const buttons = [{ customId: 'x', label: 'x', style: 'success' as const }];
    const post = await gateway.postMessage(SCHEDULE, { content: 'Proposé', buttons });
    recordProposalPost(db, proposed.proposalId, { channelId: SCHEDULE, messageId: post.messageId });

    const reply = setMatchTime(db, STAFF, { matchId: 3, at: SUNDAY_21H }, NOW);
    if (!reply.ok) throw new Error(reply.error);
    await announceMatchTime(context, reply);
    expect(gateway.posted[0]?.message).toEqual({
      content: `**Ligue 1, semaine 3 : Bravo – Charlie** — le ${at(THURSDAY_21H)} : remplacé par l'horaire fixé par le staff.`,
    });
    expect(gateway.posted[1]).toMatchObject({
      channelId: SCHEDULE,
      message: {
        content: `Horaire fixé — Ligue 1, semaine 3 : Bravo – Charlie : ${at(SUNDAY_21H)}.`,
        files: [{ name: 'match-3-time.png' }],
      },
    });
  });
});
