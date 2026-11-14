import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { setTeamOwner } from '../services/team-staff.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { buttons } from './buttons/index.ts';
import { tick } from './clock.ts';
import { matchCommand } from './commands/match.ts';
import { routeButton } from './router.ts';
import {
  FAKE_CHANNEL,
  fakeAutocomplete,
  fakeButton,
  fakeContext,
  fakeGateway,
  fakeInteraction,
  type FakeInput,
} from './testing.ts';

// Match 3 is Bravo (side A, 3rd) v Charlie (side B, 2nd), Ligue 1 week 3: Bravo picks the
// starting side and starts the veto; Charlie hosts.
const STAFF_USER = { id: '222222222222222222', displayName: 'Léa Staff' };
const STAFF: FakeInput = {
  guildId: TEST_GUILD,
  user: STAFF_USER,
  memberRoleIds: [TEST_STAFF_ROLE],
};
const member = (n: number): FakeInput => ({
  guildId: TEST_GUILD,
  user: { id: `70000000000000000${n}`, displayName: `Member ${n}` },
  memberRoleIds: [],
});
const BRAVO = member(1);
const CHARLIE = member(2);
const NOW = Date.parse('2026-11-03T12:00:00Z');
const logger = { error: vi.fn() };

function session() {
  const db = leagueDatabase();
  const staff = { guildId: TEST_GUILD, user: STAFF_USER, memberRoleIds: [TEST_STAFF_ROLE] };
  setTeamOwner(db, staff, { teamId: 2, member: BRAVO.user ?? STAFF_USER }, 100);
  setTeamOwner(db, staff, { teamId: 3, member: CHARLIE.user ?? STAFF_USER }, 100);
  const gateway = fakeGateway();
  let now = NOW;
  const context = fakeContext({ db, gateway, now: () => now });
  const start = async (who: FakeInput = BRAVO, extra: Partial<FakeInput> = {}) => {
    const interaction = fakeInteraction('match', {
      ...who,
      ...extra,
      subcommand: 'veto',
      options: { match: 3 },
    });
    await matchCommand.execute(interaction, context);
    return interaction;
  };
  const click = async (customId: string, who: FakeInput) => {
    const interaction = fakeButton(customId, who);
    await routeButton(buttons, interaction, context, logger);
    return interaction;
  };
  const setNow = (value: number) => {
    now = value;
  };
  return { db, gateway, context, start, click, setNow };
}

describe('/match veto', () => {
  it('posts the veto in the channel with a button per map, pings both teams, and confirms', async () => {
    const { start, gateway, db } = session();
    const interaction = await start();
    expect(interaction.replies).toEqual([
      { content: 'Veto lancé : le message est juste en dessous.', ephemeral: true },
    ]);
    const [posted] = gateway.posted;
    expect(posted?.channelId).toBe(FAKE_CHANNEL);
    expect(posted?.message.content).toBe(
      [
        '**Veto — Ligue 1, semaine 3 : Bravo – Charlie** (BO1)',
        'Bravo choisit le côté de départ et commence le veto ; Charlie choisit le côté en prolongation. Hôte : Charlie.',
        `Au tour de **Bravo** : bannir une carte. Fin du temps <t:${String((NOW + 240_000) / 1000)}:R>.`,
        'Sans choix à temps, le bot choisit au hasard.',
        '<@700000000000000001> <@700000000000000002>',
      ].join('\n'),
    );
    expect(posted?.message.mentionUserIds).toEqual(['700000000000000001', '700000000000000002']);
    expect(posted?.message.buttons?.map((button) => button.label)).toEqual([
      'Bank',
      'Chalet',
      'Clubhouse',
      'Nighthaven Labs',
      'Lair',
      'Villa',
      'Kafe Dostoyevsky',
      'Border',
      'Fortress',
    ]);
    expect(posted?.message.buttons?.[0]).toEqual({
      customId: 'veto:3:0x0',
      label: 'Bank',
      style: 'danger',
    });
    const stored = db.select().from(schema.match).where(eq(schema.match.id, 3)).get();
    expect(stored).toMatchObject({ vetoChannelId: FAKE_CHANNEL, vetoMessageId: posted?.messageId });
  });

  it('refuses privately, and offers league staff every match to play', async () => {
    const { start, context } = session();
    const outsider = await start(member(5));
    expect(outsider.replies[0]).toMatchObject({ ephemeral: true });
    expect(outsider.replies[0]?.content).toContain("Tu n'es responsable d'aucune équipe");

    const suggest = fakeAutocomplete(
      'match',
      { name: 'match', value: '' },
      {
        ...STAFF,
        subcommand: 'veto',
      },
    );
    await matchCommand.autocomplete?.(suggest, context);
    expect(suggest.responses[0]?.map((choice) => choice.value)).toContain(3);
  });

  it('replies with the veto itself where the bot cannot post', async () => {
    const { start, gateway } = session();
    gateway.failing = true;
    const interaction = await start();
    expect(interaction.replies[0]).toMatchObject({ ephemeral: false });
    expect(interaction.replies[0]?.buttons).toHaveLength(9);
  });
});

describe('veto buttons', () => {
  it('lets the team whose turn it is ban, and updates the message', async () => {
    const { start, click } = session();
    await start();
    const interaction = await click('veto:3:0x0', BRAVO);
    const [update] = interaction.updates;
    expect(update?.content).toContain('Bannies : Bank (Bravo)');
    expect(update?.content).toContain('Au tour de **Charlie** : bannir une carte.');
    expect(update?.buttons?.map((button) => button.label)).not.toContain('Bank');
    expect(update?.buttons?.[0]?.customId).toBe('veto:3:1x0');
  });

  it('refuses a team out of turn and an old button, privately', async () => {
    const { start, click } = session();
    await start();
    const early = await click('veto:3:0x0', CHARLIE);
    expect(early.replies).toEqual([
      { content: "Ce n'est pas au tour de ton équipe.", ephemeral: true },
    ]);
    await click('veto:3:0x0', BRAVO);
    const old = await click('veto:3:0x1', BRAVO);
    expect(old.replies[0]?.content).toBe('Ce choix a déjà été fait : regarde le message à jour.');
  });

  it('ends with the map and the sides', async () => {
    const { start, click } = session();
    await start();
    for (let step = 0; step < 8; step += 1) {
      await click(`veto:3:${step}x0`, step % 2 === 0 ? BRAVO : CHARLIE);
    }
    const side = await click('veto:3:9x1', BRAVO);
    expect(side.updates[0]?.content).toContain('Carte 1 : **Fortress**');
    expect(side.updates[0]?.buttons?.map((button) => button.label)).toEqual(['Attaque', 'Défense']);
    const done = await click('veto:3:10x0', CHARLIE);
    expect(done.updates[0]?.content).toContain(
      'Carte 1 : **Fortress** — Bravo commence en Défense ; en prolongation, Charlie prend Attaque.',
    );
    expect(done.updates[0]?.content).toContain('Veto terminé. Bon match !');
    expect(done.updates[0]?.buttons).toEqual([]);
  });
});

describe('the coin toss between teams of equal rank', () => {
  it('names the winner and no host, then offers its choice and the other decision', async () => {
    const { db, gateway, start, click } = session();
    // Without results, both teams share first place.
    db.update(schema.match).set({ status: 'void' }).where(eq(schema.match.id, 1)).run();
    db.update(schema.match).set({ status: 'void' }).where(eq(schema.match.id, 2)).run();
    await start();
    const row = db.select().from(schema.match).where(eq(schema.match.id, 3)).get();
    // The coin comes from the system's random source: either team may win it.
    const bravoWon = row?.vetoJson?.team_a === 'a';
    const [winner, loser] = bravoWon ? [BRAVO, CHARLIE] : [CHARLIE, BRAVO];
    const [winnerName, loserName] = bravoWon ? ['Bravo', 'Charlie'] : ['Charlie', 'Bravo'];
    expect(row).toMatchObject({ hostSide: null, sideChooser: null });

    const posted = gateway.posted[0]?.message;
    expect(posted?.content).toContain(
      `Égalité au classement : pile ou face, gagné par **${winnerName}**. Hôte : à convenir entre les équipes.`,
    );
    expect(posted?.content).toContain(
      `Au tour de **${winnerName}** : prendre le choix du côté, ou décider qui bannit en premier.`,
    );
    expect(posted?.buttons?.map((button) => button.label)).toEqual([
      'Choix du côté',
      'Qui bannit en premier',
    ]);

    const chosen = await click(posted?.buttons?.[0]?.customId ?? '', winner);
    const update = chosen.updates[0];
    expect(update?.content).toContain(`${winnerName} prend le choix du côté.`);
    expect(update?.content).toContain(
      `Au tour de **${loserName}** : décider qui bannit en premier.`,
    );
    expect(update?.buttons?.map((button) => button.label)).toEqual([
      `${loserName} bannit en premier`,
      `${winnerName} bannit en premier`,
    ]);

    const decided = await click(update?.buttons?.[1]?.customId ?? '', loser);
    expect(decided.updates[0]?.content).toContain(`${winnerName} bannit en premier.`);
    expect(decided.updates[0]?.content).toContain(
      `Au tour de **${winnerName}** : bannir une carte.`,
    );
  });
});

describe('the clock and the veto', () => {
  it('plays a random ban for a team out of time and edits the message', async () => {
    const { db, gateway, start } = session();
    await start();
    await tick({
      db,
      gateway,
      logger,
      locale: 'fr',
      now: () => NOW + 240_000,
      random: () => 5,
    });
    const [posted] = gateway.posted;
    expect(posted?.edits).toBe(1);
    expect(posted?.message.content).toContain('Bannies : Villa (Bravo, temps écoulé)');
  });
});
