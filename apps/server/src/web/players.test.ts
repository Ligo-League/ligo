import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../services/permissions.ts';
import { saveSheet } from '../services/stat-sheets.ts';
import { leagueDatabase, mercatoLineups, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { testSite } from './testing.ts';

// A player's public page (phase 3i; design doc section 7, M-42). In leagueDatabase(), match 1 is
// Alpha 7–4 Bravo, validated; mercatoLineups() puts P1 (captain) in Alpha's Season 3 lineup.

const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const PROFILE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function site() {
  const db = leagueDatabase();
  const ids = mercatoLineups(db);
  const p1 = ids[0] ?? 0;
  db.update(schema.gameAccount)
    .set({ externalId: PROFILE_ID })
    .where(eq(schema.gameAccount.playerId, p1))
    .run();
  const browser = testSite({ db });
  const p1Played = () => {
    const reply = saveSheet(
      db,
      STAFF,
      {
        matchId: 1,
        n: 1,
        side: 'a',
        rows: [
          {
            playerId: p1,
            values: { rounds_played: '11', kills: '6', deaths: '3', assists: '2', headshots: '3' },
          },
        ],
      },
      1,
    );
    if (!reply.ok) throw new Error(JSON.stringify(reply));
  };
  const page = async (path: string) => {
    const response = await browser.request(path);
    return { status: response.status, text: await response.text() };
  };
  return { ...browser, db, p1, p1Played, page };
}

describe('a player’s page', () => {
  it('shows the person, the career and the game tab with figures', async () => {
    const { page, p1Played } = site();
    p1Played();
    const { status, text } = await page('/players/p1');
    expect(status).toBe(200);
    expect(text).toContain('<h1>P1</h1>');
    expect(text).toContain('France');
    expect(text).toContain('href="/teams/alpha-esport"');
    expect(text).toMatch(/Player1 ·\s+Or\s+<span class="muted"\s*>\(déclaré\)/);
    expect(text).toContain('LFR · Saison 3');
    expect(text).toMatch(/aria-current="page"\s*>Rainbow Six Siege/);
    expect(text).toContain('Par saison');
    expect(text).toContain('href="/matches/1"');
    // Its R6 tab is the same page.
    expect((await page('/players/p1/r6')).text).toContain('Journal des matchs');
  });

  it('shows nothing private: no profile ID, Discord ID or birth date', async () => {
    const { page, p1Played } = site();
    p1Played();
    const { text } = await page('/players/p1');
    expect(text).not.toContain(PROFILE_ID);
    expect(text).not.toContain('710000000000000001');
    expect(text).not.toContain('2000-01-01');
  });

  it('hides every figure of a player without stats consent, and keeps the matches', async () => {
    const { db, p1, page, p1Played } = site();
    p1Played();
    db.update(schema.player).set({ statsConsentAt: null }).where(eq(schema.player.id, p1)).run();
    const { text } = await page('/players/p1');
    expect(text).toContain('Statistiques masquées');
    expect(text).toContain('href="/matches/1"');
    expect(text).not.toContain('Par saison');
    expect(text).not.toContain('>Kills<');
  });

  it('exists for an account with nothing yet, and shows a name as text', async () => {
    const { db, page } = site();
    db.insert(schema.player)
      .values({ orgId: 1, slug: 'mallory', displayName: '<script>x</script>', createdAt: 1 })
      .run();
    const { status, text } = await page('/players/mallory');
    expect(status).toBe(200);
    expect(text).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(text).not.toContain('<script>x');
    expect(text).toContain('Aucun match officiel');
  });

  it('is not found for an unknown player, an unknown game or a game never played', async () => {
    const { page, p1Played } = site();
    p1Played();
    expect((await page('/players/nobody')).status).toBe(404);
    expect((await page('/players/p1/chess')).status).toBe(404);
    expect((await page('/players/p1/valorant')).status).toBe(404);
  });
});

describe('links to player pages', () => {
  it('come from the team page, the match scoreboard and /me', async () => {
    const { page, p1Played, logIn, request } = site();
    p1Played();
    expect((await page('/teams/alpha-esport')).text).toContain('href="/players/p1"');
    expect((await page('/matches/1')).text).toContain('href="/players/p1"');
    await logIn('/me');
    expect(await (await request('/me')).text()).toContain('Ma page publique');
  });
});
