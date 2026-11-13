import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../../testing.ts';
import { fakeAutocomplete, fakeContext, fakeInteraction, type FakeInput } from '../testing.ts';
import { matchCommand } from './match.ts';

const STAFF: FakeInput = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
// In leagueDatabase(): match 3 is Bravo v Charlie (Ligue 1, week 3), still to play.
const result = (options: FakeInput['options'], who: FakeInput = STAFF): FakeInput => ({
  ...who,
  subcommand: 'result',
  options,
});

async function run(input: FakeInput, context = fakeContext({ db: leagueDatabase() })) {
  const interaction = fakeInteraction('match', input);
  await matchCommand.execute(interaction, context);
  return { replies: interaction.replies, db: context.db };
}

describe('/match result', () => {
  it('records the result and confirms it privately, naming both teams', async () => {
    const { replies, db } = await run(result({ match: 3, score_a: 7, score_b: 5 }));
    expect(replies).toEqual([
      {
        content: 'Résultat enregistré : Ligue 1, semaine 3, Bravo 7–5 Charlie.',
        ephemeral: true,
      },
    ]);
    expect(db.select().from(schema.match).all()[2]).toMatchObject({
      status: 'validated',
      validatedAt: 1_800_000_000_000,
    });
  });

  it('says what it replaced when correcting a result', async () => {
    const context = fakeContext({ db: leagueDatabase(), locale: 'en' });
    await run(result({ match: 3, score_a: 7, score_b: 5 }), context);
    const { replies } = await run(result({ match: 3, score_a: 5, score_b: 7 }), context);
    expect(replies[0]?.content).toBe(
      'Result corrected: Ligue 1, week 3, Bravo 5–7 Charlie (was 7–5).',
    );
  });

  it('passes the attached screenshot on as evidence', async () => {
    const screenshot = {
      url: 'https://cdn.discordapp.com/attachments/1/2/score.png',
      contentType: 'image/png',
      size: 1000,
    };
    const { db } = await run(result({ match: 3, score_a: 7, score_b: 5, screenshot }));
    expect(db.select().from(schema.evidence).all()).toMatchObject([
      { matchId: 3, kind: 'score_screenshot', url: screenshot.url },
    ]);
  });

  it.each([
    [
      'a member without the staff role',
      result({ match: 3, score_a: 7, score_b: 5 }, { ...STAFF, memberRoleIds: [] }),
      'Cette commande est réservée au staff de la ligue.',
    ],
    [
      'a draw',
      result({ match: 3, score_a: 6, score_b: 6 }),
      "Score invalide : deux nombres entiers différents, il n'y a pas de match nul.",
    ],
    [
      'a score a map cannot end on',
      result({ match: 3, score_a: 6, score_b: 7 }),
      'Score impossible avec le règlement de la ligue : une carte se termine entre 7–0 et 7–5, ou en prolongation (8–6, 8–7).',
    ],
    [
      'a forfeit',
      result({ match: 2, score_a: 7, score_b: 5 }),
      'Ce match est un forfait ou a été annulé : son résultat ne se modifie pas ici.',
    ],
    [
      'an unknown match',
      result({ match: 99, score_a: 7, score_b: 5 }),
      'Match introuvable dans cette ligue. Choisis-le dans la liste proposée.',
    ],
    [
      'a match typed as text instead of picked',
      result({ match: 'bravo', score_a: 7, score_b: 5 }),
      'Match introuvable dans cette ligue. Choisis-le dans la liste proposée.',
    ],
    [
      'a file that is not an image',
      result({
        match: 3,
        score_a: 7,
        score_b: 5,
        screenshot: {
          url: 'https://cdn.discordapp.com/a.pdf',
          contentType: 'application/pdf',
          size: 9,
        },
      }),
      'La capture doit être une image PNG, JPEG ou WebP de moins de 20 Mo, jointe à la commande.',
    ],
    ['an unknown subcommand', { ...STAFF, subcommand: 'delete' }, 'Commande inconnue.'],
  ])('refuses %s privately and stores nothing', async (_name, input, content) => {
    const { replies, db } = await run(input);
    expect(replies).toEqual([{ content, ephemeral: true }]);
    expect(db.select().from(schema.match).all()[2]?.status).toBe('scheduled');
    expect(
      db
        .select()
        .from(schema.auditLog)
        .all()
        .filter((row) => row.actorKind === 'user'),
    ).toEqual([]);
  });

  it('shows how overtime continues when the rule lets it repeat', async () => {
    const db = leagueDatabase();
    db.update(schema.competition)
      .set({
        rulesetJson: {
          result_validation: 'staff',
          game_score: { win_at: 13, overtime_rounds: 2 },
          team_staff_max: 3,
        },
      })
      .run();
    const context = fakeContext({ db, locale: 'en' });
    const { replies } = await run(result({ match: 3, score_a: 7, score_b: 5 }), context);
    expect(replies[0]?.content).toBe(
      'That score cannot happen under the league rules: a map ends between 13–0 and 13–11, or in overtime (14–12, 15–13…).',
    );
  });

  it('is hidden from members by default and cannot be used in direct messages', () => {
    expect(matchCommand.data.default_member_permissions).toBe('0');
    expect(matchCommand.data.contexts).toEqual([0]);
  });
});

describe('/match result suggestions', () => {
  const suggest = async (value: string, who: FakeInput = STAFF, name = 'match') => {
    const interaction = fakeAutocomplete(
      'match',
      { name, value },
      { ...who, subcommand: 'result' },
    );
    await matchCommand.autocomplete?.(interaction, fakeContext({ db: leagueDatabase() }));
    return interaction.responses;
  };

  it('offers the matches still to play first, then those with a result', async () => {
    expect(await suggest('')).toEqual([
      [
        { name: 'L1 · S3 · BRV – CHA', value: 3 },
        { name: 'L1 · S1 · ALP 7–4 BRV', value: 1 },
        { name: 'L2 · S1 · XRA 8–6 YAN', value: 4 },
      ],
    ]);
  });

  it('narrows as the member types', async () => {
    expect(await suggest('cha')).toEqual([[{ name: 'L1 · S3 · BRV – CHA', value: 3 }]]);
  });

  it('offers nothing to a member who is not staff, or for another option', async () => {
    expect(await suggest('', { ...STAFF, memberRoleIds: [] })).toEqual([[]]);
    expect(await suggest('', STAFF, 'score_a')).toEqual([[]]);
  });
});
