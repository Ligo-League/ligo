import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { setTeamManager } from '../services/team-staff.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { buttons } from './buttons/index.ts';
import { tick } from './clock.ts';
import { matchCommand } from './commands/match.ts';
import { staffCommand } from './commands/staff.ts';
import { routeButton } from './router.ts';
import {
  fakeAutocomplete,
  fakeButton,
  fakeContext,
  fakeGateway,
  fakeInteraction,
  type FakeInput,
} from './testing.ts';

// Match 3 is Bravo (side A, managed by member 1) v Charlie (member 2), Ligue 1 week 3:
// Monday 2 to Sunday 8 November 2026, extension until Sunday 15 November.
const STAFF_USER = { id: '222222222222222222', displayName: 'Léa Staff' };
const STAFF: FakeInput = {
  guildId: TEST_GUILD,
  user: STAFF_USER,
  memberRoleIds: [TEST_STAFF_ROLE],
};
const BRAVO_ID = '700000000000000001';
const CHARLIE_ID = '700000000000000002';
const member = (n: number): FakeInput => ({
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

function session(now = NOW) {
  const db = leagueDatabase();
  const staff = { guildId: TEST_GUILD, user: STAFF_USER, memberRoleIds: [TEST_STAFF_ROLE] };
  setTeamManager(db, staff, { teamId: 2, member: { id: BRAVO_ID, displayName: 'Member 1' } }, 100);
  setTeamManager(
    db,
    staff,
    { teamId: 3, member: { id: CHARLIE_ID, displayName: 'Member 2' } },
    100,
  );
  db.update(schema.leagueGuild).set({ scheduleChannelId: SCHEDULE }).run();
  const gateway = fakeGateway();
  const context = fakeContext({ db, gateway, now: () => now });
  const propose = async (who: FakeInput, date = '2026-11-05', time = '21:00') => {
    const interaction = fakeInteraction('match', {
      ...who,
      subcommand: 'propose-time',
      options: { match: 3, date, time },
    });
    await matchCommand.execute(interaction, context);
    return interaction;
  };
  const click = async (customId: string, who: FakeInput) => {
    const interaction = fakeButton(customId, who);
    await routeButton(buttons, interaction, context, logger);
    return interaction;
  };
  const stored = () => db.select().from(schema.match).where(eq(schema.match.id, 3)).get();
  return { db, gateway, context, propose, click, stored };
}

describe('/match propose-time', () => {
  it('posts the proposal in public, with buttons for the other team, and pings it', async () => {
    const { propose } = session();
    const interaction = await propose(BRAVO);
    expect(interaction.replies).toEqual([
      {
        content: `<@700000000000000001> propose pour Bravo : **Ligue 1, semaine 3 : Bravo – Charlie** le ${at(THURSDAY_21H)}. <@700000000000000002>, acceptez ou refusez.`,
        ephemeral: false,
        buttons: [
          { customId: 'time-accept:3:1', label: 'Accepter', style: 'success' },
          { customId: 'time-decline:3:1', label: 'Refuser', style: 'danger' },
        ],
        mentionUserIds: ['700000000000000002'],
      },
    ]);
  });

  it.each([
    [{ date: '05/11/2026' }, 'Date illisible : choisis un jour dans la liste ou tape AAAA-MM-JJ.'],
    [{ time: '21h' }, 'Heure illisible : tape-la comme 21:00.'],
    [{ date: '2026-11-02' }, 'Cet horaire est déjà passé.'],
    [
      { date: '2026-11-20' },
      'Cet horaire tombe hors de la semaine du match et de sa prolongation. Le staff de la ligue peut fixer un autre horaire.',
    ],
  ])('refuses privately: %j', async (change, content) => {
    const { propose } = session();
    const options = { date: '2026-11-05', time: '21:00', ...change };
    const interaction = await propose(BRAVO, options.date, options.time);
    expect(interaction.replies).toEqual([{ content, ephemeral: true }]);
  });

  it("suggests the days left in the match's week and extension", async () => {
    const { context } = session();
    const suggest = async (value: string) => {
      const interaction = fakeAutocomplete(
        'match',
        { name: 'date', value },
        { ...BRAVO, subcommand: 'propose-time', options: { match: 3 } },
      );
      await matchCommand.autocomplete?.(interaction, context);
      return interaction.responses[0] ?? [];
    };
    const days = await suggest('');
    expect(days[0]).toEqual({ name: 'mar. 3 nov.', value: '2026-11-03' });
    expect(days.at(-1)).toEqual({ name: 'dim. 15 nov.', value: '2026-11-15' });
    expect(await suggest('jeu')).toEqual([
      { name: 'jeu. 5 nov.', value: '2026-11-05' },
      { name: 'jeu. 12 nov.', value: '2026-11-12' },
    ]);
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
    expect(gateway.posted).toMatchObject([
      {
        channelId: SCHEDULE,
        message: {
          content: `Horaire fixé — Ligue 1, semaine 3 : Bravo – Charlie : ${at(THURSDAY_21H)}.`,
        },
      },
    ]);
    // The picture for social networks rides along with the announcement.
    expect(gateway.posted[0]?.message.files?.map((file) => file.name)).toEqual([
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

describe('/staff match schedule', () => {
  it('sets any time, announces it and confirms privately', async () => {
    const { context, gateway, stored } = session();
    const interaction = fakeInteraction('staff', {
      ...STAFF,
      subcommandGroup: 'match',
      subcommand: 'schedule',
      options: { match: 3, date: '2026-12-20', time: '18:30' },
    });
    await staffCommand.execute(interaction, context);
    const when = Date.parse('2026-12-20T17:30:00Z');
    expect(interaction.replies).toEqual([
      {
        content: `Horaire fixé : Ligue 1, semaine 3 : Bravo – Charlie, ${at(when)}.`,
        ephemeral: true,
      },
    ]);
    expect(stored()).toMatchObject({ scheduledAt: when, autoScheduled: false });
    expect(gateway.posted[0]?.channelId).toBe(SCHEDULE);
  });
});

describe('the clock', () => {
  const WEEK_END = Date.parse('2026-11-08T23:00:00Z');
  const AUTO_SLOT = Date.parse('2026-11-15T20:00:00Z');

  it('starts the extension and pings both teams in the schedule channel, once', async () => {
    const { db, gateway, stored } = session();
    const deps = { db, gateway, logger, locale: 'fr' as const, now: () => WEEK_END };
    await tick(deps);
    await tick(deps);
    expect(stored()).toMatchObject({ scheduledAt: AUTO_SLOT, autoScheduled: true });
    expect(gateway.posted).toEqual([
      {
        channelId: SCHEDULE,
        messageId: expect.any(String) as string,
        edits: 0,
        message: {
          content: `Prolongation — **Ligue 1, semaine 3 : Bravo – Charlie** : aucun horaire convenu pendant la semaine. Le match est fixé au ${at(AUTO_SLOT)}. Vous pouvez encore convenir d'un autre horaire jusqu'au <t:${String((Date.parse('2026-11-15T23:00:00Z') - 60_000) / 1000)}:D> avec /match propose-time. <@700000000000000001> <@700000000000000002>`,
          mentionUserIds: ['700000000000000001', '700000000000000002'],
        },
      },
    ]);
  });

  it('keeps the time it set when the notice cannot be posted, and logs it', async () => {
    const { db, gateway, stored } = session();
    gateway.failing = true;
    const errors = { error: vi.fn() };
    await tick({ db, gateway, logger: errors, locale: 'fr', now: () => WEEK_END });
    expect(stored()?.autoScheduled).toBe(true);
    expect(errors.error).toHaveBeenCalledOnce();
  });
});
