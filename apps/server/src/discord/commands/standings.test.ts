import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fakeAssetStore } from '../../assets/store.ts';
import { leagueDatabase, TEST_GUILD } from '../../testing.ts';
import { formatStandingsTable } from '../standings-table.ts';
import { fakeContext, fakeInteraction } from '../testing.ts';
import { standingsCommand } from './standings.ts';

const interact = async (
  input: Parameters<typeof fakeInteraction>[1],
  context = fakeContext({ db: leagueDatabase() }),
) => {
  const interaction = fakeInteraction('standings', input);
  await standingsCommand.execute(interaction, context);
  return interaction;
};
const run = async (...args: Parameters<typeof interact>) => (await interact(...args)).replies;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

describe('/standings', () => {
  it('posts one image per division by default, after telling Discord it is coming', async () => {
    const interaction = await interact({ guildId: TEST_GUILD });
    expect(interaction.deferred).toBe(true);
    expect(interaction.replies).toMatchObject([{ content: '', ephemeral: false }]);
    const files = interaction.replies[0]?.files ?? [];
    expect(files.map((file) => file.name)).toEqual([
      'standings-ligue-1.png',
      'standings-ligue-2.png',
    ]);
    for (const file of files) expect([...file.data.slice(0, 8)]).toEqual(PNG_SIGNATURE);
  });

  it("draws a team's logo from the asset store, and its colours when the logo is missing", async () => {
    // A 1 x 1 PNG: enough for the renderer to decode.
    const dot = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    const image = async (logos: Record<string, Uint8Array>) => {
      const db = leagueDatabase();
      db.update(schema.team)
        .set({ logoKey: 'logos/alpha.png' })
        .where(eq(schema.team.tag, 'ALP'))
        .run();
      const context = fakeContext({ db, assets: fakeAssetStore(logos) });
      const [reply] = await run({ guildId: TEST_GUILD, options: { division: 'l1' } }, context);
      return Buffer.from(reply?.files?.[0]?.data ?? []);
    };
    const withLogo = await image({ 'logos/alpha.png': dot });
    const withoutLogo = await image({});
    expect(withLogo.length).toBeGreaterThan(0);
    expect(withLogo.equals(withoutLogo)).toBe(false);
  });

  it('posts a single image for one division', async () => {
    const [reply] = await run({
      guildId: TEST_GUILD,
      options: { division: 'l2', format: 'image' },
    });
    expect(reply?.files?.map((file) => file.name)).toEqual(['standings-ligue-2.png']);
  });

  it('posts every division as a monospace table when asked for text', async () => {
    const interaction = await interact({ guildId: TEST_GUILD, options: { format: 'text' } });
    expect(interaction.deferred).toBe(false);
    expect(interaction.replies).toEqual([
      {
        ephemeral: false,
        content: [
          '**LFR · Saison 3 · Ligue 1**',
          '```',
          '#  Équipe  MJ  W  L  RW  RL  Diff  PTS',
          '1  ALP      2  2  0   7   4    +3    6',
          '2  CHA      1  0  1   0   0     0    0',
          '3  BRV      1  0  1   4   7    -3    0',
          '```',
          '**LFR · Saison 3 · Ligue 2**',
          '```',
          '#  Équipe  MJ  W  L  RW  RL  Diff  PTS',
          '1  XRA      1  1  0   8   6    +2    3',
          '2  YAN      1  0  1   6   8    -2    0',
          '```',
        ].join('\n'),
      },
    ]);
  });

  it('posts one division when asked, with English headers in English', async () => {
    const context = fakeContext({ db: leagueDatabase(), locale: 'en' });
    const [reply] = await run(
      { guildId: TEST_GUILD, options: { division: 'L2', format: 'text' } },
      context,
    );
    expect(reply?.content).toBe(
      [
        '**LFR · Saison 3 · Ligue 2**',
        '```',
        '#  Team  MP  W  L  RW  RL  Diff  PTS',
        '1  XRA    1  1  0   8   6    +2    3',
        '2  YAN    1  0  1   6   8    -2    0',
        '```',
      ].join('\n'),
    );
  });

  it.each([
    [{ guildId: null }, "Ce serveur n'est relié à aucune ligue."],
    [{ guildId: '999999999999999999' }, "Ce serveur n'est relié à aucune ligue."],
    [
      { guildId: TEST_GUILD, options: { division: 'Ligue 9' } },
      'Division inconnue. Divisions : Ligue 1, Ligue 2.',
    ],
  ])('answers a request it cannot serve privately: %j', async (input, content) => {
    const interaction = await interact(input);
    expect(interaction.replies).toEqual([{ content, ephemeral: true }]);
    // A deferral is public: a private refusal must be sent without one.
    expect(interaction.deferred).toBe(false);
  });
});

describe('formatStandingsTable', () => {
  const row = (rank: number, tag: string, diff: number, points: number) => ({
    rank,
    shared: false,
    team: { name: tag, tag, colors: [], logoKey: null },
    played: 10,
    wins: 9,
    losses: 1,
    scoreFor: 68,
    scoreAgainst: 68 - diff,
    diff,
    points,
    form: [],
    change: null,
    zone: null,
    excluded: false,
  });

  it('aligns numbers to the right and widens columns to their longest value', () => {
    const table = {
      division: 'Ligue 1',
      rows: [row(1, 'NIGHTWOLVES', 27, 27), row(10, 'RCK', -11, 3)],
    };
    expect(formatStandingsTable('fr', table).split('\n')).toEqual([
      ' #  Équipe       MJ  W  L  RW  RL  Diff  PTS',
      ' 1  NIGHTWOLVES  10  9  1  68  41   +27   27',
      '10  RCK          10  9  1  68  79   -11    3',
    ]);
  });

  it('stays narrow enough for a phone with the longest tags of Season 3', () => {
    const table = { division: 'Ligue 1', rows: [row(10, 'NIGHTWOLVES', -100, 27)] };
    for (const line of formatStandingsTable('fr', table).split('\n')) {
      expect(line.length).toBeLessThanOrEqual(46);
    }
  });
});
