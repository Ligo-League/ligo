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
import { leagueCommand } from './league.ts';

const STAFF: FakeInput = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const QUEUE = '800000000000000001';
const RESULTS = '800000000000000002';
const L1_RESULTS = '800000000000000003';
const channel = (kind: string, id: string, who: FakeInput = STAFF): FakeInput => ({
  ...who,
  subcommand: 'channel',
  options: { kind, channel: { channel: { id } } },
});
// In leagueDatabase(), division 1 is Ligue 1 and division 2 is Ligue 2.
const divisionChannel = (division: number, id?: string): FakeInput => ({
  ...STAFF,
  subcommand: 'channel',
  options: { kind: 'results', division, ...(id ? { channel: { channel: { id } } } : {}) },
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
  const divisions = () =>
    context.db
      .select({ name: schema.division.name, channel: schema.division.resultsChannelId })
      .from(schema.division)
      .all();
  return { run, gateway, stored, divisions, db: context.db, context };
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

  it('answers an unknown kind as an unknown command, and asks for a missing channel', async () => {
    const { run } = session();
    expect((await run(channel('announcements', QUEUE)))[0]?.content).toBe('Commande inconnue.');
    expect(
      (await run({ ...STAFF, subcommand: 'channel', options: { kind: 'results' } }))[0]?.content,
    ).toBe('Choisis le salon à utiliser.');
  });
});

describe('/league channel for one division', () => {
  it("gives a division its own results channel, leaving the league's and the others' alone", async () => {
    const { run, gateway, stored, divisions } = session();
    await run(channel('results', RESULTS));
    expect(await run(divisionChannel(1, L1_RESULTS))).toEqual([
      {
        content: `Salon enregistré : Résultats validés de Ligue 1 dans <#${L1_RESULTS}>.`,
        ephemeral: true,
      },
    ]);
    expect(gateway.posted.at(-1)).toMatchObject({
      channelId: L1_RESULTS,
      message: { content: 'Les résultats validés de Ligue 1 seront annoncés ici.' },
    });
    expect(stored()).toMatchObject({ resultsChannelId: RESULTS });
    expect(divisions()).toEqual([
      { name: 'Ligue 1', channel: L1_RESULTS },
      { name: 'Ligue 2', channel: null },
    ]);
  });

  it('lets two divisions share a channel', async () => {
    const { run, divisions } = session();
    await run(divisionChannel(1, L1_RESULTS));
    await run(divisionChannel(2, L1_RESULTS));
    expect(divisions().map((row) => row.channel)).toEqual([L1_RESULTS, L1_RESULTS]);
  });

  it("removes a division's channel when none is given, so the league's is used again", async () => {
    const { run, gateway, divisions, db } = session();
    await run(divisionChannel(1, L1_RESULTS));
    const posts = gateway.posted.length;
    expect(await run(divisionChannel(1))).toEqual([
      {
        content:
          "Ligue 1 n'a plus son propre salon : ses résultats seront annoncés dans celui de la ligue.",
        ephemeral: true,
      },
    ]);
    expect(gateway.posted).toHaveLength(posts);
    expect(divisions()[0]?.channel).toBeNull();
    const audit = db
      .select()
      .from(schema.auditLog)
      .all()
      .filter((row) => row.entity === 'division');
    expect(audit).toMatchObject([
      { entityId: '1', afterJson: { kind: 'results', channelId: L1_RESULTS } },
      { entityId: '1', beforeJson: { channelId: L1_RESULTS }, afterJson: { channelId: null } },
    ]);
  });

  it.each([
    [
      {
        ...divisionChannel(1, QUEUE),
        options: { kind: 'staff_queue', division: 1, channel: { channel: { id: QUEUE } } },
      },
      'La file de validation est commune à toute la ligue : choisis-la sans division.',
    ],
    [divisionChannel(99, L1_RESULTS), 'Division inconnue. Choisis-la dans la liste proposée.'],
  ])('refuses privately and stores nothing: %#', async (input, content) => {
    const { run, gateway, divisions } = session();
    expect(await run(input)).toEqual([{ content, ephemeral: true }]);
    expect(gateway.posted).toEqual([]);
    expect(divisions().every((row) => row.channel === null)).toBe(true);
  });

  it("suggests the current season's divisions to staff only", async () => {
    const { context } = session();
    const suggest = async (who: FakeInput, value = '') => {
      const interaction = fakeAutocomplete(
        'league',
        { name: 'division', value },
        { ...who, subcommand: 'channel' },
      );
      await leagueCommand.autocomplete?.(interaction, context);
      return interaction.responses[0];
    };
    expect(await suggest(STAFF)).toEqual([
      { name: 'Ligue 1 (L1)', value: 1 },
      { name: 'Ligue 2 (L2)', value: 2 },
    ]);
    expect(await suggest(STAFF, 'l2')).toEqual([{ name: 'Ligue 2 (L2)', value: 2 }]);
    expect(await suggest({ ...STAFF, memberRoleIds: [] })).toEqual([]);
  });
});

describe('/league channels', () => {
  it('shows every channel the bot uses, with what each division falls back to', async () => {
    const { run } = session();
    const list = async () =>
      (await run({ ...STAFF, subcommand: 'channels' }))[0]?.content.split('\n');
    expect(await list()).toEqual([
      '**Salons du bot**',
      'File de validation du staff : non choisi',
      'Résultats validés : non choisi',
      '• Ligue 1 : celui de la ligue',
      '• Ligue 2 : celui de la ligue',
    ]);
    await run(channel('staff_queue', QUEUE));
    await run(channel('results', RESULTS));
    await run(divisionChannel(2, L1_RESULTS));
    expect(await list()).toEqual([
      '**Salons du bot**',
      `File de validation du staff : <#${QUEUE}>`,
      `Résultats validés : <#${RESULTS}>`,
      '• Ligue 1 : celui de la ligue',
      `• Ligue 2 : <#${L1_RESULTS}>`,
    ]);
  });

  it('is for league staff only', async () => {
    const { run } = session();
    expect(await run({ ...STAFF, memberRoleIds: [], subcommand: 'channels' })).toEqual([
      { content: 'Cette commande est réservée au staff de la ligue.', ephemeral: true },
    ]);
  });
});
