import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { testSite } from './testing.ts';

// The bot's channels on the website (phase 3f-6, design doc section 7): league staff choose them
// among the league server's text channels, through the same service as `/league channel`. In
// leagueDatabase(): division 1 is Ligue 1, division 2 is Ligue 2.

const QUEUE = '800000000000000001';
const RESULTS = '800000000000000002';
const L1_RESULTS = '800000000000000003';
const ELSEWHERE = '800000000000000009';
const LEA = { id: '222222222222222222', displayName: 'Léa Staff' };
const PAGE = '/mbl-group/lfr/discord/channels';

function site() {
  const db = leagueDatabase();
  const browser = testSite({ db, users: { 'code-lea': LEA } });
  browser.gateway.guilds.set(TEST_GUILD, {
    name: 'LFR Staging',
    roles: [],
    managers: [],
    channels: [
      { id: QUEUE, name: 'validation', category: 'Staff' },
      { id: RESULTS, name: 'résultats', category: 'Ligue' },
      { id: L1_RESULTS, name: 'résultats-l1', category: 'Ligue' },
    ],
  });
  browser.setRoles([TEST_STAFF_ROLE], LEA.id);
  const choose = (fields: Record<string, string>) =>
    browser.post(PAGE, { kind: 'results', division: '', channel: '', ...fields });
  const stored = () => db.select().from(schema.leagueGuild).get();
  const divisionChannel = (id: number) =>
    db
      .select({ id: schema.division.id, channel: schema.division.resultsChannelId })
      .from(schema.division)
      .all()
      .find((row) => row.id === id)?.channel;
  return { ...browser, db, choose, stored, divisionChannel };
}
const where = (response: Response) => response.headers.get('location');

describe('the bot’s channels on the website', () => {
  it('shows the league server’s text channels to league staff only', async () => {
    const { request, logIn, jar } = site();
    expect(where(await request(PAGE))).toBe(`/auth/login?next=${encodeURIComponent(PAGE)}`);
    await logIn('/me');
    expect((await request(PAGE)).status).toBe(403);
    jar.clear();
    await logIn(PAGE, 'code-lea');
    const page = await (await request(PAGE)).text();
    expect(page).toContain('Salons du bot — LFR');
    expect(page).toMatch(/File de validation du staff<\/td>\s*<td>non choisi<\/td>/);
    expect(page).toMatch(/Résultats validés — Ligue 1<\/td>\s*<td>celui de la ligue<\/td>/);
    expect(page).toMatch(new RegExp(`value="${QUEUE}"\\s*>\\s*#validation \\(Staff\\)`));
    // The staff queue links to it.
    expect(await (await request('/staff')).text()).toContain(`href="${PAGE}"`);
  });

  it('stores a channel after the bot posts its notice there, as /league channel does', async () => {
    const { request, logIn, choose, stored, gateway, db } = site();
    await logIn(PAGE, 'code-lea');
    expect(where(await choose({ kind: 'staff_queue', channel: QUEUE }))).toBe(`${PAGE}?saved=1`);
    expect(stored()).toMatchObject({ alertsChannelId: QUEUE });
    expect(gateway.posted).toMatchObject([
      {
        channelId: QUEUE,
        message: {
          content:
            'Les résultats signalés par les équipes arriveront ici pour être validés par le staff.',
        },
      },
    ]);
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      action: 'league.channel.set',
      afterJson: { kind: 'staff_queue', channelId: QUEUE },
    });
    const page = await (await request(`${PAGE}?saved=1`)).text();
    expect(page).toContain('Salon enregistré.');
    expect(page).toMatch(/File de validation du staff<\/td>\s*<td>#validation<\/td>/);
  });

  it('gives a division its own results channel, then gives it back the league’s', async () => {
    const { logIn, choose, stored, divisionChannel } = site();
    await logIn(PAGE, 'code-lea');
    await choose({ channel: RESULTS });
    expect(where(await choose({ division: '1', channel: L1_RESULTS }))).toBe(`${PAGE}?saved=1`);
    expect(divisionChannel(1)).toBe(L1_RESULTS);
    expect(stored()?.resultsChannelId).toBe(RESULTS);
    expect(where(await choose({ division: '1', channel: '' }))).toBe(`${PAGE}?saved=1`);
    expect(divisionChannel(1)).toBeNull();
  });

  it('refuses a channel outside the league’s server, and a league channel left empty', async () => {
    const { request, logIn, choose, stored, gateway } = site();
    await logIn(PAGE, 'code-lea');
    expect(where(await choose({ channel: ELSEWHERE }))).toBe(`${PAGE}?error=channel_not_in_server`);
    expect(where(await choose({ channel: 'not-an-id' }))).toBe(
      `${PAGE}?error=channel_not_in_server`,
    );
    expect(where(await choose({ channel: '' }))).toBe(`${PAGE}?error=channel_required`);
    expect(where(await choose({ kind: 'schedule', division: '1', channel: QUEUE }))).toBe(
      `${PAGE}?error=queue_per_division`,
    );
    expect(gateway.posted).toEqual([]);
    expect(stored()?.resultsChannelId).toBeNull();
    expect(await (await request(`${PAGE}?error=channel_not_in_server`)).text()).toMatch(
      /Ce salon n(&#39;|')est pas un salon textuel du serveur de la ligue\./,
    );
  });

  it('stores nothing when the bot cannot write there or Discord does not answer', async () => {
    const { request, logIn, choose, stored, gateway } = site();
    await logIn(PAGE, 'code-lea');
    gateway.failing = true;
    expect(where(await choose({ channel: RESULTS }))).toBe(`${PAGE}?error=cannot_post`);
    expect(stored()?.resultsChannelId).toBeNull();
    // Roles were read before Discord stopped answering, and stay cached for a minute.
    expect((await request(PAGE)).status).toBe(502);
  });

  it('refuses anyone who is not staff of that league, on every POST', async () => {
    const { logIn, choose, stored, gateway } = site();
    await logIn('/me');
    expect((await choose({ channel: RESULTS })).status).toBe(403);
    expect(stored()?.resultsChannelId).toBeNull();
    expect(gateway.posted).toEqual([]);
    expect((await choose({ channel: RESULTS })).status).toBe(403);
  });
});
