import { schema } from '@ligo/db';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { registrationDatabase, TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, TEST_ORIGIN, testSite } from './testing.ts';

// A season's schedule page (phase 4; design doc section 5, M-45): LFR's staff (Ana, with the
// staff role) draw Season 4's Ligue 1, mark weeks, and publish it. Season 3's five seeded teams
// register for it, so one team rests each week.

const SEASON_4 = '/admin/mlb-group/lfr/seasons/2';
const SCHEDULE = `${SEASON_4}/schedule`;
const where = (response: Response) => response.headers.get('location');

function site() {
  const db = registrationDatabase();
  const ligue1 = db
    .select()
    .from(schema.division)
    .where(and(eq(schema.division.seasonId, 2), eq(schema.division.name, 'Ligue 1')))
    .get();
  if (!ligue1) throw new Error('Season 4 has no Ligue 1');
  for (const { id } of db.select({ id: schema.team.id }).from(schema.team).all())
    db.insert(schema.slot).values({ divisionId: ligue1.id, teamId: id }).run();
  const browser = testSite({ db });
  const base = `${SCHEDULE}/${String(ligue1.id)}`;
  /** A form whose fields may repeat, as checkboxes send them. */
  const postAll = async (path: string, fields: [string, string][]) => {
    const page = await (await browser.request('/me')).text();
    const token = /name="_csrf" value="([^"]+)"/.exec(page)?.[1] ?? '';
    return browser.request(path, {
      method: 'POST',
      headers: { Origin: TEST_ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams([['_csrf', token], ...fields]),
    });
  };
  const stageRow = () =>
    db.select().from(schema.stage).where(eq(schema.stage.divisionId, ligue1.id)).get();
  const matchCount = () => {
    const stage = stageRow();
    return stage
      ? db.select().from(schema.match).where(eq(schema.match.stageId, stage.id)).all().length
      : 0;
  };
  const asStaff = async () => {
    browser.setRoles([TEST_STAFF_ROLE], ANA.id);
    await browser.logIn(SCHEDULE);
  };
  return { ...browser, db, ligue1, base, postAll, stageRow, matchCount, asStaff };
}

describe('the schedule page', () => {
  it('is linked from the season’s page and refused to who is not staff', async () => {
    const { request, logIn, setRoles } = site();
    expect(where(await request(SCHEDULE))).toBe(`/auth/login?next=${encodeURIComponent(SCHEDULE)}`);
    await logIn(SCHEDULE);
    expect((await request(SCHEDULE)).status).toBe(403);
    setRoles([TEST_STAFF_ROLE], ANA.id);
    expect(await (await request(SEASON_4)).text()).toContain(`href="${SCHEDULE}"`);
    const page = await (await request(SCHEDULE)).text();
    expect(page).toContain('Pas encore de brouillon.');
    expect(page).toContain('Équipes : 5.');
    expect(page).toContain('Créer le brouillon');
  });

  it('creates a draft and shows its calendar, with the team resting each week', async () => {
    const { request, post, base, asStaff, ligue1 } = site();
    await asStaff();
    expect(where(await post(`${base}/draft`, { best_of: '1' }))).toBe(
      `${SCHEDULE}?done=draft#division-${String(ligue1.id)}`,
    );
    const page = await (await request(`${SCHEDULE}?done=draft`)).text();
    expect(page).toContain('Brouillon enregistré.');
    expect(page).toContain('Aperçu');
    expect(page.match(/Exempt : /g)).toHaveLength(5);
    expect(page).toMatch(/name="off\[\]"\s+value="2027-01-04"/);
    expect(page).toContain('Nouveau tirage');
  });

  it('keeps every week off ticked, and shows them ticked again', async () => {
    const { request, postAll, base, asStaff, stageRow } = site();
    await asStaff();
    await postAll(`${base}/draft`, [
      ['best_of', '1'],
      ['off[]', '2027-01-18'],
      ['off[]', '2027-01-04'],
      ['extra[]', '2027-01-11'],
    ]);
    expect(stageRow()?.configJson).toMatchObject({
      weeks_off: ['2027-01-04', '2027-01-18'],
      extra_round_weeks: ['2027-01-11'],
    });
    const page = await (await request(SCHEDULE)).text();
    expect(page).toMatch(/name="off\[\]"\s+value="2027-01-18"[^>]*checked/);
  });

  it('publishes the draft: the matches exist and the page says so', async () => {
    const { request, post, base, asStaff, matchCount } = site();
    await asStaff();
    await post(`${base}/draft`, { best_of: '1' });
    expect(where(await post(`${base}/publish`, {}))).toContain('?done=publish');
    expect(matchCount()).toBe(10);
    const page = await (await request(SCHEDULE)).text();
    expect(page).toContain('Publié : 10 matchs sur 5 semaines.');
    expect(page).not.toContain('Créer le brouillon');
    // Published: the draft's actions are refused.
    expect(where(await post(`${base}/reshuffle`, {}))).toContain('?error=published');
  });

  it('opens a published week’s channels early, and says which weeks are open', async () => {
    const { request, post, base, asStaff, stageRow } = site();
    await asStaff();
    await post(`${base}/draft`, { best_of: '1' });
    expect(where(await post(`${base}/open-week`, { week: '1' }))).toContain('?error=no_draft');
    await post(`${base}/publish`, {});
    expect(await (await request(SCHEDULE)).text()).toContain('Ouvrir ses salons maintenant');
    expect(where(await post(`${base}/open-week`, { week: '2' }))).toContain('?done=open-week');
    expect(stageRow()?.configJson).toMatchObject({ opened_weeks: [2] });
    const page = await (await request(`${SCHEDULE}?done=open-week`)).text();
    expect(page).toContain('Semaines ouvertes en avance : w2.');
    expect(page).toContain('ses salons de match arrivent dans la minute');
    expect(where(await post(`${base}/open-week`, { week: '99' }))).toContain('?error=no_matches');
  });

  it('asks staff to tick the box before publishing past the season’s end', async () => {
    const { request, postAll, post, base, asStaff, matchCount } = site();
    await asStaff();
    // Seven of the season's ten weeks off: five rounds end in its 12th week.
    const off = [
      '2027-01-04',
      '2027-01-11',
      '2027-01-18',
      '2027-01-25',
      '2027-02-01',
      '2027-02-08',
      '2027-02-15',
    ];
    await postAll(`${base}/draft`, [
      ['best_of', '1'],
      ...off.map((day): [string, string] => ['off[]', day]),
    ]);
    const page = await (await request(SCHEDULE)).text();
    expect(page).toContain('name="accept_overrun"');
    expect(where(await post(`${base}/publish`, {}))).toContain('?error=overrun');
    expect(
      await (
        await request(`${SCHEDULE}?error=overrun&division=${base.split('/').at(-1) ?? ''}`)
      ).text(),
    ).toContain('cochez la case');
    expect(matchCount()).toBe(0);
    expect(where(await post(`${base}/publish`, { accept_overrun: 'yes' }))).toContain(
      '?done=publish',
    );
    expect(matchCount()).toBe(10);
  });

  it('shows team names as text', async () => {
    const { db, request, post, base, asStaff } = site();
    db.update(schema.team).set({ name: '<script>x</script>' }).where(eq(schema.team.id, 1)).run();
    await asStaff();
    await post(`${base}/draft`, { best_of: '1' });
    const page = await (await request(SCHEDULE)).text();
    expect(page).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(page).not.toContain('<script>x');
  });

  it('refuses a division address that is not a number, and a POST from another site', async () => {
    const { request, asStaff } = site();
    await asStaff();
    expect((await request(`${SCHEDULE}/abc/draft`, { method: 'POST' })).status).toBe(403);
    const response = await request(`${SCHEDULE}/1/draft`, {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'best_of=1',
    });
    expect(response.status).toBe(403);
  });
});
