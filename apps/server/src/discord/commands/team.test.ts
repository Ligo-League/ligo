import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../../testing.ts';
import { fakeAutocomplete, fakeContext, fakeInteraction, type FakeInput } from '../testing.ts';
import { teamCommand } from './team.ts';

const STAFF: FakeInput = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const user = (n: number) => ({ user: { id: `70000000000000000${n}`, displayName: `Member ${n}` } });
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
  const context = fakeContext({ db: leagueDatabase() });
  return async (...args: Parameters<typeof input>) => {
    const interaction = fakeInteraction('team', input(...args));
    await teamCommand.execute(interaction, context);
    return interaction.replies;
  };
}

describe('/team', () => {
  it('sets the manager, adds staff, and shows the team each time, privately', async () => {
    const run = session();
    expect(await run('manager', { team: 1, member: user(1) })).toEqual([
      {
        content: 'Alpha Esport (ALP) : manager <@700000000000000001> ; staff aucun.',
        ephemeral: true,
      },
    ]);
    await run('staff add', { team: 1, member: user(2) });
    expect((await run('staff add', { team: 1, member: user(3) }))[0]?.content).toBe(
      'Alpha Esport (ALP) : manager <@700000000000000001> ; staff <@700000000000000002>, <@700000000000000003>.',
    );
    expect((await run('staff remove', { team: 1, member: user(1) }))[0]?.content).toBe(
      'Alpha Esport (ALP) : manager aucun ; staff <@700000000000000002>, <@700000000000000003>.',
    );
    expect((await run('staff list', { team: 1 }))[0]?.content).toBe(
      'Alpha Esport (ALP) : manager aucun ; staff <@700000000000000002>, <@700000000000000003>.',
    );
  });

  it('explains each refusal privately', async () => {
    const run = session();
    const reply = async (...args: Parameters<typeof input>) => (await run(...args))[0];
    await run('manager', { team: 1, member: user(1) });
    for (const n of [2, 3, 4]) await run('staff add', { team: 1, member: user(n) });

    expect(await reply('staff add', { team: 1, member: user(5) })).toEqual({
      content: 'Cette équipe a déjà 3 membres de staff, le maximum prévu par la ligue.',
      ephemeral: true,
    });
    expect((await reply('staff add', { team: 1, member: user(2) }))?.content).toBe(
      'Ce membre a déjà ce rôle dans cette équipe.',
    );
    expect((await reply('staff remove', { team: 1, member: user(9) }))?.content).toBe(
      "Ce membre n'est ni manager ni staff de cette équipe.",
    );
    expect((await reply('manager', { team: 99, member: user(1) }))?.content).toBe(
      'Équipe introuvable dans la saison en cours. Choisis-la dans la liste proposée.',
    );
    expect((await reply('manager', { team: 'alpha', member: user(1) }))?.content).toBe(
      'Équipe introuvable dans la saison en cours. Choisis-la dans la liste proposée.',
    );
    expect((await reply('manager', { team: 1 }))?.content).toBe('Commande inconnue.');
    expect((await reply('rename', { team: 1, member: user(1) }))?.content).toBe(
      'Commande inconnue.',
    );
  });

  it.each(['manager', 'staff add', 'staff remove', 'staff list'])(
    'refuses "%s" to a member who is not league staff',
    async (action) => {
      const run = session();
      expect(
        await run(action, { team: 1, member: user(1) }, { ...STAFF, memberRoleIds: [] }),
      ).toEqual([
        { content: 'Cette commande est réservée au staff de la ligue.', ephemeral: true },
      ]);
    },
  );

  it('is hidden from members by default and cannot be used in direct messages', () => {
    expect(teamCommand.data.default_member_permissions).toBe('0');
    expect(teamCommand.data.contexts).toEqual([0]);
  });

  it('suggests teams of the current season to league staff only', async () => {
    const suggest = async (value: string, who: FakeInput = STAFF, name = 'team') => {
      const interaction = fakeAutocomplete('team', { name, value }, who);
      await teamCommand.autocomplete?.(interaction, fakeContext({ db: leagueDatabase() }));
      return interaction.responses[0];
    };
    expect(await suggest('br')).toEqual([{ name: 'Bravo (BRV) · Ligue 1', value: 2 }]);
    expect(await suggest('')).toHaveLength(5);
    expect(await suggest('', { ...STAFF, memberRoleIds: [] })).toEqual([]);
    expect(await suggest('', STAFF, 'member')).toEqual([]);
  });
});
