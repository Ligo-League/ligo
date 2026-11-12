import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD } from '../../testing.ts';
import { formatStandingsTable } from '../standings-table.ts';
import { fakeContext, fakeInteraction } from '../testing.ts';
import { standingsCommand } from './standings.ts';

const run = async (
  input: Parameters<typeof fakeInteraction>[1],
  context = fakeContext({ db: leagueDatabase() }),
) => {
  const interaction = fakeInteraction('standings', input);
  await standingsCommand.execute(interaction, context);
  return interaction.replies;
};

describe('/standings', () => {
  it('posts every division as a monospace table, visible to everyone', async () => {
    expect(await run({ guildId: TEST_GUILD })).toEqual([
      {
        ephemeral: false,
        content: [
          '**LFR · Saison 3 · Ligue 1**',
          '```',
          '#  Équipe  J  V  D  F  C  Diff  PTS',
          '1  ALP     2  2  0  7  4    +3    6',
          '2  CHA     1  0  1  0  0     0    0',
          '3  BRV     1  0  1  4  7    -3    0',
          '```',
          '**LFR · Saison 3 · Ligue 2**',
          '```',
          '#  Équipe  J  V  D  F  C  Diff  PTS',
          '1  XRA     1  1  0  8  6    +2    3',
          '2  YAN     1  0  1  6  8    -2    0',
          '```',
        ].join('\n'),
      },
    ]);
  });

  it('posts one division when asked, with English headers in English', async () => {
    const context = fakeContext({ db: leagueDatabase(), locale: 'en' });
    const [reply] = await run({ guildId: TEST_GUILD, options: { division: 'L2' } }, context);
    expect(reply?.content).toBe(
      [
        '**LFR · Saison 3 · Ligue 2**',
        '```',
        '#  Team  P  W  L  F  A  Diff  PTS',
        '1  XRA   1  1  0  8  6    +2    3',
        '2  YAN   1  0  1  6  8    -2    0',
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
    expect(await run(input)).toEqual([{ content, ephemeral: true }]);
  });
});

describe('formatStandingsTable', () => {
  const row = (rank: number, tag: string, diff: number, points: number) => ({
    rank,
    shared: false,
    team: { name: tag, tag, colors: [] },
    played: 10,
    wins: 9,
    losses: 1,
    scoreFor: 68,
    scoreAgainst: 68 - diff,
    diff,
    points,
  });

  it('aligns numbers to the right and widens columns to their longest value', () => {
    const table = {
      division: 'Ligue 1',
      rows: [row(1, 'NIGHTWOLVES', 27, 27), row(10, 'RCK', -11, 3)],
    };
    expect(formatStandingsTable('fr', table).split('\n')).toEqual([
      ' #  Équipe        J  V  D   F   C  Diff  PTS',
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
