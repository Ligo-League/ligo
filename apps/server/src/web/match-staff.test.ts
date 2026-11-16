import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { PNG_HEADER_FOR_TESTS } from '../assets/store.ts';
import type { Actor } from '../services/permissions.ts';
import { setTeamOwner } from '../services/team-staff.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, testSite } from './testing.ts';

// The staff panel on the match page (phase 3f, design doc section 3): league staff enter or
// correct a result with an optional screenshot, validate or refuse a report, annul a match with a
// reason, and record a forfeit, through the same services and Discord announcements as before.
// In leagueDatabase(): match 1 is Alpha 7–4 Bravo (validated), match 2 a forfeit by Charlie,
// match 3 Bravo (Ana's) v Charlie (Ben's), still to play.

const QUEUE = '800000000000000001';
const RESULTS = '800000000000000002';
const SCHEDULE = '800000000000000004';
const LEA = { id: '222222222222222222', displayName: 'Léa Staff' };
const BEN = { id: '700000000000000002', displayName: 'Ben' };
const STAFF: Actor = { guildId: TEST_GUILD, user: LEA, memberRoleIds: [TEST_STAFF_ROLE] };
const PNG = new Uint8Array([...PNG_HEADER_FOR_TESTS, 1, 2, 3]);
const png = () => new File([PNG], 'score.png', { type: 'image/png' });

function site() {
  const db = leagueDatabase();
  setTeamOwner(db, STAFF, { teamId: 2, member: ANA }, 100);
  setTeamOwner(db, STAFF, { teamId: 3, member: BEN }, 100);
  db.update(schema.leagueGuild)
    .set({ alertsChannelId: QUEUE, resultsChannelId: RESULTS, scheduleChannelId: SCHEDULE })
    .run();
  const browser = testSite({ db, users: { 'code-lea': LEA, 'code-ben': BEN } });
  browser.setRoles([TEST_STAFF_ROLE], LEA.id);
  const stored = (id = 3) => db.select().from(schema.match).where(eq(schema.match.id, id)).get();
  const enter = (scores = { score_a: '7', score_b: '5' }, file: File | null = png(), id = 3) =>
    browser.postFile(
      `/matches/${String(id)}/staff/result`,
      scores,
      file ? { screenshot: file } : {},
    );
  const act = (action: string, fields: Record<string, string> = {}, id = 3) =>
    browser.post(`/matches/${String(id)}/staff/${action}`, fields);
  return { ...browser, stored, enter, act };
}
const where = (response: Response) => response.headers.get('location');

describe('the staff panel on the match page', () => {
  it('is shown to league staff only', async () => {
    const { request, logIn, jar } = site();
    await logIn('/matches/3');
    expect(await (await request('/matches/3')).text()).not.toContain('Actions du staff');
    jar.clear();
    await logIn('/matches/3', 'code-lea');
    const page = await (await request('/matches/3')).text();
    expect(page).toContain('Actions du staff');
    expect(page).toContain('Saisir le résultat');
    expect(page).toContain('action="/matches/3/staff/forfeit"');
    // Each team's forfeits so far, and what the season does at each threshold.
    expect(page).toContain('Bravo : 0 forfait');
    expect(page).toContain('Charlie : 1 forfait');
    expect(page).toContain('Avertissement au 2e forfait, exclusion au 3e.');
  });

  it('enters a result with its screenshot: it counts at once and is announced', async () => {
    const { logIn, enter, stored, gateway, evidence } = site();
    await logIn('/matches/3', 'code-lea');
    expect(where(await enter())).toBe('/matches/3?staff=entered#staff');
    expect(stored()?.status).toBe('validated');
    expect(evidence.files.size).toBe(1);
    expect(gateway.posted).toMatchObject([
      {
        channelId: RESULTS,
        message: { content: 'Résultat validé — Ligue 1, semaine 3 : Bravo 7–5 Charlie.' },
      },
    ]);
  });

  it('corrects a validated result, without a screenshot', async () => {
    const { request, logIn, enter, gateway } = site();
    await logIn('/matches/1', 'code-lea');
    expect(await (await request('/matches/1')).text()).toContain('Corriger le résultat');
    expect(where(await enter({ score_a: '4', score_b: '7' }, null, 1))).toBe(
      '/matches/1?staff=entered#staff',
    );
    expect(gateway.posted[0]?.message.content).toBe(
      'Résultat corrigé — Ligue 1, semaine 1 : Alpha Esport 4–7 Bravo (au lieu de 7–4).',
    );
  });

  it('refuses an impossible score or a file that is not an image, and records nothing', async () => {
    const { logIn, enter, stored } = site();
    await logIn('/matches/3', 'code-lea');
    expect(where(await enter({ score_a: '7', score_b: '6' }))).toBe(
      '/matches/3?staff_error=impossible_score#staff',
    );
    const text = new File([new Uint8Array([1, 2, 3])], 'score.png', { type: 'image/png' });
    expect(where(await enter(undefined, text))).toBe(
      '/matches/3?staff_error=invalid_screenshot#staff',
    );
    expect(stored()?.status).toBe('scheduled');
  });

  it('validates or refuses the report waiting, named by its screenshot', async () => {
    const { request, logIn, jar, postFile, act, stored } = site();
    await logIn('/matches/3');
    await postFile('/matches/3/report', { score_a: '7', score_b: '5' }, { screenshot: png() });
    jar.clear();
    await logIn('/matches/3', 'code-lea');
    const page = await (await request('/matches/3')).text();
    const evidence = /name="evidence"\s+value="(\d+)"/.exec(page)?.[1] ?? '';
    expect(evidence).not.toBe('');
    expect(where(await act('reject', { evidence: '999' }))).toBe(
      '/matches/3?staff_error=stale#staff',
    );
    expect(where(await act('reject', { evidence }))).toBe('/matches/3?staff=rejected#staff');
    expect(stored()?.status).toBe('scheduled');
  });

  it('annuls a match only with a reason', async () => {
    const { logIn, act, stored } = site();
    await logIn('/matches/3', 'code-lea');
    expect(where(await act('void', { reason: ' ' }))).toBe(
      '/matches/3?staff_error=reason_required#staff',
    );
    expect(where(await act('void', { reason: 'Joueur non inscrit' }))).toBe(
      '/matches/3?staff=voided#staff',
    );
    expect(stored()?.status).toBe('void');
  });

  it('records a forfeit and announces it', async () => {
    const { logIn, act, stored, gateway } = site();
    await logIn('/matches/3', 'code-lea');
    expect(where(await act('forfeit', { side: 'both' }))).toBe('/matches/3?staff=forfeited#staff');
    expect(stored()?.status).toBe('forfeit');
    expect(gateway.posted[0]?.message.content).toContain('Aucune des deux équipes');
    expect(where(await act('forfeit', { side: 'a' }))).toBe(
      '/matches/3?staff_error=wrong_status#staff',
    );
  });

  it('refuses everyone else, checked again on every POST', async () => {
    const { logIn, jar, enter, act, stored, setRoles, advance } = site();
    await logIn('/matches/3');
    expect((await enter()).status).toBe(403);
    expect((await act('forfeit', { side: 'a' })).status).toBe(403);
    expect((await act('cheat')).status).toBe(404);
    // A staff member whose role was removed in Discord, once the role cache has expired.
    jar.clear();
    await logIn('/matches/3', 'code-lea');
    setRoles([], LEA.id);
    advance(61_000);
    expect((await act('forfeit', { side: 'a' })).status).toBe(403);
    expect(stored()?.status).toBe('scheduled');
  });

  it('sets any time on a match to play, and announces it (3f-3)', async () => {
    const { request, logIn, act, stored, gateway } = site();
    await logIn('/matches/3', 'code-lea');
    expect(await (await request('/matches/3')).text()).toContain('action="/matches/3/staff/time"');
    expect(await (await request('/matches/1')).text()).not.toContain(
      'action="/matches/1/staff/time"',
    );
    // Paris time, outside the match's week: staff bend the deadlines.
    expect(where(await act('time', { date: '2026-12-20', time: '18:30' }))).toBe(
      '/matches/3?staff=timed#staff',
    );
    const at = Date.parse('2026-12-20T17:30:00Z');
    expect(stored()).toMatchObject({ scheduledAt: at, autoScheduled: false });
    expect(gateway.posted).toMatchObject([
      {
        channelId: SCHEDULE,
        message: {
          content: `Horaire fixé — Ligue 1, semaine 3 : Bravo – Charlie : <t:${String(at / 1000)}:F>.`,
        },
      },
    ]);
  });

  it.each([
    [{ date: '20/12/2026', time: '18:30' }, 3, 'invalid_date'],
    [{ date: '2026-12-20', time: '18h' }, 3, 'invalid_time'],
    [{ date: '2026-12-20', time: '18:30' }, 1, 'not_schedulable'],
  ])('refuses a time %j on match %i', async (fields, id, error) => {
    const { logIn, act } = site();
    await logIn('/matches/3', 'code-lea');
    expect(where(await act('time', fields, id))).toBe(
      `/matches/${String(id)}?staff_error=${error}#staff`,
    );
  });
});
