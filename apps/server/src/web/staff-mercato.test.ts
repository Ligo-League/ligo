import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_STAFF_ROLE } from '../testing.ts';
import { testSite } from './testing.ts';

// The staff's mercato windows (phase 3f-10, design doc section 7): open one with its limit and
// block, close it early, both announced in the league's #mercato channel. The test clock is
// 15 January 2027, 09:00 in Paris; LFR's mercato has windows, 3 moves and 24 hours.

const MERCATO = '800000000000000004';
const LEA = { id: '222222222222222222', displayName: 'Léa Staff' };
const WINDOW = {
  opens_date: '2027-01-16',
  opens_time: '00:00',
  closes_date: '2027-01-18',
  closes_time: '23:59',
  limit: '3',
  lock_hours: '24',
};

function site() {
  const db = leagueDatabase();
  db.update(schema.leagueGuild).set({ mercatoChannelId: MERCATO }).run();
  const browser = testSite({ db, users: { 'code-lea': LEA } });
  browser.setRoles([TEST_STAFF_ROLE], LEA.id);
  const act = (action: string, fields: Record<string, string>) =>
    browser.post(`/staff/mercato/1/${action}`, fields);
  const windows = () => db.select().from(schema.mercatoWindow).all();
  return { ...browser, db, act, windows };
}
const where = (response: Response) => response.headers.get('location');

describe('the staff mercato page', () => {
  it('shows the season’s windows and the form, prefilled from the league’s settings', async () => {
    const { request, logIn, jar } = site();
    expect(where(await request('/staff/mercato'))).toBe('/auth/login?next=/staff/mercato');
    await logIn('/me');
    expect((await request('/staff/mercato')).status).toBe(403);
    jar.clear();
    await logIn('/staff/mercato', 'code-lea');
    const page = await (await request('/staff/mercato')).text();
    expect(page).toContain('Fenêtres de mercato');
    expect(page).toContain('Saison en cours : Saison 3.');
    expect(page).toContain('Aucune fenêtre pour cette saison.');
    expect(page).toMatch(/name="limit"[^>]*value="3"/);
    expect(page).toMatch(/name="lock_hours"[^>]*value="24"/);
    expect(await (await request('/staff')).text()).toContain('href="/staff/mercato"');
  });

  it('opens a window in the league’s time zone and announces it in #mercato', async () => {
    const { request, logIn, act, windows, gateway } = site();
    await logIn('/staff/mercato', 'code-lea');
    expect(where(await act('open', WINDOW))).toBe('/staff/mercato?done=opened#c1');
    // Midnight in Paris in winter is 23:00 UTC the day before.
    expect(windows()).toMatchObject([
      {
        opensAt: Date.UTC(2027, 0, 15, 23, 0),
        closesAt: Date.UTC(2027, 0, 18, 22, 59),
        maxMovesPerTeam: 3,
        lockHours: 24,
      },
    ]);
    expect(gateway.posted).toHaveLength(1);
    expect(gateway.posted[0]?.channelId).toBe(MERCATO);
    expect(gateway.posted[0]?.message.content).toMatch(
      /^\*\*Mercato — LFR, Saison 3\*\* : fenêtre ouverte du <t:\d+:F> au <t:\d+:F>\. 3 mouvements au plus par équipe\. Un joueur qui arrive ne peut jouer que 24 h/,
    );
    const page = await (await request('/staff/mercato?done=opened')).text();
    expect(page).toContain('Fenêtre enregistrée.');
    expect(page).toContain('À venir');
  });

  it('takes an empty limit as none, and explains a refusal', async () => {
    const { logIn, act, windows } = site();
    await logIn('/staff/mercato', 'code-lea');
    expect(where(await act('open', { ...WINDOW, limit: '' }))).toBe(
      '/staff/mercato?done=opened#c1',
    );
    expect(windows()[0]?.maxMovesPerTeam).toBeNull();
    expect(where(await act('open', WINDOW))).toBe('/staff/mercato?error=overlaps#c1');
    expect(where(await act('open', { ...WINDOW, opens_date: 'demain' }))).toBe(
      '/staff/mercato?error=invalid_date#c1',
    );
    expect(where(await act('open', { ...WINDOW, closes_date: '2027-01-15' }))).toBe(
      '/staff/mercato?error=closes_before_opening#c1',
    );
    expect(where(await act('open', { ...WINDOW, lock_hours: '-1' }))).toBe(
      '/staff/mercato?error=invalid_lock#c1',
    );
    expect(windows()).toHaveLength(1);
  });

  it('closes an open window early, announced, and cancels one still to come', async () => {
    const { request, logIn, act, windows, gateway, advance } = site();
    await logIn('/staff/mercato', 'code-lea');
    await act('open', WINDOW);
    const id = String(windows()[0]?.id);
    advance(24 * 3_600_000);
    expect(where(await act('close', { window: id }))).toBe('/staff/mercato?done=closed#c1');
    expect(windows()[0]?.closedEarlyAt).not.toBeNull();
    expect(gateway.posted.at(-1)?.message.content).toMatch(
      /^\*\*Mercato\*\* : la fenêtre prévue jusqu'au <t:\d+:F> est fermée dès maintenant\./,
    );
    expect(where(await act('close', { window: id }))).toBe(
      '/staff/mercato?error=already_closed#c1',
    );
    expect(await (await request('/staff/mercato')).text()).toContain('Fermée');

    await act('open', { ...WINDOW, opens_date: '2027-02-01', closes_date: '2027-02-03' });
    const next = String(windows()[1]?.id);
    await act('close', { window: next });
    expect(gateway.posted.at(-1)?.message.content).toMatch(/est annulée\.$/);
  });

  it('refuses anyone who is not staff of that league, on every POST', async () => {
    const { logIn, act, windows, gateway } = site();
    await logIn('/me');
    expect((await act('open', WINDOW)).status).toBe(403);
    expect(windows()).toEqual([]);
    expect(gateway.posted).toEqual([]);
  });
});
