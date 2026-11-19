import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, testSite } from './testing.ts';

// Divisions in the admin panel (phase 3h): LFR's staff (Ana, with the staff role) add a division to
// Season 3 and change one, its results channel chosen among the league server's text channels.

const SEASON_3 = '/admin/mlb-group/lfr/seasons/1';
const RESULTS_L1 = '800000000000000003';
const where = (response: Response) => response.headers.get('location');

function site() {
  const browser = testSite();
  browser.gateway.guilds.set(TEST_GUILD, {
    name: 'LFR Staging',
    roles: [],
    managers: [],
    channels: [{ id: RESULTS_L1, name: 'résultats-l1', category: 'Ligue 1' }],
  });
  const divisionRow = (name: string) =>
    browser.db.select().from(schema.division).where(eq(schema.division.name, name)).get();
  return { ...browser, divisionRow };
}

describe('a season’s divisions', () => {
  it('are listed on the season’s page, added and changed by staff', async () => {
    const { request, logIn, post, setRoles, gateway, divisionRow } = site();
    await logIn(SEASON_3);
    expect((await request(`${SEASON_3}/divisions/new`)).status).toBe(403);
    setRoles([TEST_STAFF_ROLE], ANA.id);
    const ligue1 = divisionRow('Ligue 1');
    const season = await (await request(SEASON_3)).text();
    expect(season).toContain(`href="${SEASON_3}/divisions/${String(ligue1?.id)}"`);
    expect(season).toContain(`href="${SEASON_3}/divisions/new"`);

    const fields = {
      name: 'Ligue 3',
      kind: 'league',
      level: '3',
      region: '',
      category_prefix: 'L3',
      results_channel_id: '',
    };
    const taken = await post(`${SEASON_3}/divisions/new`, { ...fields, category_prefix: 'L1' });
    expect(taken.status).toBe(400);
    expect(await taken.text()).toContain('Déjà utilisé.');
    const created = where(await post(`${SEASON_3}/divisions/new`, fields));
    const ligue3 = divisionRow('Ligue 3');
    expect(created).toBe(`${SEASON_3}/divisions/${String(ligue3?.id)}?done=saved`);
    expect(ligue3).toMatchObject({ seasonId: 1, level: 3, categoryPrefix: 'L3' });

    const page = await (await request(`${SEASON_3}/divisions/${String(ligue1?.id)}`)).text();
    expect(page).toContain('#résultats-l1 (Ligue 1)');
    expect(
      where(
        await post(`${SEASON_3}/divisions/${String(ligue1?.id)}`, {
          ...fields,
          name: 'Ligue 1',
          level: '1',
          category_prefix: 'L1',
          results_channel_id: RESULTS_L1,
        }),
      ),
    ).toBe(`${SEASON_3}/divisions/${String(ligue1?.id)}?done=saved`);
    expect(divisionRow('Ligue 1')?.resultsChannelId).toBe(RESULTS_L1);
    expect(gateway.posted.at(-1)?.channelId).toBe(RESULTS_L1);
  });

  it('keeps the results channel as it is when Discord does not answer', async () => {
    const { request, logIn, setRoles, gateway, divisionRow } = site();
    setRoles([TEST_STAFF_ROLE], ANA.id);
    await logIn(SEASON_3);
    gateway.failing = true;
    // Roles were read at login and are cached; the channel list fails.
    const page = await (
      await request(`${SEASON_3}/divisions/${String(divisionRow('Ligue 1')?.id)}`)
    ).text();
    expect(page).toContain('type="hidden" name="results_channel_id"');
    expect(page).toContain('Discord ne répond pas');
  });

  it('is not found for a division of another season or an ID that is not one', async () => {
    const { request, logIn, setRoles } = site();
    setRoles([TEST_STAFF_ROLE], ANA.id);
    await logIn(SEASON_3);
    expect((await request(`${SEASON_3}/divisions/999`)).status).toBe(404);
    expect((await request(`${SEASON_3}/divisions/abc`)).status).toBe(404);
  });
});
