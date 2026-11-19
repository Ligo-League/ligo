import { schema } from '@ligo/db';
import { describe, expect, it, vi } from 'vitest';
import { openMercatoWindow } from '../services/mercato-windows.ts';
import type { Actor } from '../services/permissions.ts';
import { fileMove } from '../services/roster-moves.ts';
import { setTeamOwner } from '../services/team-staff.ts';
import { leagueDatabase, mercatoLineups, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { buttons } from './buttons/index.ts';
import { forms } from './forms.ts';
import { announceMoveFiled } from './move-posts.ts';
import { routeButton, routeForm } from './router.ts';
import { fakeButton, fakeContext, fakeForm, fakeGateway, type FakeInput } from './testing.ts';

// A mercato move in Discord (design doc section 7; O-35): its post in the staff queue with
// Validate and Refuse, the decision on it, the approved move in #mercato, and the direct
// messages. Alpha (team 1) and Bravo (team 2) as `mercatoLineups` sets them.

const QUEUE = '900000000000000001';
const MERCATO = '900000000000000004';
const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const MANAGER: Actor = {
  guildId: TEST_GUILD,
  user: { id: '700000000000000002', displayName: 'Manager' },
  memberRoleIds: [],
};
const BRAVO_OWNER = { id: '700000000000000003', displayName: 'Bravo Owner' };
const logger = { error: vi.fn() };

/** Alpha's manager files a move, posted in the staff queue as the website does. */
async function filed(incoming: 7 | 9 = 7) {
  const db = leagueDatabase();
  db.update(schema.leagueGuild).set({ alertsChannelId: QUEUE, mercatoChannelId: MERCATO }).run();
  setTeamOwner(db, STAFF, { teamId: 1, member: MANAGER.user }, 1);
  setTeamOwner(db, STAFF, { teamId: 2, member: BRAVO_OWNER }, 1);
  const ids = mercatoLineups(db);
  openMercatoWindow(
    db,
    STAFF,
    { opensAt: NOW - HOUR, closesAt: NOW + 48 * HOUR, maxMovesPerTeam: 3, lockHours: 24 },
    NOW - 2 * HOUR,
  );
  const gateway = fakeGateway();
  const context = fakeContext({ db, gateway, now: () => NOW });
  const reply = await fileMove(
    db,
    () => Promise.resolve(true),
    MANAGER,
    {
      teamId: 1,
      outId: ids[4] ?? 0,
      in: { playerId: ids[incoming - 1] ?? 0, role: 'player' },
      note: 'Départ de P5',
    },
    NOW,
  );
  if (!reply.ok) throw new Error(reply.error);
  await announceMoveFiled(context, reply, context.publicUrl);
  const id = reply.move.id;
  const click = async (action: string, who: FakeInput) => {
    const interaction = fakeButton(`${action}:${String(id)}:0`, who);
    await routeButton(buttons, interaction, context, logger);
    return interaction;
  };
  const send = async (reason: string, who: FakeInput) => {
    const interaction = fakeForm(`move-reject:${String(id)}:0`, { text: { reason } }, who);
    await routeForm(forms, interaction, context, logger);
    return interaction;
  };
  return { db, gateway, click, send, id };
}

describe('a move’s post in the staff queue', () => {
  it('shows the move with its note, the team’s page and the two buttons', async () => {
    const { gateway, id } = await filed();
    expect(gateway.posted).toHaveLength(1);
    expect(gateway.posted[0]?.channelId).toBe(QUEUE);
    expect(gateway.posted[0]?.message.content).toBe(
      "**Mercato — Alpha Esport** : P7 remplace P5. Demandé par Manager. Page de l'équipe : <http://localhost:3000/teams/alpha-esport/mercato>\n>>> Départ de P5",
    );
    expect(gateway.posted[0]?.message.buttons?.map((button) => button.customId)).toEqual([
      `move-approve:${String(id)}:0`,
      `move-reject:${String(id)}:0`,
    ]);
  });

  it('approves: the post shows who, #mercato announces it, whoever asked is told', async () => {
    const { gateway, click } = await filed();
    const clicked = await click('move-approve', STAFF);
    expect(clicked.updates[0]?.content).toContain('✅ Validé par <@222222222222222222>.');
    expect(clicked.updates[0]?.buttons).toBeUndefined();
    const announced = gateway.posted.find((post) => post.channelId === MERCATO);
    expect(announced?.message.content).toMatch(
      /^\*\*LFR\*\* — Alpha Esport : P7 remplace P5\. P7 pourra jouer à partir du <t:\d+:F>\.$/,
    );
    expect(gateway.direct).toEqual([
      {
        userId: MANAGER.user.id,
        message: {
          content: 'Mercato — ton mouvement pour Alpha Esport est validé : P7 remplace P5.',
        },
      },
    ]);
  });

  it('refuses with a reason in a form, which whoever asked reads', async () => {
    const { gateway, click, send, id } = await filed();
    const clicked = await click('move-reject', STAFF);
    expect(clicked.forms).toMatchObject([{ title: `Refuser le mouvement #${String(id)}` }]);
    const sent = await send('Joueur non éligible', STAFF);
    expect(sent.updates[0]?.content).toContain(
      '❌ Refusé par <@222222222222222222> : Joueur non éligible',
    );
    expect(gateway.posted.some((post) => post.channelId === MERCATO)).toBe(false);
    expect(gateway.direct[0]?.message.content).toBe(
      'Mercato — ton mouvement pour Alpha Esport est refusé : P7 remplace P5. Raison : Joueur non éligible',
    );
  });

  it('tells the roster a transferred player left, and that it lost its captain', async () => {
    const { gateway, click } = await filed(9);
    await click('move-approve', STAFF);
    expect(gateway.direct.find((dm) => dm.userId === BRAVO_OWNER.id)?.message.content).toBe(
      "Mercato — P9 quitte Bravo pour Alpha Esport, mouvement validé par le staff de la ligue.\nBravo n'a plus de capitaine : nommez-en un sur la page du mercato de l'équipe.",
    );
  });

  it('answers anyone but league staff privately, and opens no form', async () => {
    const { gateway, click } = await filed();
    for (const action of ['move-approve', 'move-reject']) {
      const clicked = await click(action, MANAGER);
      expect(clicked.forms).toEqual([]);
      expect(clicked.replies).toEqual([
        { content: 'Réservé au staff de la ligue.', ephemeral: true },
      ]);
    }
    expect(gateway.posted[0]?.edits).toBe(0);
  });

  it('says so when the move was already decided', async () => {
    const { click } = await filed();
    await click('move-approve', STAFF);
    expect((await click('move-approve', STAFF)).replies).toEqual([
      { content: 'Ce mouvement a déjà été traité.', ephemeral: true },
    ]);
  });
});
