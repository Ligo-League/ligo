import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fakeEvidenceStore } from '../assets/evidence-store.ts';
import { saveGameProfile } from '../services/game-profile.ts';
import { inviteToken } from '../services/invites.ts';
import { joinRegistration } from '../services/joining.ts';
import { setNationality, setStatsConsent } from '../services/me.ts';
import { ensurePlayer } from '../services/players.ts';
import { fileRegistration } from '../services/registrations.ts';
import { registrationDatabase } from '../testing.ts';
import { ANA, openLineups, TEST_NOW, testSite } from './testing.ts';

// The filer's registration page: the lineup, a new link, withdrawing (maintainer, 14 and 15
// November 2026).

const BEN = { id: '700000000000000002', displayName: 'Ben' };
const SECRET = 'x'.repeat(40);
const always = () => Promise.resolve(true);

/** Ana files the registration, six players join it. */
async function site() {
  const db = registrationDatabase();
  openLineups(db);
  const browser = testSite({ db, users: { 'code-ben': BEN } });
  const ana = ensurePlayer(db, { orgId: 1, discordUserId: ANA.id, displayName: 'Ana' }, 1).id;
  await fileRegistration(
    db,
    fakeEvidenceStore(),
    ana,
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
  const link = { inviteId: invite.id, token: inviteToken(SECRET, invite), secret: SECRET };
  const ids: number[] = [];
  for (let n = 1; n <= 6; n += 1) {
    const discordUserId = `71000000000000000${String(n)}`;
    const id = ensurePlayer(db, { orgId: 1, discordUserId, displayName: `P${String(n)}` }, 1).id;
    saveGameProfile(
      db,
      id,
      { ubisoftName: `Player${String(n)}`, profileId: null, rank: 'gold' },
      1,
    );
    setNationality(db, id, 'FR', 1);
    setStatsConsent(db, id, true, 1);
    db.update(schema.player).set({ birthDate: '2000-01-01' }).where(eq(schema.player.id, id)).run();
    await joinRegistration(db, always, { id, discordUserId }, link, TEST_NOW);
    ids.push(id);
  }
  const roles = () =>
    db
      .select()
      .from(schema.registrationPlayer)
      .all()
      .map((row) => [row.playerId, row.role, row.captain]);
  return { ...browser, ids, roles, oldPath: `/join/1/${link.token}` };
}

describe('the filer’s registration page', () => {
  it('sets starters, substitutes and the captain', async () => {
    const { request, logIn, post, ids, roles } = await site();
    const [p1 = 0, , , , p5 = 0, p6 = 0] = ids;
    await logIn('/registrations/1');
    const page = await (await request('/registrations/1')).text();
    expect(page).toContain('<form method="post" action="/registrations/1/lineup">');
    expect(page).toMatch(new RegExp(`<select\\s+name="role_${String(p6)}"`));
    expect(page).toMatch(new RegExp(`name="captain"\\s+value="${String(p1)}"`));

    const saved = await post('/registrations/1/lineup', {
      ...Object.fromEntries(ids.map((id) => [`role_${String(id)}`, 'player'])),
      [`role_${String(p5)}`]: 'sub',
      captain: String(p1),
    });
    expect(saved.headers.get('location')).toBe('/registrations/1?done=lineup');
    expect(roles()).toContainEqual([p1, 'player', true]);
    expect(roles()).toContainEqual([p5, 'sub', false]);
    const after = await (await request('/registrations/1?done=lineup')).text();
    expect(after).toContain('Effectif enregistré.');
    expect(after).toContain('L’équipe est au complet');
  });

  it('says why a lineup is refused', async () => {
    const { post, logIn, ids, roles } = await site();
    await logIn('/registrations/1');
    const before = roles();
    const refused = await post('/registrations/1/lineup', {
      [`role_${String(ids[5])}`]: 'sub',
      captain: String(ids[5]),
    });
    expect(refused.headers.get('location')).toBe('/registrations/1?error=captain_not_starter');
    expect(roles()).toEqual(before);
  });

  it('removes a player, makes a new link, and withdraws', async () => {
    const { db, request, logIn, post, ids, oldPath } = await site();
    await logIn('/registrations/1');
    const removed = await post(`/registrations/1/players/${String(ids[0])}/remove`, {});
    expect(removed.headers.get('location')).toBe('/registrations/1?done=removed');
    expect(db.select().from(schema.registrationPlayer).all()).toHaveLength(5);

    expect((await post('/registrations/1/invite', {})).headers.get('location')).toBe(
      '/registrations/1?done=invite',
    );
    const page = await (await request('/registrations/1')).text();
    expect(page).not.toContain(oldPath);
    expect((await request(oldPath)).status).toBe(404);

    // Withdrawing asks for a confirmation first.
    expect((await post('/registrations/1/withdraw', {})).headers.get('location')).toBe(
      '/registrations/1?error=confirm',
    );
    expect(
      (await post('/registrations/1/withdraw', { confirm: '1' })).headers.get('location'),
    ).toBe('/registrations/1?done=withdrawn');
    const withdrawn = await (await request('/registrations/1')).text();
    expect(withdrawn).toContain('Inscription retirée');
    expect(withdrawn).not.toContain('/join/');
    expect(withdrawn).not.toContain('action="/registrations/1/lineup"');
  });

  it('is the filer’s only', async () => {
    const { logIn, post, jar, roles } = await site();
    await logIn('/me', 'code-ben');
    const before = roles();
    expect((await post('/registrations/1/lineup', { captain: '1' })).status).toBe(404);
    expect((await post('/registrations/1/withdraw', { confirm: '1' })).status).toBe(404);
    expect(roles()).toEqual(before);
    jar.clear();
  });

  it('shows the lineup without changes once it is locked', async () => {
    const { db, request, logIn, post } = await site();
    db.update(schema.season)
      .set({ startsOn: '2027-01-10' })
      .where(eq(schema.season.name, 'Saison 4'))
      .run();
    await logIn('/registrations/1');
    const page = await (await request('/registrations/1')).text();
    expect(page).toContain('Les effectifs sont verrouillés');
    expect(page).not.toContain('action="/registrations/1/lineup"');
    expect((await post('/registrations/1/invite', {})).headers.get('location')).toBe(
      '/registrations/1?error=lineup_locked',
    );
  });
});
