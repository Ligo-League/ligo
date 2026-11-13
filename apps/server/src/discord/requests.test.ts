import { schema } from '@ligo/db';
import { describe, expect, it, vi } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { buttons } from './buttons/index.ts';
import { tick } from './clock.ts';
import { teamCommand } from './commands/team.ts';
import { forms } from './forms.ts';
import { routeButton, routeForm } from './router.ts';
import {
  fakeButton,
  fakeContext,
  fakeForm,
  fakeGateway,
  fakeInteraction,
  type FakeInput,
} from './testing.ts';

// A team request from start to end in Discord: filed with /team, answered with the buttons of
// its post in the staff queue, reminded by the clock.

const QUEUE = '900000000000000001';
const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
const STAFF: FakeInput = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const user = (n: number) => ({ id: `70000000000000000${n}`, displayName: `Member ${n}` });
const member = (n: number): FakeInput => ({
  guildId: TEST_GUILD,
  user: user(n),
  memberRoleIds: [],
});
const logger = { error: vi.fn() };

/** Alpha has member 1 as owner and member 2 as manager; member 2 asks to add member 5 as coach. */
async function filed() {
  const db = leagueDatabase();
  db.update(schema.leagueGuild).set({ alertsChannelId: QUEUE }).run();
  const gateway = fakeGateway();
  let now = NOW;
  const context = fakeContext({ db, gateway, now: () => now });
  const team = async (
    who: FakeInput,
    subcommand: string,
    options: FakeInput['options'],
    group?: string,
  ) => {
    const interaction = fakeInteraction('team', {
      ...who,
      ...(group ? { subcommandGroup: group } : {}),
      subcommand,
      options,
    });
    await teamCommand.execute(interaction, context);
    return interaction;
  };
  await team(STAFF, 'owner', { team: 1, member: { user: user(1) } });
  await team(STAFF, 'add', { team: 1, member: { user: user(2) }, role: 'manager' }, 'member');
  await team(member(2), 'add', { member: { user: user(5) }, role: 'coach' }, 'member');
  const click = async (customId: string, who: FakeInput) => {
    const interaction = fakeButton(customId, who);
    await routeButton(buttons, interaction, context, logger);
    return interaction;
  };
  const send = async (customId: string, reason: string, who: FakeInput) => {
    const interaction = fakeForm(customId, { text: { reason } }, who);
    await routeForm(forms, interaction, context, logger);
    return interaction;
  };
  const advance = (ms: number) => {
    now += ms;
  };
  return { db, gateway, context, click, send, advance, logger };
}

describe('the request post in the staff queue', () => {
  it('approves: the post shows who approved, and the team is told directly', async () => {
    const { db, gateway, click } = await filed();
    const clicked = await click('request-approve:1:0', STAFF);
    expect(clicked.updates).toHaveLength(1);
    expect(clicked.updates[0]?.content).toContain('✅ Approuvée par <@222222222222222222>.');
    expect(clicked.updates[0]?.buttons).toBeUndefined();
    expect(gateway.posted[0]?.edits).toBe(1);
    expect(gateway.direct.map((entry) => entry.userId)).toEqual([
      '700000000000000002',
      '700000000000000001',
      '700000000000000005',
    ]);
    expect(gateway.direct[0]?.message.content).toBe(
      'La demande n°1 pour Alpha Esport est acceptée par le staff de la ligue : Ajouter <@700000000000000005> comme coach.',
    );
    const coach = db
      .select()
      .from(schema.teamStaff)
      .all()
      .find((row) => row.role === 'coach');
    expect(coach).toBeDefined();
  });

  it('refuses with a reason typed in a form, which the team reads', async () => {
    const { gateway, click, send } = await filed();
    const clicked = await click('request-reject:1:0', STAFF);
    expect(clicked.forms).toMatchObject([
      { customId: 'request-reject:1:0', title: 'Refuser la demande n°1' },
    ]);
    const sent = await send('request-reject:1:0', 'Hors fenêtre de mercato', STAFF);
    expect(sent.updates[0]?.content).toContain(
      '❌ Refusée par <@222222222222222222> : Hors fenêtre de mercato',
    );
    expect(gateway.direct[0]?.message.content).toBe(
      'La demande n°1 pour Alpha Esport est refusée par le staff de la ligue : Ajouter <@700000000000000005> comme coach.\nRaison : Hors fenêtre de mercato',
    );
  });

  it('answers a team member privately, and opens no form for them', async () => {
    const { click, gateway } = await filed();
    for (const customId of ['request-approve:1:0', 'request-reject:1:0']) {
      const clicked = await click(customId, member(1));
      expect(clicked.forms).toEqual([]);
      expect(clicked.replies).toEqual([
        { content: 'Seul le staff de la ligue répond aux demandes.', ephemeral: true },
      ]);
    }
    expect(gateway.posted[0]?.edits).toBe(0);
  });

  it('says so when a request was already answered', async () => {
    const { click } = await filed();
    await click('request-approve:1:0', STAFF);
    expect((await click('request-approve:1:0', STAFF)).replies).toEqual([
      { content: 'Cette demande a déjà reçu une réponse.', ephemeral: true },
    ]);
  });

  it('reports in the queue the direct messages that could not be delivered', async () => {
    const { gateway, click } = await filed();
    gateway.sendDirectMessage = () => Promise.reject(new Error('closed'));
    await click('request-approve:1:0', STAFF);
    expect(gateway.posted.at(-1)?.message.content).toBe(
      "Demande n°1 : 3 membre(s) n'ont pas pu être prévenus en message privé.",
    );
  });
});

describe('Withdraw', () => {
  it('takes the request back, and marks its post in the queue', async () => {
    const { gateway, click } = await filed();
    expect((await click('request-withdraw:1:0', member(5))).replies).toEqual([
      {
        content: "Seuls l'auteur de la demande et le propriétaire de l'équipe peuvent la retirer.",
        ephemeral: true,
      },
    ]);
    expect((await click('request-withdraw:1:0', member(1))).replies).toEqual([
      { content: 'Demande n°1 retirée.', ephemeral: true },
    ]);
    expect(gateway.posted[0]?.message.content).toContain('↩️ Retirée par <@700000000000000001>.');
    expect(gateway.direct).toEqual([]);
  });
});

describe('the reminder', () => {
  it('pings the staff role once, 6 hours before the deadline, with a link to the post', async () => {
    const { db, gateway, context, advance } = await filed();
    const deps = { db, gateway, logger, locale: 'fr' as const, now: () => context.now() };
    advance(18 * HOUR - 1);
    await tick(deps);
    expect(gateway.posted).toHaveLength(1);
    advance(1);
    await tick(deps);
    await tick(deps);
    expect(gateway.posted).toHaveLength(2);
    const reminder = gateway.posted[1];
    expect(reminder?.channelId).toBe(QUEUE);
    expect(reminder?.message.mentionRoleIds).toEqual([TEST_STAFF_ROLE]);
    expect(reminder?.message.content).toContain(`⏰ <@&${TEST_STAFF_ROLE}> La demande n°1`);
    expect(reminder?.message.content).toContain(
      `https://discord.com/channels/${TEST_GUILD}/${QUEUE}/${gateway.posted[0]?.messageId ?? ''}`,
    );
  });

  it('posts the request again first when it never reached the queue', async () => {
    const { db, gateway, context, advance } = await filed();
    db.delete(schema.queuePost).run();
    advance(18 * HOUR);
    await tick({ db, gateway, logger, locale: 'fr', now: () => context.now() });
    expect(gateway.posted).toHaveLength(3);
    expect(gateway.posted[1]?.message.buttons).toHaveLength(2);
    expect(db.select().from(schema.queuePost).all()).toHaveLength(1);
  });
});
