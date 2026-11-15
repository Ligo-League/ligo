import type { RegistrationRole } from '@ligo/core';
import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setLineup } from '../services/registration-lineup.ts';
import { fileRegistration } from '../services/registrations.ts';
import { kairosRoster, registrationDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { openLineups, TEST_NOW, testSite } from './testing.ts';

// Staff answer registrations on `/staff` (maintainer, 14 and 15 November 2026). Ana registered her
// roster Kairos (M-33); Léa is league staff.

const LEA = { id: '222222222222222222', displayName: 'Léa Staff' };

/** Kairos is registered with `starters` starters, its captain the first; Léa is logged in. */
async function site(starters = 5) {
  const db = openLineups(registrationDatabase());
  const kairos = await kairosRoster(db, starters);
  const filed = fileRegistration(
    db,
    kairos.owner,
    'lfr',
    { teamId: kairos.teamId, rulesVersionId: 1, rulesAccepted: true },
    TEST_NOW,
  );
  if (!filed.ok) throw new Error('not filed');
  setLineup(
    db,
    kairos.owner,
    filed.id,
    {
      roles: new Map<number, RegistrationRole>(kairos.playerIds.map((id) => [id, 'player'])),
      captainId: kairos.playerIds[0] ?? null,
    },
    TEST_NOW,
  );
  const browser = testSite({ db, users: { 'code-lea': LEA } });
  browser.setRoles([TEST_STAFF_ROLE], LEA.id);
  for (const id of kairos.playerIds) {
    const discordUserId = db
      .select()
      .from(schema.player)
      .where(eq(schema.player.id, id))
      .get()?.discordUserId;
    if (discordUserId) browser.gateway.members.set(`${TEST_GUILD}:${discordUserId}`, []);
  }
  const ligue2 = db
    .select()
    .from(schema.division)
    .where(eq(schema.division.name, 'Ligue 2'))
    .all()
    .at(-1);
  await browser.logIn('/staff', 'code-lea');
  return { ...browser, ...kairos, ligue2: String(ligue2?.id ?? 0) };
}

describe('registrations on /staff', () => {
  it('shows each registration with its players, and approves it into a division', async () => {
    const { db, request, logIn, post, ligue2, jar, teamId } = await site();
    const page = await (await request('/staff')).text();
    expect(page).toContain('Inscriptions (1)');
    expect(page).toContain('Inscription — Kairos [KRS]');
    expect(page).toContain('Player1');
    expect(page).toContain('Ligue 2 — 0/12');

    const approved = await post('/staff/registrations/1/approve', { division: ligue2 });
    expect(approved.headers.get('location')).toBe('/staff?done=registration_approved');
    expect(db.select().from(schema.slot).where(eq(schema.slot.teamId, teamId)).all()).toHaveLength(
      1,
    );
    expect(await (await request('/staff')).text()).toContain('Inscriptions (0)');

    // The team's page lists its players; the filer reads the answer on the registration's page.
    const team = await (await request('/teams/kairos')).text();
    expect(team).toMatch(/P1\s*<span class="muted"\s*>·\s*titulaire · capitaine/);
    jar.clear();
    await logIn('/registrations/1');
    const filer = await (await request('/registrations/1')).text();
    expect(filer).toContain('Inscription validée : l’équipe joue en Ligue 2.');
    expect(filer).toContain('<a href="/teams/kairos">Kairos</a>');
  });

  it('refuses with a reason the filer reads, from their own page too', async () => {
    const { request, logIn, post, jar } = await site();
    expect(
      (await post('/staff/registrations/1/reject', { reason: '' })).headers.get('location'),
    ).toBe('/staff?error=reason_required');
    expect(
      (await post('/staff/registrations/1/reject', { reason: 'Logo non conforme' })).headers.get(
        'location',
      ),
    ).toBe('/staff?done=registration_rejected');
    jar.clear();
    await logIn('/registrations/1');
    const filer = await (await request('/registrations/1')).text();
    expect(filer).toContain('Inscription refusée par le staff :');
    expect(filer).toContain('<blockquote>Logo non conforme</blockquote>');
    const me = await (await request('/me')).text();
    expect(me).toMatch(/<a href="\/registrations\/1">Kairos — LFR, Saison 4<\/a>/);
    expect(me).toContain('refusée par le staff');
  });

  it('says why an incomplete registration cannot be approved yet', async () => {
    const { request, post, ligue2 } = await site(3);
    expect(await (await request('/staff')).text()).toContain('3 titulaire(s) sur 5');
    expect(
      (await post('/staff/registrations/1/approve', { division: ligue2 })).headers.get('location'),
    ).toBe('/staff?error=not_approvable');
  });

  it('is for the league’s staff only', async () => {
    const { db, post, setRoles, ligue2 } = await site();
    setRoles([], LEA.id);
    expect((await post('/staff/registrations/1/approve', { division: ligue2 })).status).toBe(403);
    expect((await post('/staff/registrations/1/reject', { reason: 'Non' })).status).toBe(403);
    expect(db.select().from(schema.request).get()?.status).toBe('pending');
  });
});
