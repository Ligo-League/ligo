import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../../testing.ts';
import { fakeContext, fakeGateway, fakeInteraction, type FakeInput } from '../testing.ts';
import { leagueCommand } from './league.ts';

const STAFF: FakeInput = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const QUEUE = '800000000000000001';
const RESULTS = '800000000000000002';
const channel = (kind: string, id: string, who: FakeInput = STAFF): FakeInput => ({
  ...who,
  subcommand: 'channel',
  options: { kind, channel: { channel: { id } } },
});

function session() {
  const gateway = fakeGateway();
  const context = fakeContext({ db: leagueDatabase(), gateway });
  const run = async (input: FakeInput) => {
    const interaction = fakeInteraction('league', input);
    await leagueCommand.execute(interaction, context);
    return interaction.replies;
  };
  const stored = () => context.db.select().from(schema.leagueGuild).get();
  return { run, gateway, stored, db: context.db };
}

describe('/league channel', () => {
  it('stores the staff queue channel after posting a notice in it', async () => {
    const { run, gateway, stored } = session();
    expect(await run(channel('staff_queue', QUEUE))).toEqual([
      {
        content: `Salon enregistré : File de validation du staff dans <#${QUEUE}>.`,
        ephemeral: true,
      },
    ]);
    expect(gateway.posted).toMatchObject([
      {
        channelId: QUEUE,
        message: {
          content:
            'Les résultats signalés par les équipes arriveront ici pour être validés par le staff.',
        },
      },
    ]);
    expect(stored()).toMatchObject({ alertsChannelId: QUEUE, resultsChannelId: null });
  });

  it('stores the results channel separately, and a later choice replaces it', async () => {
    const { run, stored } = session();
    await run(channel('staff_queue', QUEUE));
    await run(channel('results', RESULTS));
    expect(stored()).toMatchObject({ alertsChannelId: QUEUE, resultsChannelId: RESULTS });
    await run(channel('results', QUEUE));
    expect(stored()).toMatchObject({ alertsChannelId: QUEUE, resultsChannelId: QUEUE });
  });

  it('audits each change with the channel before and after', async () => {
    const { run, db } = session();
    await run(channel('results', RESULTS));
    await run(channel('results', QUEUE));
    const entries = db
      .select()
      .from(schema.auditLog)
      .all()
      .filter((row) => row.action === 'league.channel.set');
    expect(entries).toMatchObject([
      {
        actorKind: 'user',
        entity: 'league_guild',
        entityId: TEST_GUILD,
        beforeJson: { kind: 'results', channelId: null },
        afterJson: { kind: 'results', channelId: RESULTS },
      },
      { beforeJson: { channelId: RESULTS }, afterJson: { channelId: QUEUE } },
    ]);
  });

  it('stores nothing when the bot cannot write in the channel', async () => {
    const { run, gateway, stored } = session();
    gateway.failing = true;
    expect((await run(channel('staff_queue', QUEUE)))[0]).toEqual({
      content:
        'Je ne peux pas écrire dans ce salon. Donne-moi « Voir le salon » et « Envoyer des messages », puis réessaie.',
      ephemeral: true,
    });
    expect(stored()).toMatchObject({ alertsChannelId: null });
  });

  it('refuses a member who is not league staff before posting anything', async () => {
    const { run, gateway, stored } = session();
    expect(await run(channel('staff_queue', QUEUE, { ...STAFF, memberRoleIds: [] }))).toEqual([
      { content: 'Cette commande est réservée au staff de la ligue.', ephemeral: true },
    ]);
    expect(gateway.posted).toEqual([]);
    expect(stored()).toMatchObject({ alertsChannelId: null });
  });

  it('answers an unknown kind or a missing channel as an unknown command', async () => {
    const { run } = session();
    expect((await run(channel('announcements', QUEUE)))[0]?.content).toBe('Commande inconnue.');
    expect(
      (await run({ ...STAFF, subcommand: 'channel', options: { kind: 'results' } }))[0]?.content,
    ).toBe('Commande inconnue.');
  });
});
