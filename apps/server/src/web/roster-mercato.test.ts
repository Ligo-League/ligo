import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openMercatoWindow } from '../services/mercato-windows.ts';
import type { Actor } from '../services/permissions.ts';
import { setTeamOwner } from '../services/team-staff.ts';
import { leagueDatabase, mercatoLineups, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { TEST_NOW, testSite } from './testing.ts';

// A roster's mercato page (phase 3f-11, design doc section 7): its officials who manage its
// players file and withdraw moves and change roles and the captain; the staff queue hears of
// each move. Alpha (team 1) and its players as `mercatoLineups` sets them.

const HOUR = 3_600_000;
const QUEUE = '800000000000000001';
const PAGE = '/teams/alpha-esport/mercato';
const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const MANAGER = { id: '700000000000000002', displayName: 'Manager' };

function site() {
  const db = leagueDatabase();
  setTeamOwner(db, STAFF, { teamId: 1, member: MANAGER }, 1);
  const ids = mercatoLineups(db);
  db.update(schema.leagueGuild).set({ alertsChannelId: QUEUE }).run();
  const browser = testSite({ db, users: { 'code-man': MANAGER } });
  // Every player is on the league's Discord server.
  for (let n = 1; n <= 9; n += 1) {
    browser.gateway.members.set(`${TEST_GUILD}:${`71000000000000000${String(n)}`.slice(-18)}`, []);
  }
  const openWindow = () =>
    openMercatoWindow(
      db,
      STAFF,
      {
        opensAt: TEST_NOW - HOUR,
        closesAt: TEST_NOW + 48 * HOUR,
        maxMovesPerTeam: 3,
        lockHours: 24,
      },
      TEST_NOW - 2 * HOUR,
    );
  const p = (n: number) => String(ids[n - 1] ?? 0);
  const moves = () =>
    db.select().from(schema.request).where(eq(schema.request.kind, 'roster_move')).all();
  return { ...browser, db, p, openWindow, moves };
}
const where = (response: Response) => response.headers.get('location');

describe('a roster’s mercato page', () => {
  it('shows the lineup and the window to the officials who manage its players', async () => {
    const { request, logIn, openWindow } = site();
    await logIn(PAGE, 'code-man');
    const closed = await (await request(PAGE)).text();
    expect(closed).toContain('Mercato — Alpha Esport');
    expect(closed).toContain('Pas de fenêtre de mercato ouverte');
    expect(closed).not.toContain('Demander un mouvement');
    openWindow();
    const open = await (await request(PAGE)).text();
    expect(open).toContain('Mouvements comptés : 0 sur 3.');
    expect(open).toMatch(/P1\s*<strong>\(capitaine\)<\/strong>/);
    expect(open).toContain('Demander un mouvement');
    // The manage page links to it.
    expect(await (await request('/teams/alpha-esport/manage')).text()).toContain(`href="${PAGE}"`);
  });

  it('is refused to a player who does not manage the roster', async () => {
    const { request, logIn } = site();
    await logIn('/me');
    expect((await request(PAGE)).status).toBe(403);
  });

  it('files a swap, told to the staff queue with a link, then withdraws it', async () => {
    const { request, post, logIn, openWindow, p, moves, gateway } = site();
    openWindow();
    await logIn(PAGE, 'code-man');
    const filed = await post(`${PAGE}/move`, { out: p(5), in: p(7), role: 'player', note: '' });
    expect(where(filed)).toBe(`${PAGE}?done=filed`);
    expect(moves()).toMatchObject([{ status: 'pending', teamId: 1 }]);
    expect(gateway.posted.at(-1)).toMatchObject({ channelId: QUEUE });
    expect(gateway.posted.at(-1)?.message.content).toBe(
      `**Mercato — Alpha Esport** : P7 remplace P5. Demandé par Manager. Page de l'équipe : <http://localhost:3000${PAGE}>`,
    );
    const page = await (await request(`${PAGE}?done=filed`)).text();
    expect(page).toContain('Mouvements comptés : 1 sur 3.');
    expect(page).toContain('En attente du staff');

    const id = String(moves()[0]?.id);
    expect(where(await post(`${PAGE}/moves/${id}/withdraw`, {}))).toBe(`${PAGE}?done=withdrawn`);
    expect(moves()[0]?.status).toBe('withdrawn');
    expect(gateway.posted.at(-1)?.message.content).toBe(
      `**Mercato — Alpha Esport** : P7 remplace P5. Demandé par Manager. Page de l'équipe : <http://localhost:3000${PAGE}>\n↩️ Retiré par l'équipe.`,
    );
  });

  it('explains a refused move', async () => {
    const { post, logIn, openWindow, p, moves } = site();
    await logIn(PAGE, 'code-man');
    expect(where(await post(`${PAGE}/move`, { out: p(6), in: '', role: 'sub' }))).toBe(
      `${PAGE}?error=window_closed`,
    );
    openWindow();
    expect(where(await post(`${PAGE}/move`, { out: p(1), in: '', role: 'sub' }))).toBe(
      `${PAGE}?error=captain_leaving`,
    );
    expect(where(await post(`${PAGE}/move`, { out: '', in: '', role: 'sub' }))).toBe(
      `${PAGE}?error=empty_move`,
    );
    expect(moves()).toEqual([]);
  });

  it('changes a role and the captain at once', async () => {
    const { request, post, logIn, p } = site();
    await logIn(PAGE, 'code-man');
    expect(where(await post(`${PAGE}/role`, { player: p(5), role: 'sub' }))).toBe(
      `${PAGE}?done=role`,
    );
    expect(where(await post(`${PAGE}/role`, { captain: p(2) }))).toBe(`${PAGE}?done=role`);
    expect(where(await post(`${PAGE}/role`, { captain: p(6) }))).toBe(
      `${PAGE}?error=captain_not_starter`,
    );
    expect(await (await request(PAGE)).text()).toMatch(/P2\s*<strong>\(capitaine\)<\/strong>/);
  });

  it('refuses every POST from someone who does not manage the roster', async () => {
    const { post, logIn, openWindow, p, moves } = site();
    openWindow();
    await logIn('/me');
    expect((await post(`${PAGE}/move`, { out: p(6), in: '', role: 'sub' })).status).toBe(403);
    expect((await post(`${PAGE}/role`, { captain: p(2) })).status).toBe(403);
    expect(moves()).toEqual([]);
  });
});
