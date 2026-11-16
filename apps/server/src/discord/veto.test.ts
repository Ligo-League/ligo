import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '../services/permissions.ts';
import { setTeamOwner } from '../services/team-staff.ts';
import { chooseVetoStep, startVeto } from '../services/veto.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { tick } from './clock.ts';
import { FAKE_CHANNEL, fakeContext, fakeGateway } from './testing.ts';
import { postVeto, refreshVeto } from './veto-message.ts';

// The veto's Discord post (design doc section 3, maintainer, 16 November 2026): the choices are
// made on the veto page; the post shows the steps so far and whose turn it is, links the page,
// and is edited at each step, taken on the page or by the clock. It has no buttons.
// Match 3 is Bravo (side A, 3rd) v Charlie (side B, 2nd), Ligue 1 week 3: Bravo picks the
// starting side and starts the veto; Charlie hosts.
const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const member = (n: number): Actor => ({
  guildId: TEST_GUILD,
  user: { id: `70000000000000000${String(n)}`, displayName: `Member ${String(n)}` },
  memberRoleIds: [],
});
const BRAVO = member(1);
const CHARLIE = member(2);
const NOW = Date.parse('2026-11-03T12:00:00Z');
const LINK = 'Les choix se font sur la page du veto : <http://localhost:3000/matches/3/veto>';
const logger = { error: vi.fn() };

function session() {
  const db = leagueDatabase();
  setTeamOwner(db, STAFF, { teamId: 2, member: BRAVO.user }, 100);
  setTeamOwner(db, STAFF, { teamId: 3, member: CHARLIE.user }, 100);
  const gateway = fakeGateway();
  const context = fakeContext({ db, gateway, now: () => NOW });
  /** Started on the veto page, which posts it as the website does. */
  const start = async () => {
    const reply = startVeto(db, BRAVO, { matchId: 3 }, NOW, () => 'a');
    if (!reply.ok) throw new Error(reply.error);
    expect(await postVeto(context, FAKE_CHANNEL, reply)).toBe(true);
    return reply;
  };
  /** A choice made on the veto page, by its place among the step's choices. */
  const choose = async (who: Actor, step: number, choice: number) => {
    const reply = chooseVetoStep(db, who, { matchId: 3, step, choice }, NOW, () => 'a');
    if (!reply.ok) throw new Error(reply.error);
    await refreshVeto(context, reply.view);
    return gateway.posted[0]?.message;
  };
  return { db, gateway, context, start, choose };
}

describe('the veto post', () => {
  it('shows the roles and whose turn it is, pings both teams, links the page, without buttons', async () => {
    const { start, gateway, db } = session();
    await start();
    const [posted] = gateway.posted;
    expect(posted?.channelId).toBe(FAKE_CHANNEL);
    expect(posted?.message.content).toBe(
      [
        '**Veto — Ligue 1, semaine 3 : Bravo – Charlie** (BO1)',
        'Bravo choisit le côté de départ et commence le veto ; Charlie choisit le côté en prolongation. Hôte : Charlie.',
        `Au tour de **Bravo** : bannir une carte. Fin du temps <t:${String((NOW + 240_000) / 1000)}:R>.`,
        'Sans choix à temps, le bot choisit au hasard.',
        LINK,
        '<@700000000000000001> <@700000000000000002>',
      ].join('\n'),
    );
    expect(posted?.message.mentionUserIds).toEqual(['700000000000000001', '700000000000000002']);
    expect(posted?.message.buttons).toBeUndefined();
    const stored = db.select().from(schema.match).where(eq(schema.match.id, 3)).get();
    expect(stored).toMatchObject({ vetoChannelId: FAKE_CHANNEL, vetoMessageId: posted?.messageId });
  });

  it('is edited at each step, and ends with the map and the sides', async () => {
    const { start, choose, gateway } = session();
    await start();
    const first = await choose(BRAVO, 0, 0);
    expect(first?.content).toContain('Bannies : Bank (Bravo)');
    expect(first?.content).toContain('Au tour de **Charlie** : bannir une carte.');
    for (let step = 1; step < 8; step += 1) {
      await choose(step % 2 === 0 ? BRAVO : CHARLIE, step, 0);
    }
    const side = await choose(BRAVO, 9, 1);
    expect(side?.content).toContain('Carte 1 : **Fortress**');
    const done = await choose(CHARLIE, 10, 0);
    expect(done?.content).toContain(
      'Carte 1 : **Fortress** — Bravo commence en Défense ; en prolongation, Charlie prend Attaque.',
    );
    expect(done?.content).toContain('Veto terminé. Bon match !');
    expect(done?.content).not.toContain('page du veto');
    expect(gateway.posted).toHaveLength(1);
    expect(gateway.posted[0]?.edits).toBe(10);
  });
});

describe('the coin toss between teams of equal rank', () => {
  it('names the winner and no host, and whose choice it is', async () => {
    const { db, gateway, start } = session();
    // Without results, both teams share first place.
    db.update(schema.match).set({ status: 'void' }).where(eq(schema.match.id, 1)).run();
    db.update(schema.match).set({ status: 'void' }).where(eq(schema.match.id, 2)).run();
    await start();
    const row = db.select().from(schema.match).where(eq(schema.match.id, 3)).get();
    expect(row).toMatchObject({ hostSide: null, sideChooser: null });
    const posted = gateway.posted[0]?.message;
    expect(posted?.content).toContain(
      'Égalité au classement : pile ou face, gagné par **Bravo**. Hôte : à convenir entre les équipes.',
    );
    expect(posted?.content).toContain(
      'Au tour de **Bravo** : prendre le choix du côté, ou décider qui bannit en premier.',
    );
    expect(posted?.content).toContain(LINK);
  });
});

describe('the clock and the veto', () => {
  it('plays a random ban for a team out of time and edits the post', async () => {
    const { db, gateway, context, start } = session();
    await start();
    await tick({
      db,
      gateway,
      logger,
      locale: 'fr',
      publicUrl: context.publicUrl,
      now: () => NOW + 240_000,
      random: () => 5,
    });
    const [posted] = gateway.posted;
    expect(posted?.edits).toBe(1);
    expect(posted?.message.content).toContain('Bannies : Villa (Bravo, temps écoulé)');
    expect(posted?.message.content).toContain(LINK);
  });
});
