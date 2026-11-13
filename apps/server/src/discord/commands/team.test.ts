import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../../testing.ts';
import {
  fakeAutocomplete,
  fakeContext,
  fakeGateway,
  fakeInteraction,
  type FakeInput,
} from '../testing.ts';
import { teamCommand } from './team.ts';

const QUEUE = '900000000000000001';
const STAFF: FakeInput = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const user = (n: number) => ({ user: { id: `70000000000000000${n}`, displayName: `Member ${n}` } });
const member = (n: number): FakeInput => ({ guildId: TEST_GUILD, ...user(n), memberRoleIds: [] });
// In leagueDatabase(), team 1 is Alpha Esport (ALP).
const input = (
  action: string,
  options: FakeInput['options'],
  who: FakeInput = STAFF,
): FakeInput => {
  const [first = '', second] = action.split(' ');
  return second
    ? { ...who, subcommandGroup: first, subcommand: second, options }
    : { ...who, subcommand: first, options };
};

function session() {
  const db = leagueDatabase();
  db.update(schema.leagueGuild).set({ alertsChannelId: QUEUE }).run();
  const gateway = fakeGateway();
  const context = fakeContext({ db, gateway });
  const run = async (...args: Parameters<typeof input>) => {
    const interaction = fakeInteraction('team', input(...args));
    await teamCommand.execute(interaction, context);
    return interaction.replies;
  };
  return { db, gateway, run };
}

/** Alpha with member 1 as owner and member 2 as manager, set by league staff. */
async function alpha() {
  const setup = session();
  await setup.run('owner', { team: 1, member: user(1) });
  await setup.run('member add', { team: 1, member: user(2), role: 'manager' });
  return setup;
}

describe('/team, by league staff', () => {
  it('sets the owner, adds managers and a coach, and shows the team each time, privately', async () => {
    const { run, gateway } = session();
    expect(await run('owner', { team: 1, member: user(1) })).toEqual([
      {
        content:
          'Alpha Esport (ALP) : propriétaire <@700000000000000001> ; managers aucun ; coach aucun.',
        ephemeral: true,
      },
    ]);
    await run('member add', { team: 1, member: user(2), role: 'manager' });
    expect((await run('member add', { team: 1, member: user(3), role: 'coach' }))[0]?.content).toBe(
      'Alpha Esport (ALP) : propriétaire <@700000000000000001> ; managers <@700000000000000002> ; coach <@700000000000000003>.',
    );
    expect((await run('member remove', { team: 1, member: user(1) }))[0]?.content).toBe(
      'Alpha Esport (ALP) : propriétaire aucun ; managers <@700000000000000002> ; coach <@700000000000000003>.',
    );
    expect((await run('list', { team: 1 }))[0]?.content).toBe(
      'Alpha Esport (ALP) : propriétaire aucun ; managers <@700000000000000002> ; coach <@700000000000000003>.',
    );
    // A direct change is no request: nothing goes to the queue.
    expect(gateway.posted).toEqual([]);
  });

  it('explains each refusal privately', async () => {
    const { run } = session();
    const reply = async (...args: Parameters<typeof input>) => (await run(...args))[0];
    await run('owner', { team: 1, member: user(1) });
    for (const n of [2, 3, 4]) {
      await run('member add', { team: 1, member: user(n), role: 'manager' });
    }

    expect(await reply('member add', { team: 1, member: user(5), role: 'manager' })).toEqual({
      content: 'Cette équipe a déjà 3 personnes dans ce rôle, le maximum prévu par la ligue.',
      ephemeral: true,
    });
    expect((await reply('member add', { team: 1, member: user(2), role: 'coach' }))?.content).toBe(
      'Ce membre a déjà ce rôle dans cette équipe.',
    );
    expect((await reply('member remove', { team: 1, member: user(9) }))?.content).toBe(
      "Ce membre n'est pas responsable de cette équipe.",
    );
    expect((await reply('owner', { team: 99, member: user(1) }))?.content).toBe(
      'Équipe introuvable dans la saison en cours. Choisis-la dans la liste proposée.',
    );
    // Free text typed instead of a suggestion never arrives as a number.
    expect((await reply('owner', { team: 'alpha', member: user(1) }))?.content).toBe(
      "Choisis l'équipe avec l'option `team`.",
    );
    expect((await reply('owner', { team: 1 }))?.content).toBe('Commande inconnue.');
    expect((await reply('member add', { team: 1, member: user(6) }))?.content).toBe(
      'Commande inconnue.',
    );
    expect((await reply('rename', { team: 1, member: user(1) }))?.content).toBe(
      'Commande inconnue.',
    );
  });
});

describe('/team, by a team', () => {
  it('files a request: told privately, posted in the staff queue with its buttons', async () => {
    const { db, gateway, run } = await alpha();
    const replies = await run(
      'member add',
      { member: user(5), role: 'manager', note: 'Il remplace Member 4' },
      member(2),
    );
    expect(replies).toHaveLength(1);
    expect(replies[0]?.ephemeral).toBe(true);
    expect(replies[0]?.content).toMatch(
      /^Demande n°1 envoyée au staff de la ligue : Ajouter <@700000000000000005> comme manager\./,
    );
    expect(gateway.posted).toHaveLength(1);
    const [post] = gateway.posted;
    expect(post?.channelId).toBe(QUEUE);
    expect(post?.message.content).toContain('📨 **Demande n°1** · Alpha Esport (ALP)');
    expect(post?.message.content).toContain('>>> Il remplace Member 4');
    expect(post?.message.buttons?.map((button) => button.customId)).toEqual([
      'request-approve:1:0',
      'request-reject:1:0',
    ]);
    expect(db.select().from(schema.queuePost).all()).toMatchObject([
      { entity: 'request', entityId: 1, channelId: QUEUE, messageId: post?.messageId },
    ]);
  });

  it('applies a removal by the owner at once: the queue and the removed member are told', async () => {
    const { gateway, run } = await alpha();
    const replies = await run('member remove', { member: user(2) }, member(1));
    expect(replies[0]?.content).toBe(
      'Fait : Retirer <@700000000000000002> des responsables.\nAlpha Esport (ALP) : propriétaire <@700000000000000001> ; managers aucun ; coach aucun.',
    );
    expect(gateway.posted[0]?.message).toEqual({
      content:
        'ℹ️ Alpha Esport (ALP) : Retirer <@700000000000000002> des responsables. Par <@700000000000000001>, sans validation nécessaire.',
    });
    expect(gateway.direct).toEqual([
      {
        userId: '700000000000000002',
        message: {
          content:
            "Tu ne fais plus partie des responsables de Alpha Esport : son propriétaire t'a retiré.",
        },
      },
    ]);
  });

  it('lets a manager leave, without telling them they left', async () => {
    const { gateway, run } = await alpha();
    expect((await run('leave', {}, member(2)))[0]?.content).toMatch(
      /^Fait : <@700000000000000002> quitte l'équipe\./,
    );
    expect(gateway.direct).toEqual([]);
  });

  it('lists its requests with a Withdraw button each; staff see every team’s, without', async () => {
    const { run } = await alpha();
    await run('member add', { member: user(5), role: 'coach' }, member(2));
    const own = (await run('requests', {}, member(1)))[0];
    expect(own?.content).toContain('**Demandes en attente**');
    expect(own?.content).toContain('• n°1 · ALP · Ajouter <@700000000000000005> comme coach.');
    expect(own?.buttons?.map((button) => button.customId)).toEqual(['request-withdraw:1:0']);
    const all = (await run('requests', {}))[0];
    expect(all?.content).toContain('• n°1 · ALP');
    expect(all?.buttons).toEqual([]);
  });

  it('refuses members who act for no team', async () => {
    const { run } = await alpha();
    for (const action of ['owner', 'member add', 'member remove', 'leave', 'list', 'requests']) {
      expect(await run(action, { member: user(5), role: 'manager' }, member(9))).toEqual([
        {
          content: "Tu n'es pas responsable de cette équipe, ni d'aucune équipe de cette saison.",
          ephemeral: true,
        },
      ]);
    }
  });
});

describe('/team, as a command', () => {
  it('is open to every member in a server, never in direct messages', () => {
    expect(teamCommand.data.default_member_permissions).toBeUndefined();
    expect(teamCommand.data.contexts).toEqual([0]);
  });

  it('suggests every team to league staff, and their own to a team’s officials', async () => {
    const { db } = await alpha();
    const suggest = async (value: string, who: FakeInput = STAFF, name = 'team') => {
      const interaction = fakeAutocomplete('team', { name, value }, who);
      await teamCommand.autocomplete?.(interaction, fakeContext({ db }));
      return interaction.responses[0];
    };
    expect(await suggest('br')).toEqual([{ name: 'Bravo (BRV) · Ligue 1', value: 2 }]);
    expect(await suggest('')).toHaveLength(5);
    expect(await suggest('', member(2))).toEqual([
      { name: 'Alpha Esport (ALP) · Ligue 1', value: 1 },
    ]);
    expect(await suggest('', member(9))).toEqual([]);
    expect(await suggest('', STAFF, 'member')).toEqual([]);
  });
});
