import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, testSite } from './testing.ts';

// Seasons in the admin panel (phase 3h; M-40): LFR's staff (Ana, with the staff role) and MLB
// Group's owner create a season, change its settings and move its status forward. Season 3 of
// the test league has counted results, so its scoring is locked.

const OWNER = { id: '994597181476569170', displayName: 'Owner' };
const where = (response: Response) => response.headers.get('location');
const SEASON_3 = '/admin/mlb-group/lfr/seasons/1';

function site() {
  const browser = testSite({ users: { 'code-owner': OWNER } });
  const seasonRow = (id: number) =>
    browser.db.select().from(schema.season).where(eq(schema.season.id, id)).get();
  return { ...browser, seasonRow };
}

/** Every input of the page with its value, ticked boxes only, as a browser sends them. */
function inputsOf(page: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of page.matchAll(
    /<input\s+(?:type="date"\s+)?name="([^"]+)"\s+value="([^"]*)"/g,
  )) {
    fields[match[1] ?? ''] = match[2] ?? '';
  }
  for (const match of page.matchAll(
    /<input\s+type="checkbox"\s+name="([^"]+)"\s+value="1"\s+checked/g,
  )) {
    fields[match[1] ?? ''] = '1';
  }
  for (const match of page.matchAll(/<select name="([^"]+)">([\s\S]*?)<\/select>/g)) {
    fields[match[1] ?? ''] = /<option value="([^"]*)"\s+selected/.exec(match[2] ?? '')?.[1] ?? '';
  }
  for (const match of page.matchAll(/<textarea name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) {
    fields[match[1] ?? ''] = match[2] ?? '';
  }
  // The status form's select has no value chosen; the settings form never sends it.
  delete fields.status;
  return fields;
}

describe('creating a season', () => {
  it('is listed on the competition’s page, and leads to the new season’s page', async () => {
    const { request, logIn, post, setRoles, seasonRow } = site();
    await logIn('/admin/mlb-group/lfr/seasons/new');
    expect((await request('/admin/mlb-group/lfr/seasons/new')).status).toBe(403);
    setRoles([TEST_STAFF_ROLE], ANA.id);
    const competition = await (await request('/admin/mlb-group/lfr')).text();
    expect(competition).toContain(`href="${SEASON_3}"`);
    expect(competition).toContain('href="/admin/mlb-group/lfr/seasons/new"');
    const create = (fields: Record<string, string>) =>
      post('/admin/mlb-group/lfr/seasons/new', {
        name: 'Saison 4',
        starts_on: '2027-01-04',
        ends_on: '2027-03-14',
        ...fields,
      });
    const taken = await create({ name: 'Saison 3' });
    expect(taken.status).toBe(400);
    expect(await taken.text()).toContain('Déjà utilisé.');
    expect(where(await create({}))).toBe('/admin/mlb-group/lfr/seasons/2?done=created');
    expect(seasonRow(2)).toMatchObject({ name: 'Saison 4', status: 'registration' });
    const page = await (await request('/admin/mlb-group/lfr/seasons/2?done=created')).text();
    expect(page).toContain('Saison créée, ouverte aux inscriptions.');
    expect(page).toContain('href="/mlb-group/lfr/saison-4"');
  });
});

describe('a season’s settings', () => {
  it('keeps a locked season’s scoring from staff, and saves the rest', async () => {
    const { request, logIn, post, setRoles, seasonRow } = site();
    setRoles([TEST_STAFF_ROLE], ANA.id);
    await logIn(SEASON_3);
    const page = await (await request(SEASON_3)).text();
    expect(page).toContain('ses points, départages, scores de forfait et seuils sont verrouillés');
    expect(page).not.toContain('name="reason"');
    const fields = inputsOf(page);
    expect(fields).toMatchObject({
      name: 'Saison 3',
      starts_on: '2026-10-19',
      'settings.points.outcomes.win': '3',
      'settings.tiebreak.criteria.0': 'points',
      'settings.forfeits.exclusion_at': '3',
    });
    expect(fields['settings.map_pool']?.split('\n')).toContain('Kafe Dostoyevsky');
    const before = seasonRow(1);
    const locked = await post(SEASON_3, { ...fields, 'settings.points.outcomes.win': '2' });
    expect(locked.status).toBe(400);
    expect(await locked.text()).toContain('Seul le propriétaire de l’organisation peut le changer');
    expect(seasonRow(1)).toEqual(before);
    expect(where(await post(SEASON_3, { ...fields, 'settings.map_pool': 'Bank\nA<b>' }))).toBe(
      `${SEASON_3}?done=saved`,
    );
    expect(seasonRow(1)?.settingsJson.map_pool).toEqual(['Bank', 'A<b>']);
    // Shown as text, not markup.
    expect(await (await request(SEASON_3)).text()).toContain('A&lt;b&gt;');
  });

  it('lets the organisation’s owner change the locked scoring with a reason', async () => {
    const { request, logIn, post, seasonRow } = site();
    await logIn(SEASON_3, 'code-owner');
    const page = await (await request(SEASON_3)).text();
    expect(page).toContain('name="reason"');
    const fields = inputsOf(page);
    const change = { ...fields, 'settings.points.outcomes.win': '2' };
    const refused = await post(SEASON_3, change);
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain('Obligatoire.');
    expect(where(await post(SEASON_3, { ...change, reason: 'Vote des équipes' }))).toBe(
      `${SEASON_3}?done=saved`,
    );
    expect(seasonRow(1)?.settingsJson.points.outcomes.win).toBe(2);
  });

  it('is refused to anyone else, and not found for an unknown season', async () => {
    const { request, logIn, post, setRoles } = site();
    await logIn(SEASON_3);
    expect((await request(SEASON_3)).status).toBe(403);
    expect((await post(SEASON_3, { name: 'X' })).status).toBe(403);
    // Access comes first: a stranger learns nothing of which seasons exist.
    expect((await request('/admin/mlb-group/lfr/seasons/99')).status).toBe(403);
    setRoles([TEST_STAFF_ROLE], ANA.id);
    expect((await request('/admin/mlb-group/lfr/seasons/99')).status).toBe(404);
    expect((await request('/admin/mlb-group/lfr/seasons/abc')).status).toBe(404);
  });
});

describe('a season’s status', () => {
  it('offers only the statuses ahead, and moves there', async () => {
    const { request, logIn, post, setRoles, seasonRow } = site();
    setRoles([TEST_STAFF_ROLE], ANA.id);
    await logIn(SEASON_3);
    const page = await (await request(SEASON_3)).text();
    expect(page).toContain('<option value="cup">');
    expect(page).not.toContain('<option value="registration">');
    expect(where(await post(`${SEASON_3}/status`, { status: 'cup' }))).toBe(
      `${SEASON_3}?done=status`,
    );
    expect(seasonRow(1)?.status).toBe('cup');
    // Going back is refused: the page shows where the season is.
    expect(where(await post(`${SEASON_3}/status`, { status: 'active' }))).toBe(SEASON_3);
    expect(seasonRow(1)?.status).toBe('cup');
  });
});
