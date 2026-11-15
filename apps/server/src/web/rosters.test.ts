import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fakeAssetStore } from '../assets/store.ts';
import { createClub } from '../services/clubs.ts';
import { saveGameProfile } from '../services/game-profile.ts';
import { setNationality } from '../services/me.ts';
import { ensurePlayer } from '../services/players.ts';
import { loggedPath } from './app.ts';
import { ANA, testSite } from './testing.ts';

// A roster's own players on the website (M-33): its officials share its invitation link, each
// player joins with their own account, and leaves from their page or is removed.

const BEN = { id: '700000000000000002', displayName: 'Ben' };
const CHLOE = { id: '700000000000000003', displayName: 'Chloé' };

async function site() {
  const browser = testSite({ users: { 'code-ben': BEN, 'code-chloe': CHLOE } });
  const { db } = browser;
  const ana = ensurePlayer(db, { orgId: 1, discordUserId: ANA.id, displayName: 'Ana' }, 1).id;
  await createClub(
    db,
    fakeAssetStore(),
    ana,
    {
      orgId: 1,
      title: 'r6',
      club: { name: 'Kairos Esport', city: '', legalStatus: '', socials: '', discordUrl: '' },
      roster: { name: 'Kairos', tag: 'KRS', colors: ['#112233', '#FFFFFF'], canStream: false },
      logo: null,
    },
    1,
  );
  // Ben has completed his profile; Chloé has not.
  const ben = ensurePlayer(db, { orgId: 1, discordUserId: BEN.id, displayName: 'Ben' }, 1).id;
  saveGameProfile(db, ben, { ubisoftName: 'BenR6', profileId: null, rank: 'gold' }, 1);
  setNationality(db, ben, 'FR', 1);
  const members = () =>
    db
      .select()
      .from(schema.rosterPlayer)
      .all()
      .filter((row) => row.leftAt === null)
      .map((row) => row.playerId);
  /** Ana creates the link and reads it on the page. */
  const shareLink = async () => {
    await browser.logIn('/teams/kairos/manage');
    await browser.post('/teams/kairos/manage/invite', {});
    const page = await (await browser.request('/teams/kairos/manage')).text();
    const found = /<code>http:\/\/localhost:3000(\/invite\/\d+\/[\w-]{43})<\/code>/.exec(page);
    if (!found?.[1]) throw new Error('no link on the page');
    browser.jar.clear();
    return found[1];
  };
  return { ...browser, ben, members, shareLink };
}
const where = (response: Response) => response.headers.get('location');

describe('a roster’s invitation link', () => {
  it('is created by the officials, shown on the page and kept by no cache', async () => {
    const { request, logIn, post } = await site();
    await logIn('/teams/kairos/manage');
    const before = await (await request('/teams/kairos/manage')).text();
    expect(before).toContain('0 joueur(s) sur 10 au plus.');
    expect(before).toContain('Créer un lien d’invitation');
    expect(where(await post('/teams/kairos/manage/invite', {}))).toBe(
      '/teams/kairos/manage?done=invite#players',
    );
    const response = await request('/teams/kairos/manage');
    expect(await response.text()).toMatch(/\/invite\/1\/[\w-]{43}/);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('lets a player with a complete profile join, then leave from their page', async () => {
    const { request, logIn, post, shareLink, members, ben } = await site();
    const link = await shareLink();
    expect(where(await request(link))).toBe(`/auth/login?next=${encodeURIComponent(link)}`);
    await logIn(link, 'code-ben');
    const page = await (await request(link)).text();
    expect(page).toContain('Rejoindre Kairos');
    expect(where(await post(link, {}))).toBe('/me?joined=1');
    expect(members()).toEqual([ben]);
    const me = await (await request('/me?joined=1')).text();
    expect(me).toContain('Tu as rejoint l’équipe.');
    expect(me).toContain('Équipes où je joue');
    expect(where(await post('/teams/kairos/roster/leave', {}))).toBe('/me?left=1');
    expect(members()).toEqual([]);
  });

  it('asks a player to complete their profile first', async () => {
    const { request, logIn, post, shareLink, members } = await site();
    const link = await shareLink();
    await logIn(link, 'code-chloe');
    const page = await (await request(link)).text();
    expect(page).toContain('ton compte R6');
    expect(where(await post(link, {}))).toBe(link);
    expect(members()).toEqual([]);
  });

  it('stops working once renewed, and a forged link opens nothing', async () => {
    const { request, logIn, post, shareLink, jar } = await site();
    const link = await shareLink();
    await logIn('/teams/kairos/manage');
    await post('/teams/kairos/manage/invite', { renew: '1' });
    jar.clear();
    await logIn(link, 'code-ben');
    expect((await request(link)).status).toBe(404);
    expect((await post(link, {})).status).toBe(404);
    expect((await request('/invite/1/short')).status).toBe(404);
  });

  it('lets the officials remove a player, and nobody else manage the players', async () => {
    const { request, logIn, post, shareLink, members, ben, jar } = await site();
    const link = await shareLink();
    await logIn(link, 'code-ben');
    await post(link, {});
    // A player is no official: no link to make.
    expect((await post('/teams/kairos/manage/invite', {})).status).toBe(403);
    jar.clear();
    await logIn('/me', 'code-chloe');
    expect((await post(`/teams/kairos/manage/players/${String(ben)}/remove`, {})).status).toBe(403);
    expect(members()).toEqual([ben]);
    jar.clear();
    await logIn('/teams/kairos/manage');
    expect(await (await request('/teams/kairos/manage')).text()).toContain(
      `action="/teams/kairos/manage/players/${String(ben)}/remove"`,
    );
    expect(where(await post(`/teams/kairos/manage/players/${String(ben)}/remove`, {}))).toBe(
      '/teams/kairos/manage?done=player_removed#players',
    );
    expect(members()).toEqual([]);
  });

  it('is kept out of the error log', () => {
    expect(loggedPath('/invite/3/abcDEF_-123')).toBe('/invite/3/…');
  });
});

describe('a roster playing a season under way', () => {
  it('keeps its players open, and shows the season’s lineup closed until a mercato window', async () => {
    const { db, request, logIn } = await site();
    const kairos = db.select().from(schema.team).where(eq(schema.team.slug, 'kairos')).get();
    const divisionId = db.select().from(schema.division).get()?.id ?? 0;
    db.insert(schema.slot)
      .values({ divisionId, teamId: kairos?.id ?? 0 })
      .run();
    await logIn('/teams/kairos/manage');
    const page = await (await request('/teams/kairos/manage')).text();
    expect(page).toContain('Effectif de la saison en cours');
    expect(page).toContain('<fieldset disabled>');
    expect(page).toContain('Créer un lien d’invitation');
  });
});
