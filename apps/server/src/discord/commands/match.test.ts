import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { setTeamOwner } from '../../services/team-staff.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../../testing.ts';
import { buttons } from '../buttons/index.ts';
import { forms } from '../forms.ts';
import { routeButton, routeForm } from '../router.ts';
import {
  fakeAutocomplete,
  fakeButton,
  fakeContext,
  fakeForm,
  fakeGateway,
  fakeInteraction,
  type FakeInput,
} from '../testing.ts';
import { matchCommand } from './match.ts';

const QUEUE = '800000000000000001';
const RESULTS = '800000000000000002';
const STAFF = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const member = (n: number) => ({
  guildId: TEST_GUILD,
  user: { id: `70000000000000000${n}`, displayName: `Member ${n}` },
  memberRoleIds: [],
});
// Match 3 of leagueDatabase() is Bravo (side A, managed by member 1) v Charlie (member 2).
const BRAVO = member(1);
const CHARLIE = member(2);
const OUTSIDER = member(4);
const SCREENSHOT = {
  url: 'https://cdn.discordapp.com/attachments/1/2/score.png?ex=1&is=2&hm=3',
  contentType: 'image/png',
  size: 1000,
};
const report = (who: FakeInput, options: FakeInput['options'] = {}): FakeInput => ({
  ...who,
  subcommand: 'report',
  options: { match: 3, score_a: 7, score_b: 5, screenshot: SCREENSHOT, ...options },
});
const logger = { error: () => undefined };

function session() {
  const db = leagueDatabase();
  setTeamOwner(db, STAFF, { teamId: 2, member: BRAVO.user }, 100);
  setTeamOwner(db, STAFF, { teamId: 3, member: CHARLIE.user }, 100);
  db.update(schema.leagueGuild).set({ alertsChannelId: QUEUE, resultsChannelId: RESULTS }).run();
  const gateway = fakeGateway();
  const context = fakeContext({ db, gateway });
  const run = async (input: FakeInput) => {
    const interaction = fakeInteraction('match', input);
    await matchCommand.execute(interaction, context);
    return interaction;
  };
  const click = async (customId: string, who: FakeInput) => {
    const interaction = fakeButton(customId, who);
    await routeButton(buttons, interaction, context, logger);
    return interaction;
  };
  const send = async (
    customId: string,
    who: FakeInput,
    values: { reason?: string; details?: string } = {},
  ) => {
    const interaction = fakeForm(
      customId,
      {
        selected: values.reason === undefined ? {} : { reason: [values.reason] },
        text: values.details === undefined ? {} : { details: values.details },
      },
      who,
    );
    await routeForm(forms, interaction, context, logger);
    return interaction;
  };
  const status = () => db.select().from(schema.match).all()[2]?.status;
  return { db, gateway, context, run, click, send, status };
}

describe('/match report', () => {
  it('posts the report in public with the screenshot and the buttons for the other team', async () => {
    const { run, status } = session();
    const interaction = await run(report(BRAVO));

    expect(interaction.deferred).toBe(true);
    expect(interaction.replies).toMatchObject([
      {
        ephemeral: false,
        content:
          '<@700000000000000001> signale pour Bravo : **Ligue 1, semaine 3 : Bravo 7–5 Charlie**. <@700000000000000002>, confirmez ou contestez ce résultat.',
        files: [{ name: 'score-3.png' }],
        buttons: [
          { customId: 'report-confirm:3:1', label: 'Confirmer', style: 'success' },
          { customId: 'report-dispute:3:1', label: 'Contester', style: 'danger' },
        ],
        // Only the opponent's manager is notified.
        mentionUserIds: ['700000000000000002'],
      },
    ]);
    expect(status()).toBe('reported');
  });

  it('posts it in the staff queue with the buttons for staff', async () => {
    const { run, gateway } = session();
    await run(report(BRAVO));
    expect(gateway.posted).toMatchObject([
      {
        channelId: QUEUE,
        message: {
          content:
            'Résultat à valider — **Ligue 1, semaine 3 : Bravo 7–5 Charlie**. Signalé par <@700000000000000001> pour Bravo.',
          files: [{ name: 'score-3.png' }],
          buttons: [
            { customId: 'report-validate:3:1', label: 'Valider', style: 'success' },
            { customId: 'report-reject:3:1', label: 'Refuser', style: 'danger' },
          ],
        },
      },
    ]);
  });

  it('says so when the other team has nobody to confirm, or staff could not be notified', async () => {
    const first = session();
    first.db.update(schema.teamStaff).set({ until: 200 }).run();
    setTeamOwner(first.db, STAFF, { teamId: 2, member: BRAVO.user }, 300);
    expect((await first.run(report(BRAVO))).replies[0]).toMatchObject({
      content:
        "<@700000000000000001> signale pour Bravo : **Ligue 1, semaine 3 : Bravo 7–5 Charlie**. L'équipe adverse n'a pas encore de responsable enregistré : le staff validera.",
      mentionUserIds: [],
    });

    const second = session();
    const original = second.gateway.postMessage.bind(second.gateway);
    second.gateway.postMessage = () => Promise.reject(new Error('missing access'));
    const content = (await second.run(report(BRAVO))).replies[0]?.content;
    second.gateway.postMessage = original;
    expect(content).toContain("Le staff n'a pas pu être prévenu automatiquement");
  });

  it.each([
    [report(OUTSIDER), "Tu n'es responsable d'aucune équipe. Le staff peut te nommer avec /team."],
    [report(STAFF), "Tu n'es responsable d'aucune équipe. Le staff peut te nommer avec /team."],
    [report(BRAVO, { match: 4 }), "Tu n'es responsable d'aucune des deux équipes de ce match."],
    [report(BRAVO, { match: 1 }), 'Ce match a déjà un résultat signalé ou validé.'],
    [
      report(BRAVO, { match: 99 }),
      'Match introuvable dans cette ligue. Choisis-le dans la liste proposée.',
    ],
    [
      report(BRAVO, { score_a: 7, score_b: 6 }),
      'Score impossible avec le règlement de la ligue : une carte se termine entre 7–0 et 7–5, ou en prolongation (8–6, 8–7).',
    ],
    [
      report(BRAVO, { screenshot: { ...SCREENSHOT, contentType: 'application/pdf' } }),
      'La capture doit être une image PNG, JPEG ou WebP de moins de 20 Mo, jointe à la commande.',
    ],
    [{ ...BRAVO, subcommand: 'delete' }, 'Commande inconnue.'],
  ])('refuses privately, before announcing anything in public: %j', async (input, content) => {
    const { run, gateway, status } = session();
    const interaction = await run(input);
    expect(interaction.replies).toEqual([{ content, ephemeral: true }]);
    expect(interaction.deferred).toBe(false);
    expect(gateway.posted).toEqual([]);
    expect(status()).toBe('scheduled');
  });

  it('is visible to everyone, in servers only', () => {
    expect(matchCommand.data.default_member_permissions).toBeUndefined();
    expect(matchCommand.data.contexts).toEqual([0]);
  });

  it("suggests only the member's own matches still to play", async () => {
    const { context } = session();
    const suggest = async (who: FakeInput, name = 'match') => {
      const interaction = fakeAutocomplete('match', { name, value: '' }, who);
      await matchCommand.autocomplete?.(interaction, context);
      return interaction.responses[0];
    };
    expect(await suggest(BRAVO)).toEqual([{ name: 'L1 · S3 · BRV – CHA', value: 3 }]);
    expect(await suggest(BRAVO, 'score_a')).toEqual([]);
  });

  // Discord cannot show a message in a list of suggestions: one entry that cannot be reported
  // (match 0) says why the list is empty instead.
  it('explains an empty list with a single entry', async () => {
    const { context } = session();
    const suggest = async (who: FakeInput, value = '') => {
      const interaction = fakeAutocomplete('match', { name: 'match', value }, who);
      await matchCommand.autocomplete?.(interaction, context);
      return interaction.responses[0];
    };
    expect(await suggest(OUTSIDER)).toEqual([
      {
        name: "Tu n'es responsable d'aucune équipe. Le staff peut te nommer avec /team.",
        value: 0,
      },
    ]);
    expect(await suggest(BRAVO, 'xray')).toEqual([
      { name: 'Aucun de tes matchs à signaler ne correspond à « xray ».', value: 0 },
    ]);
    context.db.update(schema.match).set({ status: 'validated' }).run();
    expect(await suggest(BRAVO)).toEqual([
      { name: 'Aucun match à signaler : ceux de tes équipes ont déjà un résultat.', value: 0 },
    ]);
  });

  it('refuses the explanation entry with the reason, if it is picked', async () => {
    const { run } = session();
    const interaction = await run(report(OUTSIDER, { match: 0 }));
    expect(interaction.replies).toEqual([
      {
        content: "Tu n'es responsable d'aucune équipe. Le staff peut te nommer avec /team.",
        ephemeral: true,
      },
    ]);
  });
});

describe('report buttons', () => {
  it('lets the other team confirm: the buttons go and staff are told', async () => {
    const { run, click, gateway, status } = session();
    await run(report(BRAVO));
    const interaction = await click('report-confirm:3:1', CHARLIE);

    expect(interaction.updates).toEqual([
      {
        content:
          '**Ligue 1, semaine 3 : Bravo 7–5 Charlie** — confirmé par <@700000000000000002>. En attente de validation par le staff.',
      },
    ]);
    expect(status()).toBe('confirmed');
    expect(gateway.posted.at(-1)).toMatchObject({
      channelId: QUEUE,
      message: {
        content:
          "Ligue 1, semaine 3 : Bravo 7–5 Charlie — confirmé par l'équipe adverse (<@700000000000000002>).",
      },
    });
  });

  it('opens the dispute form for the other team, with the league\'s reasons then "Autre"', async () => {
    const { run, click, status } = session();
    await run(report(BRAVO));
    const interaction = await click('report-dispute:3:1', CHARLIE);
    expect(interaction.forms).toEqual([
      {
        customId: 'report-dispute:3:1',
        title: 'Contester le résultat',
        fields: [
          {
            kind: 'select',
            id: 'reason',
            label: 'Motif',
            options: [
              { value: 'wrong_score', label: 'Score incorrect' },
              { value: 'screenshot', label: 'Capture manquante ou illisible' },
              { value: 'ineligible_player', label: 'Joueur non inscrit ou non éligible' },
              { value: 'not_played', label: 'Match non joué' },
              { value: 'technical', label: 'Problème technique ou re-host' },
              { value: 'other', label: 'Autre' },
            ],
          },
          {
            kind: 'text',
            id: 'details',
            label: 'Détails',
            description: 'Obligatoires pour « Autre ». Lus par le staff de la ligue seulement.',
            required: false,
            maxLength: 1000,
          },
        ],
      },
    ]);
    // Opening the form changes nothing yet.
    expect(status()).toBe('reported');
  });

  it('tells someone who may not dispute at once, without opening the form', async () => {
    const { run, click } = session();
    await run(report(BRAVO));
    const interaction = await click('report-dispute:3:1', BRAVO);
    expect(interaction.forms).toEqual([]);
    expect(interaction.replies).toEqual([
      {
        content: "Seule l'équipe adverse peut confirmer ou contester ce résultat.",
        ephemeral: true,
      },
    ]);
  });

  it('records the sent dispute: the public message names no reason, staff get it all', async () => {
    const { run, send, gateway, status } = session();
    await run(report(BRAVO));
    const interaction = await send('report-dispute:3:1', CHARLIE, {
      reason: 'ineligible_player',
      details: 'Leur 5e joueur @everyone n’est pas inscrit.',
    });
    expect(interaction.updates).toEqual([
      {
        content:
          '**Ligue 1, semaine 3 : Bravo 7–5 Charlie** — contesté par <@700000000000000002>. Le staff va trancher.',
      },
    ]);
    expect(status()).toBe('disputed');
    const queued = gateway.posted.at(-1);
    expect(queued?.channelId).toBe(QUEUE);
    expect(queued?.message.content).toBe(
      'Ligue 1, semaine 3 : Bravo 7–5 Charlie — contesté par <@700000000000000002>. Motif : **Joueur non inscrit ou non éligible**. Une décision du staff est attendue.\n>>> Leur 5e joueur @everyone n’est pas inscrit.',
    );
    // The team's words reach staff, but cannot ping anyone.
    expect(queued?.message.mentionUserIds ?? []).toEqual([]);
  });

  it('refuses "Autre" without details: nothing changes, and the member can try again', async () => {
    const { run, send, gateway, status } = session();
    await run(report(BRAVO));
    const posts = gateway.posted.length;
    const interaction = await send('report-dispute:3:1', CHARLIE, { reason: 'other' });
    expect(interaction.replies).toEqual([
      {
        content:
          'Pour « Autre », explique le problème dans les détails. Clique de nouveau sur Contester.',
        ephemeral: true,
      },
    ]);
    expect(status()).toBe('reported');
    expect(gateway.posted).toHaveLength(posts);
  });

  it('checks the sender again: a form cannot be sent by the team that reported', async () => {
    const { run, send, status } = session();
    await run(report(BRAVO));
    const interaction = await send('report-dispute:3:1', BRAVO, { reason: 'wrong_score' });
    expect(interaction.replies[0]?.content).toBe(
      "Seule l'équipe adverse peut confirmer ou contester ce résultat.",
    );
    expect(status()).toBe('reported');
  });

  it('lets staff validate from the queue: the result is announced', async () => {
    const { run, click, gateway, status } = session();
    await run(report(BRAVO));
    const interaction = await click('report-validate:3:1', STAFF);

    expect(interaction.updates).toEqual([
      {
        content: '**Ligue 1, semaine 3 : Bravo 7–5 Charlie** — validé par <@222222222222222222>.',
      },
    ]);
    expect(status()).toBe('validated');
    expect(gateway.posted.at(-1)).toMatchObject({
      channelId: RESULTS,
      message: { content: 'Résultat validé — Ligue 1, semaine 3 : Bravo 7–5 Charlie.' },
    });
  });

  it('lets staff reject from the queue: nothing is announced', async () => {
    const { run, click, gateway, status } = session();
    await run(report(BRAVO));
    const posts = gateway.posted.length;
    const interaction = await click('report-reject:3:1', STAFF);
    expect(interaction.updates[0]?.content).toBe(
      '**Ligue 1, semaine 3 : Bravo 7–5 Charlie** — refusé par <@222222222222222222>. Le match est à signaler de nouveau.',
    );
    expect(status()).toBe('scheduled');
    expect(gateway.posted).toHaveLength(posts);
  });

  it.each([
    [
      'report-confirm:3:1',
      BRAVO,
      "Seule l'équipe adverse peut confirmer ou contester ce résultat.",
    ],
    [
      'report-dispute:3:1',
      BRAVO,
      "Seule l'équipe adverse peut confirmer ou contester ce résultat.",
    ],
    ['report-confirm:3:1', OUTSIDER, "Tu n'es responsable d'aucune des deux équipes de ce match."],
    ['report-confirm:3:1', STAFF, "Tu n'es responsable d'aucune des deux équipes de ce match."],
    ['report-validate:3:1', CHARLIE, 'Cette commande est réservée au staff de la ligue.'],
    ['report-reject:3:1', BRAVO, 'Cette commande est réservée au staff de la ligue.'],
    ['report-validate:3:1', OUTSIDER, 'Cette commande est réservée au staff de la ligue.'],
    ['report-confirm:3:2', CHARLIE, 'Ce bouton correspond à un ancien signalement.'],
    ['report-validate:3:9', STAFF, 'Ce bouton correspond à un ancien signalement.'],
    [
      'report-confirm:99:1',
      CHARLIE,
      'Match introuvable dans cette ligue. Choisis-le dans la liste proposée.',
    ],
  ])('refuses %s privately and leaves the message alone', async (customId, who, content) => {
    const { run, click, gateway, status } = session();
    await run(report(BRAVO));
    const posts = gateway.posted.length;
    const interaction = await click(customId, who);
    expect(interaction.replies).toEqual([{ content, ephemeral: true }]);
    expect(interaction.updates).toEqual([]);
    expect(status()).toBe('reported');
    expect(gateway.posted).toHaveLength(posts);
  });

  it('answers a second click on a used button privately', async () => {
    const { run, click } = session();
    await run(report(BRAVO));
    await click('report-validate:3:1', STAFF);
    const again = await click('report-validate:3:1', STAFF);
    expect(again.replies).toEqual([
      { content: "Ce match n'attend pas cette action : il a déjà été traité.", ephemeral: true },
    ]);
    const late = await click('report-confirm:3:1', CHARLIE);
    expect(late.replies[0]?.content).toBe(
      "Ce match n'attend pas cette action : il a déjà été traité.",
    );
  });
});
