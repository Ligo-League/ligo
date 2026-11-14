import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fakeEvidenceStore } from '../assets/evidence-store.ts';
import { saveGameProfile } from '../services/game-profile.ts';
import { inviteToken } from '../services/invites.ts';
import { setNationality, setStatsConsent } from '../services/me.ts';
import { ensurePlayer } from '../services/players.ts';
import { fileRegistration } from '../services/registrations.ts';
import { registrationDatabase, TEST_GUILD } from '../testing.ts';
import { loggedPath } from './app.ts';
import { ANA, TEST_NOW, testSite } from './testing.ts';

// Joining a registration from its invitation link, on the website (maintainer, 14 and 15
// November 2026).

const BEN = { id: '700000000000000002', displayName: 'Ben' };
const SECRET = 'x'.repeat(40);

async function site() {
  const db = registrationDatabase();
  const browser = testSite({ db, users: { 'code-ben': BEN } });
  // The test clock is 15 January 2027: Season 4 starts later here, so lineups are still open.
  db.update(schema.season)
    .set({ startsOn: '2027-06-07', endsOn: '2027-08-15' })
    .where(eq(schema.season.name, 'Saison 4'))
    .run();
  // Ben files the registration; Ana joins it.
  const ben = ensurePlayer(db, { orgId: 1, discordUserId: BEN.id, displayName: 'Ben' }, 1).id;
  await fileRegistration(
    db,
    fakeEvidenceStore(),
    ben,
    'lfr',
    {
      club: {
        kind: 'new',
        name: 'Kairos Esport',
        city: '',
        legalStatus: '',
        socials: '',
        discordUrl: '',
      },
      roster: { name: 'Kairos', tag: 'KRS', colors: ['#112233', '#FFFFFF'], canStream: false },
      logo: null,
      rulesVersionId: 1,
      rulesAccepted: true,
    },
    TEST_NOW,
  );
  const invite = db.select().from(schema.registrationInvite).get();
  if (!invite) throw new Error('no invitation');
  const path = `/join/${String(invite.id)}/${inviteToken(SECRET, invite)}`;
  /** Ana with a complete profile, and a member of the league's server. */
  const readyAna = () => {
    const ana = ensurePlayer(db, { orgId: 1, discordUserId: ANA.id, displayName: 'Ana' }, 1).id;
    saveGameProfile(db, ana, { ubisoftName: 'AnaR6', profileId: null, rank: 'gold' }, 1);
    setNationality(db, ana, 'FR', 1);
    setStatsConsent(db, ana, true, 1);
    db.update(schema.player)
      .set({ birthDate: '2000-05-17' })
      .where(eq(schema.player.id, ana))
      .run();
    browser.gateway.members.set(`${TEST_GUILD}:${ANA.id}`, []);
    return ana;
  };
  return { ...browser, path, readyAna };
}

describe('the invitation page', () => {
  it('sends a visitor to log in first, and back to the link', async () => {
    const { request, path } = await site();
    const response = await request(path);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`/auth/login?next=${encodeURIComponent(path)}`);
  });

  it('says a dead link is dead, without naming the team', async () => {
    const { request, path } = await site();
    for (const dead of [`${path.slice(0, -3)}abc`, '/join/9/abc', '/join/x/y']) {
      const response = await request(dead);
      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toContain('Lien d’invitation invalide');
      expect(text).not.toContain('Kairos');
    }
  });

  it('lets a ready player join, then shows them in', async () => {
    const { db, request, logIn, post, path, readyAna } = await site();
    const ana = readyAna();
    await logIn(path);
    const page = await request(path);
    expect(page.headers.get('cache-control')).toBe('no-store');
    const text = await page.text();
    expect(text).toContain('Ben t’invite dans l’équipe Kairos (KRS)');
    expect(text).toContain(`<form method="post" action="${path}">`);

    const joined = await post(path, {});
    expect(joined.status).toBe(303);
    expect(joined.headers.get('location')).toBe(path);
    expect(db.select().from(schema.registrationPlayer).all()).toMatchObject([
      { requestId: 1, playerId: ana, role: 'player' },
    ]);
    expect(await (await request(path)).text()).toContain(
      'Tu fais partie de cette équipe, comme titulaire.',
    );
  });

  it('lists what to complete first, with a link to the player’s page', async () => {
    const { request, logIn, path } = await site();
    await logIn(path);
    const text = await (await request(path)).text();
    expect(text).toContain('Avant de rejoindre, complète ta page :');
    expect(text).toContain('ta date de naissance');
    expect(text).toMatch(/<a href="\/me" target="_blank" rel="noopener"\s*>Ouvrir ma page</);
  });

  it('sends a player who is not on the league’s server there, with its link', async () => {
    const { db, request, logIn, post, gateway, path, readyAna } = await site();
    readyAna();
    gateway.members.clear();
    db.update(schema.leagueGuild).set({ inviteUrl: 'https://discord.gg/lfr' }).run();
    await logIn(path);
    const text = await (await request(path)).text();
    expect(text).toContain('il faut être membre du serveur Discord de la ligue');
    expect(text).toContain('href="https://discord.gg/lfr"');
    expect((await post(path, {})).status).toBe(303);
    expect(db.select().from(schema.registrationPlayer).all()).toEqual([]);
    gateway.failing = true;
    expect(await (await request(path)).text()).toContain('Discord ne répond pas');
  });

  it('refuses a join without the session’s token', async () => {
    const { db, request, logIn, path, readyAna } = await site();
    readyAna();
    await logIn(path);
    const form = {
      Origin: 'http://localhost:3000',
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    const response = await request(path, { method: 'POST', headers: form, body: '_csrf=forged' });
    expect(response.status).toBe(403);
    expect(db.select().from(schema.registrationPlayer).all()).toEqual([]);
  });
});

describe('the registrations on /me', () => {
  it('lists those filed and joined, and lets a player leave', async () => {
    const { db, request, logIn, post, path, readyAna, jar } = await site();
    readyAna();
    await logIn(path);
    await post(path, {});
    const text = await (await request('/me')).text();
    expect(text).toContain('Kairos');
    expect(text).toContain('<form method="post" action="/registrations/1/leave">');
    const left = await post('/registrations/1/leave', {});
    expect(left.headers.get('location')).toBe('/me?left=1');
    expect(db.select().from(schema.registrationPlayer).all()).toEqual([]);
    expect(await (await request('/me?left=1')).text()).toContain('Tu as quitté l’équipe.');
    expect((await post('/registrations/1/leave', {})).status).toBe(404);

    // The filer finds their registration's page from theirs.
    jar.clear();
    await logIn('/me', 'code-ben');
    expect(await (await request('/me')).text()).toContain('<a href="/registrations/1">');
  });
});

describe('the error log', () => {
  it('never holds an invitation’s token', () => {
    expect(loggedPath('/join/12/abcDEF_-123')).toBe('/join/12/…');
    expect(loggedPath('/join/12/abc/more')).toBe('/join/12/…/more');
    expect(loggedPath('/me')).toBe('/me');
  });
});
