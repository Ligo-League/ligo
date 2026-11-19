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
const LEA = { id: STAFF.user.id, displayName: 'Léa Staff' };
const MERCATO = '800000000000000004';

function site() {
  const db = leagueDatabase();
  setTeamOwner(db, STAFF, { teamId: 1, member: MANAGER }, 1);
  const ids = mercatoLineups(db);
  db.update(schema.leagueGuild).set({ alertsChannelId: QUEUE, mercatoChannelId: MERCATO }).run();
  const browser = testSite({ db, users: { 'code-man': MANAGER, 'code-lea': LEA } });
  browser.setRoles([TEST_STAFF_ROLE], LEA.id);
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

describe('league staff and moves', () => {
  it('approve a move from /staff: the lineup changes and #mercato announces it', async () => {
    const { request, post, logIn, jar, openWindow, p, moves, gateway } = site();
    openWindow();
    await logIn(PAGE, 'code-man');
    await post(`${PAGE}/move`, { out: p(5), in: p(7), role: 'player', note: 'Blessure' });
    jar.clear();
    await logIn('/staff', 'code-lea');
    const queue = await (await request('/staff')).text();
    expect(queue).toContain('Mouvements de mercato (1)');
    expect(queue).toContain('P7 remplace P5');
    const id = String(moves()[0]?.id);
    expect(queue).toContain(`action="/staff/moves/${id}/approve"`);
    expect(where(await post(`/staff/moves/${id}/approve`, {}))).toBe('/staff?done=move_approved');
    expect(moves()[0]?.status).toBe('approved');
    expect(gateway.posted.find((entry) => entry.channelId === MERCATO)?.message.content).toMatch(
      /^\*\*LFR\*\* — Alpha Esport : P7 remplace P5\./,
    );
    expect(await (await request('/staff?done=move_approved')).text()).toContain(
      'Mouvements de mercato (0)',
    );
  });

  it('refuse a move from /staff with a reason, and say which rule a move now breaks', async () => {
    const { request, post, logIn, jar, openWindow, p, moves } = site();
    openWindow();
    await logIn(PAGE, 'code-man');
    await post(`${PAGE}/move`, { out: p(5), in: '', role: 'sub' });
    await post(`${PAGE}/move`, { out: p(6), in: '', role: 'sub' });
    // P5 becomes captain after the move was filed: it cannot leave any more.
    await post(`${PAGE}/role`, { captain: p(5) });
    jar.clear();
    await logIn('/staff', 'code-lea');
    const [first, second] = moves().map((row) => String(row.id));
    expect(where(await post(`/staff/moves/${String(first)}/approve`, {}))).toBe(
      '/staff?move_error=captain_leaving',
    );
    expect(await (await request('/staff?move_error=captain_leaving')).text()).toContain(
      'Le capitaine ne peut pas partir',
    );
    expect(where(await post(`/staff/moves/${String(second)}/reject`, { reason: '' }))).toBe(
      '/staff?error=reason_required',
    );
    expect(
      where(await post(`/staff/moves/${String(second)}/reject`, { reason: 'Hors délai' })),
    ).toBe('/staff?done=move_rejected');
    expect(moves().map((row) => row.status)).toEqual(['pending', 'rejected']);
  });

  it('apply an exception from the team’s page, without a window, not counted', async () => {
    const { request, post, logIn, p, moves, gateway } = site();
    await logIn(PAGE, 'code-lea');
    expect(await (await request(PAGE)).text()).toContain('Exception du staff');
    const applied = await post(`${PAGE}/exception`, {
      out: p(5),
      in: p(7),
      role: 'player',
      reason: 'Blessure longue durée',
    });
    expect(where(applied)).toBe(`${PAGE}?done=exception`);
    expect(moves()).toMatchObject([{ status: 'approved', payloadJson: { counted: false } }]);
    expect(gateway.posted.find((entry) => entry.channelId === QUEUE)?.message.content).toContain(
      '✅ Exception du staff (<@222222222222222222>) : Blessure longue durée',
    );
  });

  it('refuse every staff POST from someone who is not staff', async () => {
    const { post, logIn, openWindow, p, moves } = site();
    openWindow();
    await logIn(PAGE, 'code-man');
    await post(`${PAGE}/move`, { out: p(6), in: '', role: 'sub' });
    const id = String(moves()[0]?.id);
    expect((await post(`/staff/moves/${id}/approve`, {})).status).toBe(403);
    expect((await post(`${PAGE}/exception`, { out: p(5), in: '', reason: 'x' })).status).toBe(403);
    expect(moves()).toMatchObject([{ status: 'pending' }]);
  });
});

describe('the public history of moves', () => {
  it('shows approved moves on the team, the old team and the season pages, never the reason', async () => {
    const { request, post, logIn, p } = site();
    await logIn(PAGE, 'code-lea');
    await post(`${PAGE}/exception`, {
      out: p(5),
      in: p(9),
      role: 'player',
      reason: 'Motif privé',
    });
    for (const path of ['/teams/alpha-esport', '/teams/bravo', '/mlb-group/lfr/saison-3']) {
      const page = await (await request(path)).text();
      expect(page).toContain('<h2>Mercato</h2>');
      expect(page).toMatch(/Alpha Esport<\/a>\s*:\s*P9 remplace P5 \(vient de Bravo\)/);
      expect(page).not.toContain('Motif privé');
    }
    expect(await (await request('/teams/charlie')).text()).not.toContain('<h2>Mercato</h2>');
  });
});
