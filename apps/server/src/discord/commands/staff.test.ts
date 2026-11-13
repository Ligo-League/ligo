import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../../testing.ts';
import {
  fakeAutocomplete,
  fakeContext,
  fakeGateway,
  fakeInteraction,
  type FakeInput,
} from '../testing.ts';
import { staffCommand } from './staff.ts';

const STAFF: FakeInput = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
// In leagueDatabase(): match 3 is Bravo v Charlie (Ligue 1, week 3), still to play.
const staffMatch = (
  subcommand: string,
  options: FakeInput['options'],
  who: FakeInput = STAFF,
): FakeInput => ({ ...who, subcommandGroup: 'match', subcommand, options });
const result = (options: FakeInput['options'], who: FakeInput = STAFF) =>
  staffMatch('result', options, who);

async function run(input: FakeInput, context = fakeContext({ db: leagueDatabase() })) {
  const interaction = fakeInteraction('staff', input);
  await staffCommand.execute(interaction, context);
  return { replies: interaction.replies, db: context.db };
}

async function suggestFor(
  value: string,
  who: FakeInput = STAFF,
  name = 'match',
  subcommand = 'result',
  db = leagueDatabase(),
) {
  const interaction = fakeAutocomplete(
    'staff',
    { name, value },
    { ...who, subcommandGroup: 'match', subcommand },
  );
  await staffCommand.autocomplete?.(interaction, fakeContext({ db }));
  return interaction.responses;
}

describe('/staff match result', () => {
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

  it('announces the result, then its correction, in the results channel', async () => {
    const db = leagueDatabase();
    db.update(schema.leagueGuild).set({ resultsChannelId: '800000000000000002' }).run();
    const gateway = fakeGateway();
    const context = fakeContext({ db, gateway });
    await run(result({ match: 3, score_a: 7, score_b: 5 }), context);
    await run(result({ match: 3, score_a: 5, score_b: 7 }), context);
    expect(gateway.posted).toMatchObject([
      {
        channelId: '800000000000000002',
        message: { content: 'Résultat validé — Ligue 1, semaine 3 : Bravo 7–5 Charlie.' },
      },
      {
        channelId: '800000000000000002',
        message: {
          content: 'Résultat corrigé — Ligue 1, semaine 3 : Bravo 5–7 Charlie (au lieu de 7–5).',
        },
      },
    ]);
  });

  it("announces in the division's own channel when it has one, else in the league's", async () => {
    const db = leagueDatabase();
    db.update(schema.leagueGuild).set({ resultsChannelId: '800000000000000002' }).run();
    db.update(schema.division)
      .set({ resultsChannelId: '800000000000000003' })
      .where(eq(schema.division.name, 'Ligue 1'))
      .run();
    const gateway = fakeGateway();
    const context = fakeContext({ db, gateway });
    // Match 3 is in Ligue 1; match 4 (Xray v Yankee) is in Ligue 2 and already has a result.
    await run(result({ match: 3, score_a: 7, score_b: 5 }), context);
    await run(result({ match: 4, score_a: 7, score_b: 5 }), context);
    expect(gateway.posted.map((post) => post.channelId)).toEqual([
      '800000000000000003',
      '800000000000000002',
    ]);
  });

  it('records the result even when no results channel is set', async () => {
    const gateway = fakeGateway();
    const { db } = await run(
      result({ match: 3, score_a: 7, score_b: 5 }),
      fakeContext({ db: leagueDatabase(), gateway }),
    );
    expect(gateway.posted).toEqual([]);
    expect(db.select().from(schema.match).all()[2]?.status).toBe('validated');
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
    ['an unknown subcommand', staffMatch('delete', { match: 3 }), 'Commande inconnue.'],
    [
      'an unknown group',
      { ...STAFF, subcommand: 'result', options: { match: 3 } },
      'Commande inconnue.',
    ],
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
    expect(staffCommand.data.default_member_permissions).toBe('0');
    expect(staffCommand.data.contexts).toEqual([0]);
  });
});

describe('/staff match suggestions', () => {
  const suggest = async (value: string, who: FakeInput = STAFF, name = 'match') =>
    suggestFor(value, who, name);

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

describe('/staff match validate and void', () => {
  const RESULTS = '800000000000000002';
  // A database where match 3 (Bravo v Charlie) was reported 7-5 and waits for staff.
  function reported() {
    const db = leagueDatabase();
    db.update(schema.leagueGuild).set({ resultsChannelId: RESULTS }).run();
    db.insert(schema.game)
      .values({ matchId: 3, n: 1, bansJson: [], scoreA: 7, scoreB: 5, status: 'pending' })
      .run();
    db.update(schema.match).set({ status: 'reported' }).where(eq(schema.match.id, 3)).run();
    const gateway = fakeGateway();
    return { context: fakeContext({ db, gateway }), db, gateway };
  }

  it('validates a reported result, announces it and confirms privately', async () => {
    const { context, db, gateway } = reported();
    const { replies } = await run(staffMatch('validate', { match: 3 }), context);
    expect(replies).toEqual([
      { content: 'Résultat validé : Ligue 1, semaine 3 : Bravo 7–5 Charlie.', ephemeral: true },
    ]);
    expect(db.select().from(schema.match).all()[2]?.status).toBe('validated');
    expect(gateway.posted).toMatchObject([
      {
        channelId: RESULTS,
        message: { content: 'Résultat validé — Ligue 1, semaine 3 : Bravo 7–5 Charlie.' },
      },
    ]);
  });

  it('still validates when the results channel cannot be reached', async () => {
    const { context, db, gateway } = reported();
    gateway.failing = true;
    const { replies } = await run(staffMatch('validate', { match: 3 }), context);
    expect(replies[0]?.content).toContain('Résultat validé');
    expect(db.select().from(schema.match).all()[2]?.status).toBe('validated');
  });

  it('annuls a match with its reason', async () => {
    const { context, db } = reported();
    const { replies } = await run(
      staffMatch('void', { match: 1, reason: 'Joueur non inscrit' }),
      context,
    );
    expect(replies).toEqual([
      { content: 'Match annulé : Ligue 1, semaine 1 : Alpha Esport – Bravo.', ephemeral: true },
    ]);
    expect(db.select().from(schema.match).all()[0]?.status).toBe('void');
  });

  it.each([
    [
      staffMatch('validate', { match: 1 }),
      "Ce match n'attend pas cette action : il a déjà été traité.",
    ],
    [staffMatch('void', { match: 1, reason: '  ' }), 'Un motif est nécessaire.'],
    [staffMatch('void', { match: 1 }), 'Un motif est nécessaire.'],
    [
      staffMatch('validate', { match: 3 }, { ...STAFF, memberRoleIds: [] }),
      'Cette commande est réservée au staff de la ligue.',
    ],
    [
      staffMatch('void', { match: 3, reason: 'x' }, { ...STAFF, memberRoleIds: [] }),
      'Cette commande est réservée au staff de la ligue.',
    ],
  ])('refuses privately: %j', async (input, content) => {
    const { context, gateway } = reported();
    expect((await run(input, context)).replies).toEqual([{ content, ephemeral: true }]);
    expect(gateway.posted).toEqual([]);
  });

  it('suggests the matches each action applies to', async () => {
    const { db } = reported();
    const ids = async (subcommand: string) =>
      (await suggestFor('', STAFF, 'match', subcommand, db))[0]?.map((choice) => choice.value);
    expect(await ids('validate')).toEqual([3]);
    expect(await ids('void')).toEqual([1, 2, 3, 4]);
  });
});

describe('/staff match forfeit', () => {
  const QUEUE = '800000000000000001';
  function league() {
    const db = leagueDatabase();
    db.update(schema.leagueGuild).set({ alertsChannelId: QUEUE }).run();
    const gateway = fakeGateway();
    return { context: fakeContext({ db, gateway }), db, gateway };
  }

  it('records the forfeit and names the team, privately', async () => {
    const { context, db } = league();
    // Match 3 is Bravo v Charlie; Bravo (the first team named) forfeits.
    const { replies } = await run(staffMatch('forfeit', { match: 3, team: 'a' }), context);
    expect(replies).toEqual([
      {
        content:
          'Forfait enregistré : Ligue 1, semaine 3 : Bravo – Charlie. Bravo déclare forfait (1 cette saison).',
        ephemeral: true,
      },
    ]);
    expect(db.select().from(schema.match).all()[2]?.status).toBe('forfeit');
  });

  it('announces the forfeit in the results channel', async () => {
    const { context, db, gateway } = league();
    db.update(schema.leagueGuild).set({ resultsChannelId: '800000000000000002' }).run();
    await run(staffMatch('forfeit', { match: 3, team: 'b' }), context);
    expect(gateway.posted).toMatchObject([
      {
        channelId: '800000000000000002',
        message: {
          content: 'Forfait — Ligue 1, semaine 3 : Bravo – Charlie. Charlie déclare forfait.',
        },
      },
    ]);
  });

  it('says when the automatic warning was added, and stores its reason in French', async () => {
    const { context, db, gateway } = league();
    // Charlie already forfeited match 2: its second forfeit reaches the warning threshold.
    const { replies } = await run(staffMatch('forfeit', { match: 3, team: 'b' }), context);
    expect(replies[0]?.content).toBe(
      [
        'Forfait enregistré : Ligue 1, semaine 3 : Bravo – Charlie. Charlie déclare forfait (2 cette saison).',
        'Un avertissement a été ajouté automatiquement à Charlie.',
      ].join('\n'),
    );
    expect(db.select().from(schema.sanction).all()).toMatchObject([
      { kind: 'warning', reason: 'Avertissement automatique : 2 forfaits cette saison.' },
    ]);
    expect(gateway.posted).toEqual([]);
  });

  it('alerts the staff queue at the exclusion threshold, and excludes nobody', async () => {
    const { context, db, gateway } = league();
    db.update(schema.season)
      .set({
        settingsJson: {
          forfeit_score: [0, 0],
          map_pool: [],
          forfeits: { warning_at: null, exclusion_at: 2 },
        },
      })
      .run();
    const { replies } = await run(staffMatch('forfeit', { match: 3, team: 'b' }), context);
    expect(replies[0]?.content).toContain(
      "Charlie atteint le seuil d'exclusion avec 2 forfaits. L'exclusion reste une décision du staff.",
    );
    expect(gateway.posted).toMatchObject([
      {
        channelId: QUEUE,
        message: {
          content:
            "Charlie atteint le seuil d'exclusion avec 2 forfaits (Ligue 1, semaine 3 : Bravo – Charlie). Une décision du staff est attendue.",
        },
      },
    ]);
    expect(
      db
        .select()
        .from(schema.slot)
        .all()
        .every((row) => row.status === 'active'),
    ).toBe(true);
  });

  it.each([
    [
      staffMatch('forfeit', { match: 2, team: 'a' }),
      "Ce match n'attend pas cette action : il a déjà été traité.",
    ],
    [staffMatch('forfeit', { match: 3, team: 'c' }), 'Commande inconnue.'],
    [staffMatch('forfeit', { match: 3 }), 'Commande inconnue.'],
    [
      staffMatch('forfeit', { match: 3, team: 'a' }, { ...STAFF, memberRoleIds: [] }),
      'Cette commande est réservée au staff de la ligue.',
    ],
  ])('refuses privately: %j', async (input, content) => {
    const { context, db } = league();
    expect((await run(input, context)).replies).toEqual([{ content, ephemeral: true }]);
    expect(db.select().from(schema.match).all()[2]?.status).toBe('scheduled');
  });

  it('suggests the matches a forfeit can be recorded on', async () => {
    const choices = (await suggestFor('', STAFF, 'match', 'forfeit'))[0];
    expect(choices?.map((choice) => choice.value)).toEqual([3, 1, 4]);
  });
});

describe('/staff sanction', () => {
  const sanction = (
    subcommand: string,
    options: FakeInput['options'],
    who: FakeInput = STAFF,
  ): FakeInput => ({ ...who, subcommandGroup: 'sanction', subcommand, options });
  // 1 800 000 000 000 ms is 15 January 2027 in French time.
  const DATE = '15/01/2027';

  it('takes points away, shows it in the list, and the standings follow', async () => {
    const context = fakeContext({ db: leagueDatabase() });
    const added = await run(
      sanction('add', { team: 1, kind: 'points', points: -2, reason: 'Retard répété' }),
      context,
    );
    expect(added.replies).toEqual([
      {
        content: `Sanction enregistrée pour Alpha Esport : ${DATE} — -2 point(s) au classement — Retard répété`,
        ephemeral: true,
      },
    ]);
    await run(sanction('add', { team: 1, kind: 'warning', reason: 'Comportement' }), context);

    const listed = await run(sanction('list', { team: 1 }), context);
    expect(listed.replies[0]?.content).toBe(
      [
        'Sanctions de Alpha Esport cette saison :',
        `${DATE} — -2 point(s) au classement — Retard répété`,
        `${DATE} — Avertissement — Comportement`,
      ].join('\n'),
    );
    expect(context.db.select().from(schema.sanction).all()).toMatchObject([
      { kind: 'points', pointsDelta: -2 },
      { kind: 'warning', pointsDelta: null },
    ]);
  });

  it('says so when a team has no sanction', async () => {
    const { replies } = await run(sanction('list', { team: 2 }));
    expect(replies[0]?.content).toBe('Aucune sanction pour Bravo cette saison.');
  });

  it.each([
    [
      sanction('add', { team: 1, kind: 'points', reason: 'x' }),
      'Indique un nombre de points non nul, entre -100 et 100 (négatif pour en retirer).',
    ],
    [
      sanction('add', { team: 1, kind: 'warning', points: -1, reason: 'x' }),
      'Un avertissement ne porte pas de points.',
    ],
    [sanction('add', { team: 1, kind: 'points', points: -1 }), 'Un motif est nécessaire.'],
    [sanction('add', { team: 1, kind: 'exclusion', reason: 'x' }), 'Commande inconnue.'],
    [
      sanction('add', { team: 'alpha', kind: 'warning', reason: 'x' }),
      'Équipe introuvable dans la saison en cours. Choisis-la dans la liste proposée.',
    ],
    [
      sanction('add', { team: 1, kind: 'warning', reason: 'x' }, { ...STAFF, memberRoleIds: [] }),
      'Cette commande est réservée au staff de la ligue.',
    ],
    [
      sanction('list', { team: 1 }, { ...STAFF, memberRoleIds: [] }),
      'Cette commande est réservée au staff de la ligue.',
    ],
  ])('refuses privately and stores nothing: %j', async (input, content) => {
    const { replies, db } = await run(input);
    expect(replies).toEqual([{ content, ephemeral: true }]);
    expect(db.select().from(schema.sanction).all()).toEqual([]);
  });

  it('suggests teams for the team option', async () => {
    const interaction = fakeAutocomplete(
      'staff',
      { name: 'team', value: 'br' },
      { ...STAFF, subcommandGroup: 'sanction', subcommand: 'add' },
    );
    await staffCommand.autocomplete?.(interaction, fakeContext({ db: leagueDatabase() }));
    expect(interaction.responses).toEqual([[{ name: 'Bravo (BRV) · Ligue 1', value: 2 }]]);
  });
});
