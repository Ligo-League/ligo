import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fakeEvidenceStore } from '../assets/evidence-store.ts';
import { saveGameProfile } from '../services/game-profile.ts';
import { inviteToken } from '../services/invites.ts';
import { joinRegistration } from '../services/joining.ts';
import { setNationality, setStatsConsent } from '../services/me.ts';
import { ensurePlayer } from '../services/players.ts';
import { setLineup } from '../services/registration-lineup.ts';
import { fileRegistration } from '../services/registrations.ts';
import { registrationDatabase, TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, openLineups, TEST_NOW, testSite } from './testing.ts';

// Staff answer registrations on `/staff` (maintainer, 14 and 15 November 2026).

const BEN = { id: '700000000000000002', displayName: 'Ben' };
const SECRET = 'x'.repeat(40);
const always = () => Promise.resolve(true);

/** Ben files a registration, five players join it, and Ana is league staff. */
async function site(players = 5) {
  const db = openLineups(registrationDatabase());
  const browser = testSite({ db, users: { 'code-ben': BEN } });
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
  const link = { inviteId: invite.id, token: inviteToken(SECRET, invite), secret: SECRET };
  const ids: number[] = [];
  for (let n = 1; n <= players; n += 1) {
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
  if (ids.length > 0) setLineup(db, ben, 1, { roles: new Map(), captainId: ids[0] ?? 0 }, TEST_NOW);
  browser.setRoles([TEST_STAFF_ROLE], ANA.id);
  const ligue2 = db
    .select()
    .from(schema.division)
    .where(eq(schema.division.name, 'Ligue 2'))
    .all()
    .at(-1);
  return { ...browser, ligue2: String(ligue2?.id ?? 0) };
}

describe('registrations on /staff', () => {
  it('shows each registration with its players, and approves it into a division', async () => {
    const { db, request, logIn, post, ligue2, jar } = await site();
    await logIn('/staff');
    const page = await (await request('/staff')).text();
    expect(page).toContain('Inscriptions (1)');
    expect(page).toContain('Inscription — Kairos [KRS]');
    expect(page).toContain('Player1');
    expect(page).toContain('Ligue 2 — 0/12');

    const approved = await post('/staff/registrations/1/approve', { division: ligue2 });
    expect(approved.headers.get('location')).toBe('/staff?done=registration_approved');
    const created = db.select().from(schema.team).where(eq(schema.team.slug, 'kairos')).get();
    expect(created).toBeDefined();
    expect(await (await request('/staff')).text()).toContain('Inscriptions (0)');

    // The team's page lists its players; the filer reads the answer on the registration's page.
    const team = await (await request('/teams/kairos')).text();
    expect(team).toMatch(/P1\s*<span class="muted"\s*>·\s*titulaire · capitaine/);
    jar.clear();
    await logIn('/registrations/1', 'code-ben');
    const filer = await (await request('/registrations/1')).text();
    expect(filer).toContain('Inscription validée : l’équipe joue en Ligue 2.');
    expect(filer).toContain('<a href="/teams/kairos">Kairos</a>');
  });

  it('refuses with a reason the filer reads', async () => {
    const { request, logIn, post, jar } = await site();
    await logIn('/staff');
    expect(
      (await post('/staff/registrations/1/reject', { reason: '' })).headers.get('location'),
    ).toBe('/staff?error=reason_required');
    expect(
      (await post('/staff/registrations/1/reject', { reason: 'Logo non conforme' })).headers.get(
        'location',
      ),
    ).toBe('/staff?done=registration_rejected');
    jar.clear();
    await logIn('/registrations/1', 'code-ben');
    const filer = await (await request('/registrations/1')).text();
    expect(filer).toContain('Inscription refusée par le staff :');
    expect(filer).toContain('<blockquote>Logo non conforme</blockquote>');
    // The filer reaches that page from their own, without knowing its address.
    const me = await (await request('/me')).text();
    expect(me).toMatch(/<a href="\/registrations\/1">Kairos — LFR, Saison 4<\/a>/);
    expect(me).toContain('refusée par le staff');
  });

  it('says why an incomplete registration cannot be approved yet', async () => {
    const { request, logIn, post, ligue2 } = await site(3);
    await logIn('/staff');
    expect(await (await request('/staff')).text()).toContain('3 titulaire(s) sur 5');
    expect(
      (await post('/staff/registrations/1/approve', { division: ligue2 })).headers.get('location'),
    ).toBe('/staff?error=not_approvable');
  });

  it('is for the league’s staff only', async () => {
    const { db, logIn, post, setRoles, ligue2 } = await site();
    await logIn('/staff');
    setRoles([], ANA.id);
    expect((await post('/staff/registrations/1/approve', { division: ligue2 })).status).toBe(403);
    expect((await post('/staff/registrations/1/reject', { reason: 'Non' })).status).toBe(403);
    expect(db.select().from(schema.request).get()?.status).toBe('pending');
  });
});
