import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../services/permissions.ts';
import { setTeamOwner } from '../services/team-staff.ts';
import { leagueDatabase, mercatoLineups, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, testSite } from './testing.ts';

// The manual stat grid on the website (design doc section 7; M-39). Match 1 is Alpha (side A,
// Ana's) 7–4 Bravo (side B, Ben's), validated, one map of 11 rounds. Alpha's lineup is P1 to P6,
// Bravo's P9 (`mercatoLineups`).

const LEA = { id: '222222222222222222', displayName: 'Léa Staff' };
const BEN = { id: '700000000000000002', displayName: 'Ben' };
const EVE = { id: '700000000000000005', displayName: 'Eve' };
const STAFF: Actor = { guildId: TEST_GUILD, user: LEA, memberRoleIds: [TEST_STAFF_ROLE] };

function site() {
  const db = leagueDatabase();
  setTeamOwner(db, STAFF, { teamId: 1, member: ANA }, 100);
  setTeamOwner(db, STAFF, { teamId: 2, member: BEN }, 100);
  const ids = mercatoLineups(db);
  const p = (n: number) => ids[n - 1] ?? 0;
  const browser = testSite({ db, users: { 'code-ben': BEN, 'code-lea': LEA, 'code-eve': EVE } });
  browser.setRoles([TEST_STAFF_ROLE], LEA.id);
  /** Cells as the grid names them: rounds, kills, deaths, assists, headshots per player. */
  const cells = (rows: Record<number, (number | string)[]>) =>
    Object.fromEntries(
      Object.entries(rows).flatMap(([n, values]) =>
        ['rounds_played', 'kills', 'deaths', 'assists', 'headshots'].map((metric, i) => [
          `v.${String(p(Number(n)))}.${metric}`,
          String(values[i] ?? ''),
        ]),
      ),
    );
  const alpha = cells({ 1: [11, 4, 2, 1, 2], 2: [11, 3, 2, 0, ''] });
  const stats = () => db.select().from(schema.stat).all();
  return { ...browser, db, p, cells, alpha, stats };
}
const where = (response: Response) => response.headers.get('location');

describe('the stat grid on the website', () => {
  it('is linked from the match page and shows both sides to a team', async () => {
    const { request, logIn, p } = site();
    await logIn('/matches/1');
    expect(await (await request('/matches/1')).text()).toContain('href="/matches/1/stats"');
    const response = await request('/matches/1/stats');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const page = await response.text();
    expect(page).toMatch(/href="\/matches\/1\/stats\?game=1"\s+aria-current="page"/);
    expect(page).toContain('Carte 1 (7–4)');
    expect(page).toContain('Pas encore saisie.');
    expect(page).toContain(`name="v.${String(p(1))}.kills"`);
    // Bravo has not entered its side: Alpha may.
    expect(page).toContain(`name="v.${String(p(9))}.kills"`);
    expect(page).toContain('hx-post="/matches/1/stats/1/a/check"');
    expect(page).toContain('<script src="/static/stat-paste.js" defer></script>');
  });

  it('saves the team’s own side, which then shows who entered it', async () => {
    const { request, logIn, post, alpha, stats } = site();
    await logIn('/matches/1/stats');
    expect(where(await post('/matches/1/stats/1/a', alpha))).toBe(
      '/matches/1/stats?game=1&done=saved_own',
    );
    // Two players: four values each, one headshot.
    expect(stats()).toHaveLength(9);
    const page = await (await request('/matches/1/stats?game=1&done=saved_own')).text();
    expect(page).toContain('Feuille enregistrée.');
    expect(page).toContain('Saisie par Ana, pour son équipe.');
    expect(page).toMatch(/name="v\.\d+\.kills"\s+value="4"/);
  });

  it('keeps what was typed and marks the cells when a value cannot be', async () => {
    const { logIn, post, cells, stats } = site();
    await logIn('/matches/1/stats');
    const response = await post('/matches/1/stats/1/a', cells({ 1: [12, 4, 2, 1, ''] }));
    expect(response.status).toBe(400);
    const page = await response.text();
    expect(page).toContain('Rien n’est enregistré');
    expect(page).toContain('P1 — Manches jouées : au plus 11');
    expect(page).toMatch(/value="12"[^>]*aria-invalid="true"/);
    expect(stats()).toEqual([]);
  });

  it('checks a side as it is typed, storing nothing', async () => {
    const { logIn, post, cells, stats } = site();
    await logIn('/matches/1/stats');
    const response = await post('/matches/1/stats/1/a/check', cells({ 1: [11, 4, 2, '', ''] }));
    expect(response.status).toBe(200);
    const fragment = await response.text();
    expect(fragment).toMatch(/^<div id="check-a"/);
    expect(fragment).toContain('P1 — Assists : à remplir');
    expect(stats()).toEqual([]);
  });

  it('lets the other team confirm a side Alpha entered for it', async () => {
    const { request, logIn, post, jar, cells, stats } = site();
    await logIn('/matches/1/stats');
    expect(where(await post('/matches/1/stats/1/b', cells({ 9: [11, 7, 4, 0, ''] })))).toBe(
      '/matches/1/stats?game=1&done=saved_opponent',
    );
    expect(stats().every((row) => !row.verified)).toBe(true);
    jar.clear();
    await logIn('/matches/1/stats', 'code-ben');
    const page = await (await request('/matches/1/stats')).text();
    expect(page).toContain('elle compte une fois confirmée par Bravo');
    expect(page).toContain('action="/matches/1/stats/1/b/confirm"');
    expect(where(await post('/matches/1/stats/1/b/confirm', {}))).toBe(
      '/matches/1/stats?game=1&done=confirmed',
    );
    expect(stats().every((row) => row.verified)).toBe(true);
    // Confirmed, the side is Bravo's: Alpha only reads it.
    jar.clear();
    await logIn('/matches/1/stats');
    expect(where(await post('/matches/1/stats/1/b', cells({ 9: [11, 7, 4, 0, ''] })))).toBe(
      '/matches/1/stats?game=1&error=not_allowed',
    );
  });

  it('lets league staff correct any side', async () => {
    const { logIn, post, alpha } = site();
    await logIn('/matches/1/stats', 'code-lea');
    expect(where(await post('/matches/1/stats/1/a', alpha))).toBe(
      '/matches/1/stats?game=1&done=saved_staff',
    );
  });

  it('is for the match’s teams and league staff only', async () => {
    const { request, logIn, post, alpha, stats } = site();
    expect(where(await request('/matches/1/stats'))).toBe(
      '/auth/login?next=%2Fmatches%2F1%2Fstats',
    );
    await logIn('/matches/1', 'code-eve');
    expect(await (await request('/matches/1')).text()).not.toContain('/matches/1/stats');
    expect((await request('/matches/1/stats')).status).toBe(404);
    expect(where(await post('/matches/1/stats/1/a', alpha))).toBe(
      '/matches/1/stats?game=1&error=not_allowed',
    );
    expect((await post('/matches/1/stats/1/a/check', alpha)).status).toBe(403);
    expect(stats()).toEqual([]);
  });

  it('has no grid for a match still to play', async () => {
    const { request, logIn } = site();
    await logIn('/matches/3');
    expect(await (await request('/matches/3')).text()).not.toContain('/matches/3/stats');
    expect((await request('/matches/3/stats')).status).toBe(404);
  });
});

describe('the scoreboard on the match page', () => {
  it('shows the stats that count to everyone, as the match is validated', async () => {
    const { request, logIn, post, jar, cells } = site();
    await logIn('/matches/1');
    await post('/matches/1/stats/1/a', cells({ 1: [11, 6, 3, 2, 3], 2: [11, 2, 0, 1, ''] }));
    // Bravo's side, entered by Alpha, waits for Bravo.
    await post('/matches/1/stats/1/b', cells({ 9: [11, 3, 8, 0, ''] }));
    jar.clear();
    const page = await (await request('/matches/1')).text();
    expect(page).toContain('<caption>');
    // Each name links to the player's page (phase 3i).
    expect(page).toMatch(
      /<th scope="row"><a href="\/players\/p1">P1<\/a><\/th>\s*<td>11<\/td>\s*<td>6<\/td>\s*<td>3<\/td>/,
    );
    // K/D 2,00 and HS 50 % for P1, in French.
    expect(page).toContain('<td>2,00</td>');
    expect(page).toMatch(/<td>50\s%<\/td>/);
    expect(page).not.toContain('>P9</a></th>');
    expect(page).toContain('Pas de statistiques pour cette équipe.');
    // The warning across sides is not public.
    expect(page).not.toContain('Vérifiez les deux feuilles');
  });

  it('warns the teams and staff when the sides disagree', async () => {
    const { request, logIn, post, jar, cells } = site();
    await logIn('/matches/1');
    await post('/matches/1/stats/1/a', cells({ 1: [11, 6, 3, 2, ''], 2: [11, 2, 0, 1, ''] }));
    await post('/matches/1/stats/1/b', cells({ 9: [11, 3, 1, 0, ''] }));
    const warning = 'Carte 1 : Alpha Esport compte 8 kills, mais Bravo compte 1 morts.';
    expect(await (await request('/matches/1')).text()).toContain(warning);
    jar.clear();
    await logIn('/matches/1', 'code-lea');
    expect(await (await request('/matches/1')).text()).toContain(warning);
    jar.clear();
    await logIn('/matches/1', 'code-eve');
    expect(await (await request('/matches/1')).text()).not.toContain('Vérifiez');
  });
});
