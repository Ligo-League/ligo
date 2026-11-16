import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { proposeTime } from '../services/scheduling.ts';
import { setTeamOwner } from '../services/team-staff.ts';
import type { Actor } from '../services/permissions.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { buttons } from './buttons/index.ts';
import { tick } from './clock.ts';
import { postProposal } from './schedule-posts.ts';
import { routeButton } from './router.ts';
import { fakeButton, fakeContext, fakeGateway, FAKE_CHANNEL, type FakeInput } from './testing.ts';

// Match 3 is Bravo (side A, managed by member 1) v Charlie (member 2), Ligue 1 week 3:
// Monday 2 to Sunday 8 November 2026, extension until Sunday 15 November.
const STAFF_USER = { id: '222222222222222222', displayName: 'Léa Staff' };
const BRAVO_ID = '700000000000000001';
const CHARLIE_ID = '700000000000000002';
const member = (n: number): Actor => ({
  guildId: TEST_GUILD,
  user: { id: `70000000000000000${n}`, displayName: `Member ${n}` },
  memberRoleIds: [],
});
const BRAVO = member(1);
const CHARLIE = member(2);
const NOW = Date.parse('2026-11-03T12:00:00Z');
const THURSDAY_21H = Date.parse('2026-11-05T20:00:00Z');
const SCHEDULE = '800000000000000004';
const logger = { error: vi.fn() };
const at = (ms: number) => `<t:${String(ms / 1000)}:F>`;
const SITE = new URL('http://localhost:3000');

function session(now = NOW) {
  const db = leagueDatabase();
  const staff: Actor = { guildId: TEST_GUILD, user: STAFF_USER, memberRoleIds: [TEST_STAFF_ROLE] };
  setTeamOwner(db, staff, { teamId: 2, member: { id: BRAVO_ID, displayName: 'Member 1' } }, 100);
  setTeamOwner(db, staff, { teamId: 3, member: { id: CHARLIE_ID, displayName: 'Member 2' } }, 100);
  db.update(schema.leagueGuild).set({ scheduleChannelId: SCHEDULE }).run();
  const gateway = fakeGateway();
  const context = fakeContext({ db, gateway, now: () => now });
  // Proposed on the match page, which posts it as the website does.
  const propose = async (who: Actor) => {
    const reply = proposeTime(db, who, { matchId: 3, at: THURSDAY_21H }, now);
    if (!reply.ok) throw new Error(reply.error);
    await postProposal(context, FAKE_CHANNEL, reply, who.user.id);
  };
  const click = async (customId: string, who: FakeInput) => {
    const interaction = fakeButton(customId, who);
    await routeButton(buttons, interaction, context, logger);
    return interaction;
  };
  const stored = () => db.select().from(schema.match).where(eq(schema.match.id, 3)).get();
  return { db, gateway, context, propose, click, stored };
}

describe('the proposal post', () => {
  it('carries buttons for the other team, pings it, links the match page, and is kept', async () => {
    const { propose, gateway, db } = session();
    await propose(BRAVO);
    expect(gateway.posted).toEqual([
      {
        channelId: FAKE_CHANNEL,
        messageId: expect.any(String) as string,
        edits: 0,
        message: {
          content: `<@700000000000000001> propose pour Bravo : **Ligue 1, semaine 3 : Bravo – Charlie** le ${at(THURSDAY_21H)}. <@700000000000000002>, acceptez ou refusez.\nPage du match : <http://localhost:3000/matches/3>`,
          buttons: [
            { customId: 'time-accept:3:1', label: 'Accepter', style: 'success' },
            { customId: 'time-decline:3:1', label: 'Refuser', style: 'danger' },
          ],
          mentionUserIds: ['700000000000000002'],
        },
      },
    ]);
    // Kept, so that an answer given on the website edits it.
    expect(db.select().from(schema.matchProposal).get()).toMatchObject({
      channelId: FAKE_CHANNEL,
      messageId: gateway.posted[0]?.messageId,
    });
  });
});

describe('proposal buttons', () => {
  it('lets the other team accept: the time is set and announced in the schedule channel', async () => {
    const { propose, click, gateway, stored } = session();
    await propose(BRAVO);
    const interaction = await click('time-accept:3:1', CHARLIE);
    expect(interaction.updates).toEqual([
      {
        content: `**Ligue 1, semaine 3 : Bravo – Charlie** — le ${at(THURSDAY_21H)}, accepté par <@700000000000000002>.`,
      },
    ]);
    expect(stored()?.scheduledAt).toBe(THURSDAY_21H);
    // The proposal's own post (clicked), then the announcement.
    expect(gateway.posted).toMatchObject([
      { channelId: FAKE_CHANNEL },
      {
        channelId: SCHEDULE,
        message: {
          content: `Horaire fixé — Ligue 1, semaine 3 : Bravo – Charlie : ${at(THURSDAY_21H)}.`,
        },
      },
    ]);
    expect(gateway.posted[0]?.message.content).toContain('accepté par <@700000000000000002>');
    expect(gateway.posted[0]?.message.buttons).toBeUndefined();
    // The picture for social networks rides along with the announcement.
    expect(gateway.posted[1]?.message.files?.map((file) => file.name)).toEqual([
      'match-3-time.png',
    ]);
  });

  it('lets the other team decline, and refuses the team that proposed', async () => {
    const { propose, click, stored } = session();
    await propose(BRAVO);
    const own = await click('time-accept:3:1', BRAVO);
    expect(own.replies).toEqual([
      {
        content: "Seule l'équipe adverse peut accepter ou refuser cette proposition.",
        ephemeral: true,
      },
    ]);
    const declined = await click('time-decline:3:1', CHARLIE);
    expect(declined.updates[0]?.content).toContain('refusé par <@700000000000000002>');
    expect(stored()?.scheduledAt).toBeNull();
  });
});

describe('the clock', () => {
  const WEEK_END = Date.parse('2026-11-08T23:00:00Z');
  const AUTO_SLOT = Date.parse('2026-11-15T20:00:00Z');

  it('starts the extension and pings both teams in the schedule channel, once', async () => {
    const { db, gateway, stored } = session();
    const deps = {
      db,
      gateway,
      logger,
      locale: 'fr' as const,
      publicUrl: SITE,
      now: () => WEEK_END,
    };
    await tick(deps);
    await tick(deps);
    expect(stored()).toMatchObject({ scheduledAt: AUTO_SLOT, autoScheduled: true });
    expect(gateway.posted).toEqual([
      {
        channelId: SCHEDULE,
        messageId: expect.any(String) as string,
        edits: 0,
        message: {
          content: `Prolongation — **Ligue 1, semaine 3 : Bravo – Charlie** : aucun horaire convenu pendant la semaine. Le match est fixé au ${at(AUTO_SLOT)}. Vous pouvez encore convenir d'un autre horaire jusqu'au <t:${String((Date.parse('2026-11-15T23:00:00Z') - 60_000) / 1000)}:D> sur la page du match, sur le site. <@700000000000000001> <@700000000000000002>`,
          mentionUserIds: ['700000000000000001', '700000000000000002'],
        },
      },
    ]);
  });

  it('keeps the time it set when the notice cannot be posted, and logs it', async () => {
    const { db, gateway, stored } = session();
    gateway.failing = true;
    const errors = { error: vi.fn() };
    await tick({ db, gateway, logger: errors, locale: 'fr', publicUrl: SITE, now: () => WEEK_END });
    expect(stored()?.autoScheduled).toBe(true);
    expect(errors.error).toHaveBeenCalledOnce();
  });
});
