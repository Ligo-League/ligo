import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { listTeamStaff } from '../services/team-staff.ts';
import { TEST_GUILD } from '../testing.ts';
import { testSite } from './testing.ts';

// Clubs and rosters before any competition (M-33): created on the website, owned by their
// creator, and managed by their own officials without league staff.

const BEN = { id: '700000000000000002', displayName: 'Ben' };
const STRANGER = { id: '700000000000000004', displayName: 'Stranger' };
const FORM = {
  org: '1',
  title: 'r6',
  club_name: 'Kairos Esport',
  club_city: 'Lyon',
  club_legal_status: '',
  club_socials: '',
  club_discord: '',
  roster_name: 'Kairos',
  roster_tag: 'KRS',
  color_1: '#112233',
  color_2: '#FFFFFF',
};

function site() {
  const browser = testSite({ users: { 'code-ben': BEN, 'code-stranger': STRANGER } });
  browser.gateway.usernames.set(`${TEST_GUILD}:ben`, BEN);
  const kairos = () =>
    browser.db.select().from(schema.team).where(eq(schema.team.slug, 'kairos')).get();
  const officials = () =>
    listTeamStaff(browser.db, kairos()?.id ?? 0).map((member) => [member.displayName, member.role]);
  return { ...browser, kairos, officials };
}
const where = (response: Response) => response.headers.get('location');

describe('/clubs/new', () => {
  it('asks to log in, then creates the club and its first roster, owned by the creator', async () => {
    const { request, logIn, post, kairos, officials } = site();
    expect(where(await request('/clubs/new'))).toBe('/auth/login?next=%2Fclubs%2Fnew');
    await logIn('/clubs/new');
    const form = await (await request('/clubs/new')).text();
    expect(form).toContain('Créer un club');
    expect(form).toContain('<input type="hidden" name="title" value="r6" />');

    expect(where(await post('/clubs/new', FORM))).toBe('/teams/kairos/manage?done=created');
    expect(kairos()).toMatchObject({ name: 'Kairos', tag: 'KRS', title: 'r6' });
    expect(officials()).toEqual([['Ana', 'owner']]);
    const page = await (await request('/teams/kairos/manage?done=created')).text();
    expect(page).toContain('C’est créé');
    expect(page).toContain('ne joue encore dans aucune compétition');
    expect(page).toContain('href="/clubs/kairos-esport/rosters/new"');
    // The club's public page still answers at its own address.
    expect((await request('/clubs/kairos-esport')).status).toBe(200);
  });

  it('shows what to fix, keeping what was typed', async () => {
    const { logIn, post, kairos } = site();
    await logIn('/clubs/new');
    const refused = await post('/clubs/new', { ...FORM, club_name: 'Bravo', roster_tag: 'BRV' });
    expect(refused.status).toBe(400);
    const page = await refused.text();
    expect(page).toContain('value="Kairos"');
    expect(kairos()).toBeUndefined();
    const reserved = await post('/clubs/new', { ...FORM, club_name: 'New' });
    expect(reserved.status).toBe(400);
  });
});

describe('a roster in no competition', () => {
  async function created() {
    const browser = site();
    await browser.logIn('/clubs/new');
    await browser.post('/clubs/new', FORM);
    return browser;
  }

  it('is changed at once by its officials, a username found on the group’s servers', async () => {
    const { post, officials, db } = await created();
    expect(
      where(await post('/teams/kairos/manage/add', { username: 'Ben', role: 'manager' })),
    ).toBe('/teams/kairos/manage?done=changed');
    expect(officials()).toEqual([
      ['Ana', 'owner'],
      ['Ben', 'manager'],
    ]);
    expect(db.select().from(schema.request).all()).toEqual([]);
  });

  it('follows the core rules: a manager may not hand the club over, and may leave', async () => {
    const { post, jar, logIn, officials } = await created();
    await post('/teams/kairos/manage/add', { username: 'ben', role: 'manager' });
    jar.clear();
    await logIn('/teams/kairos/manage', 'code-ben');
    expect(where(await post('/teams/kairos/manage/owner', { username: 'ben' }))).toBe(
      '/teams/kairos/manage?error=owner_only',
    );
    expect(where(await post('/teams/kairos/manage/leave', { confirm: 'yes' }))).toBe('/me?left=1');
    expect(officials()).toEqual([['Ana', 'owner']]);
  });

  it('is for its own officials only', async () => {
    const { request, post, jar, logIn, officials } = await created();
    jar.clear();
    await logIn('/teams/kairos/manage', 'code-stranger');
    expect((await request('/teams/kairos/manage')).status).toBe(403);
    expect(
      (await post('/teams/kairos/manage/add', { username: 'ben', role: 'coach' })).status,
    ).toBe(403);
    expect((await request('/clubs/kairos-esport/rosters/new')).status).toBe(403);
    expect(officials()).toEqual([['Ana', 'owner']]);
  });

  it('lets the club’s officials add another roster', async () => {
    const { request, post, db } = await created();
    expect((await request('/clubs/kairos-esport/rosters/new')).status).toBe(200);
    const added = await post('/clubs/kairos-esport/rosters', {
      title: 'r6',
      roster_name: 'Kairos Academy',
      roster_tag: 'KRSA',
      color_1: '#000000',
      color_2: '#FF0000',
    });
    expect(where(added)).toBe('/teams/kairos-academy/manage?done=created');
    expect(
      db.select().from(schema.team).where(eq(schema.team.slug, 'kairos-academy')).get(),
    ).toMatchObject({
      tag: 'KRSA',
      colorsJson: ['#000000', '#FF0000'],
    });
  });
});
