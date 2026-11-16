import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../services/permissions.ts';
import { setTeamOwner } from '../services/team-staff.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, TEST_NOW, testSite } from './testing.ts';

// The map veto on the website (phase 3e, design doc section 5): `/matches/:id/veto` for the two
// sides and league staff, through the same service as `/match veto` and its buttons. A veto
// started here is posted in the schedule channel (M-32); a choice made here edits that message.
// The page asks every few seconds whether the veto moved. Match 3 is Bravo (side A, 3rd, Ana's)
// v Charlie (side B, 2nd, Ben's), BO1: Bravo bans first.

const SCHEDULE = '800000000000000004';
const LEA = { id: '222222222222222222', displayName: 'Léa Staff' };
const BEN = { id: '700000000000000002', displayName: 'Ben' };
const STRANGER = { id: '700000000000000004', displayName: 'Stranger' };
const STAFF: Actor = { guildId: TEST_GUILD, user: LEA, memberRoleIds: [TEST_STAFF_ROLE] };
const NOW = Date.parse('2026-11-03T12:00:00Z');

function site({ scheduleChannel = true } = {}) {
  const db = leagueDatabase();
  setTeamOwner(db, STAFF, { teamId: 2, member: ANA }, 100);
  setTeamOwner(db, STAFF, { teamId: 3, member: BEN }, 100);
  if (scheduleChannel) db.update(schema.leagueGuild).set({ scheduleChannelId: SCHEDULE }).run();
  const browser = testSite({
    db,
    users: { 'code-ben': BEN, 'code-stranger': STRANGER, 'code-lea': LEA },
  });
  browser.setRoles([TEST_STAFF_ROLE], LEA.id);
  browser.advance(NOW - TEST_NOW);
  const steps = () => db.select().from(schema.vetoStep).where(eq(schema.vetoStep.matchId, 3)).all();
  const start = () => browser.post('/matches/3/veto/start', {});
  const choose = (step: number, choice: string) =>
    browser.post('/matches/3/veto/choose', { step: String(step), choice });
  return { ...browser, steps, start, choose };
}
const where = (response: Response) => response.headers.get('location');

describe('the veto page', () => {
  it('is for the two sides and league staff, linked from the match page', async () => {
    const { request, logIn, jar } = site();
    // A visitor is sent to log in first.
    expect((await request('/matches/3/veto')).status).toBe(303);
    await logIn('/matches/3/veto', 'code-stranger');
    expect((await request('/matches/3/veto')).status).toBe(404);
    jar.clear();
    await logIn('/matches/3/veto', 'code-lea');
    expect((await request('/matches/3/veto')).status).toBe(200);
    jar.clear();
    await logIn('/matches/3');
    expect(await (await request('/matches/3')).text()).toContain('href="/matches/3/veto"');
    const response = await request('/matches/3/veto');
    const page = await response.text();
    expect(page).toContain('Veto des cartes');
    expect(page).toContain('action="/matches/3/veto/start"');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('starts the veto, posted in the schedule channel with the page’s link', async () => {
    const { db, request, logIn, gateway, start } = site();
    await logIn('/matches/3/veto');
    expect(where(await start())).toBe('/matches/3/veto?veto=started');
    expect(gateway.posted).toMatchObject([
      { channelId: SCHEDULE, message: { mentionUserIds: [ANA.id, BEN.id] } },
    ]);
    expect(gateway.posted[0]?.message.buttons).toBeUndefined();
    expect(gateway.posted[0]?.message.content).toContain(
      'Les choix se font sur la page du veto : <http://localhost:3000/matches/3/veto>',
    );
    expect(db.select().from(schema.match).where(eq(schema.match.id, 3)).get()).toMatchObject({
      vetoChannelId: SCHEDULE,
      vetoMessageId: gateway.posted[0]?.messageId,
    });
    // Bravo's turn: Ana gets a button per map.
    const page = await (await request('/matches/3/veto')).text();
    expect(page).toContain('Au tour de Bravo : bannir une carte.');
    expect(page).toMatch(/name="choice"\s+value="Bank"/);
    expect(where(await start())).toBe('/matches/3/veto?veto_error=already_started');
  });

  it('says so when the league has no schedule channel', async () => {
    const { logIn, start } = site({ scheduleChannel: false });
    await logIn('/matches/3/veto');
    expect(where(await start())).toBe('/matches/3/veto?veto=started_unposted');
  });

  it('takes each side’s choice in turn, and edits the Discord message', async () => {
    const { request, logIn, jar, gateway, steps, start, choose } = site();
    await logIn('/matches/3/veto');
    await start();
    expect(where(await choose(0, 'Bank'))).toBe('/matches/3/veto?veto=chosen');
    expect(steps()).toMatchObject([{ seq: 0, side: 'a', action: 'ban', map: 'Bank' }]);
    expect(gateway.posted[0]?.edits).toBe(1);
    expect(gateway.posted[0]?.message.content).toContain('Bannies : Bank (Bravo)');

    // Not Bravo's turn now; and a choice made from an older page is stale.
    expect(where(await choose(1, 'Chalet'))).toBe('/matches/3/veto?veto_error=not_your_turn');
    const page = await (await request('/matches/3/veto')).text();
    expect(page).toContain('Au tour de Charlie');
    expect(page).not.toContain('name="choice"');

    jar.clear();
    await logIn('/matches/3/veto', 'code-ben');
    expect(where(await choose(0, 'Chalet'))).toBe('/matches/3/veto?veto_error=stale');
    expect(where(await choose(1, 'Bank'))).toBe('/matches/3/veto?veto_error=invalid_choice');
    expect(where(await choose(1, 'Chalet'))).toBe('/matches/3/veto?veto=chosen');
    expect(steps()).toHaveLength(2);
  });

  it('refuses a choice from outside the match, and a forged form', async () => {
    const { logIn, jar, start, choose, steps, request } = site();
    await logIn('/matches/3/veto');
    await start();
    jar.clear();
    await logIn('/me', 'code-stranger');
    expect(where(await choose(0, 'Bank'))).toBe('/matches/3/veto?veto_error=not_your_match');
    expect(steps()).toEqual([]);
    const forged = await request('/matches/3/veto/choose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ step: '0', choice: 'Bank' }),
    });
    expect(forged.status).toBe(403);
  });
});

describe('the veto page, kept up to date', () => {
  it('asks every few seconds, and gets nothing while the veto has not moved', async () => {
    const { request, logIn, jar, start, choose } = site();
    await logIn('/matches/3/veto');
    const page = await (await request('/matches/3/veto')).text();
    expect(page).toContain('hx-get="/matches/3/veto/live?step=-1"');
    expect(page).toContain('hx-trigger="every 3s"');
    expect((await request('/matches/3/veto/live?step=-1')).status).toBe(204);

    await start();
    const moved = await request('/matches/3/veto/live?step=-1');
    expect(moved.status).toBe(200);
    const fragment = await moved.text();
    expect(fragment).toContain('hx-get="/matches/3/veto/live?step=0"');
    expect(fragment).not.toContain('<html');
    expect((await request('/matches/3/veto/live?step=0')).status).toBe(204);

    await choose(0, 'Bank');
    expect((await request('/matches/3/veto/live?step=0')).status).toBe(200);

    // Someone outside the match learns nothing from it either.
    jar.clear();
    await logIn('/me', 'code-stranger');
    expect((await request('/matches/3/veto/live?step=0')).status).toBe(404);
  });

  it('stops asking once the veto is over', async () => {
    const { request, logIn, start, choose, jar } = site();
    await logIn('/matches/3/veto');
    await start();
    const as = async (code: string) => {
      jar.clear();
      await logIn('/me', code);
    };
    // Whoever's turn it is takes the first choice offered, until the veto is over.
    let page = await (await request('/matches/3/veto')).text();
    for (let round = 0; round < 30 && !page.includes('Veto terminé'); round += 1) {
      const choice = /name="choice"\s+value="([^"]+)"/.exec(page)?.[1];
      const step = /name="step" value="(\d+)"/.exec(page)?.[1];
      if (choice && step) await choose(Number(step), choice);
      else await as(page.includes('Au tour de Bravo') ? 'code-ana' : 'code-ben');
      page = await (await request('/matches/3/veto')).text();
    }
    expect(page).toContain('Veto terminé');
    expect(page).not.toContain('hx-trigger');
  });
});
