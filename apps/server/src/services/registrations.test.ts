import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { kairosRoster, leagueDatabase, LFR_KEY, registrationDatabase } from '../testing.ts';
import { ensurePlayer } from './players.ts';
import { fileRegistration, registrationForm, registrationStatus } from './registrations.ts';

// Registering a roster (design doc section 7; maintainer, 14 and 15 November 2026, M-33): an
// official who manages a roster's players registers it with the rulebook accepted, then picks
// its lineup among its players. Season 4 of LFR is open for registrations.

const NOW = 10_000;
const REQUEST = { teamId: 0, rulesVersionId: 1, rulesAccepted: true };

async function setup(db = registrationDatabase()) {
  const kairos = await kairosRoster(db);
  const file = (changes: Partial<typeof REQUEST> = {}, by = kairos.owner) =>
    fileRegistration(db, by, LFR_KEY, { ...REQUEST, teamId: kairos.teamId, ...changes }, NOW);
  return { db, ...kairos, file };
}

describe('registrationForm', () => {
  it('opens while a season takes registrations and a rulebook is in force', async () => {
    const { db, owner, teamId } = await setup();
    expect(registrationForm(db, LFR_KEY, owner, NOW)).toMatchObject({
      ok: true,
      competition: { name: 'LFR', slug: 'lfr' },
      season: { name: 'Saison 4' },
      rules: { id: 1, version: 'Saison 4' },
      rosters: [{ teamId, name: 'Kairos', tag: 'KRS', slug: 'kairos', players: 5 }],
      settings: { starters: 5, subs_max: 2, stats_consent_required: true },
    });
    expect(registrationForm(db, { ...LFR_KEY, competition: 'nope' }, owner, NOW)).toEqual({
      ok: false,
      error: 'not_found',
    });
    const closed = await setup(leagueDatabase());
    expect(registrationForm(closed.db, LFR_KEY, closed.owner, NOW)).toEqual({
      ok: false,
      error: 'closed',
    });
    const early = await setup(registrationDatabase(NOW + 1));
    expect(registrationForm(early.db, LFR_KEY, early.owner, NOW)).toEqual({
      ok: false,
      error: 'no_rules',
    });
  });

  it('offers only the rosters whose players the member manages, not registered yet', async () => {
    const { db, teamId, file } = await setup();
    const coach = ensurePlayer(
      db,
      { orgId: 1, discordUserId: '719999999999999999', displayName: 'Coach' },
      1,
    ).id;
    db.insert(schema.teamStaff).values({ teamId, playerId: coach, role: 'coach', since: 1 }).run();
    expect(registrationForm(db, LFR_KEY, coach, NOW)).toMatchObject({ ok: true, rosters: [] });
    expect(file().ok).toBe(true);
    const owner = db.select().from(schema.clubStaff).get()?.playerId ?? 0;
    expect(registrationForm(db, LFR_KEY, owner, NOW)).toMatchObject({ ok: true, rosters: [] });
  });
});

describe('fileRegistration', () => {
  it('files a registration naming the roster, with the rulebook accepted, audited', async () => {
    const { db, owner, teamId, file } = await setup();
    expect(file()).toEqual({ ok: true, id: 1 });
    expect(db.select().from(schema.request).get()).toMatchObject({
      kind: 'registration',
      status: 'pending',
      teamId,
      requestedBy: owner,
      payloadJson: { rules: { versionId: 1, acceptedAt: NOW } },
    });
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      actorPlayerId: owner,
      action: 'registration.file',
      entityId: '1',
      afterJson: { teamId, roster: 'Kairos', rulesVersionId: 1 },
    });
    // The lineup is picked next, among the roster's players.
    expect(db.select().from(schema.registrationPlayer).all()).toEqual([]);
  });

  it('refuses a roster not the member’s, one registered already, and the rulebook not accepted', async () => {
    const { db, playerIds, file } = await setup();
    expect(file({}, playerIds[0] ?? 0)).toEqual({
      ok: false,
      errors: [{ field: 'roster', error: 'not_your_roster' }],
    });
    expect(file({ rulesAccepted: false })).toEqual({
      ok: false,
      errors: [{ field: 'rules', error: 'rules_not_accepted' }],
    });
    expect(file({ rulesVersionId: 99 })).toEqual({
      ok: false,
      errors: [{ field: 'rules', error: 'rules_changed' }],
    });
    expect(file().ok).toBe(true);
    expect(file()).toEqual({ ok: false, errors: [{ field: 'roster', error: 'not_your_roster' }] });
    expect(db.select().from(schema.request).all()).toHaveLength(1);
  });

  it('is closed outside the registration period', async () => {
    const { file } = await setup(leagueDatabase());
    expect(file()).toEqual({ ok: false, error: 'closed' });
  });
});

describe('registrationStatus', () => {
  it('shows the filer the roster’s players to pick, and nobody else anything', async () => {
    const { db, owner, playerIds, file } = await setup();
    file();
    const status = registrationStatus(db, owner, 1, NOW);
    expect(status).toMatchObject({
      ok: true,
      status: 'pending',
      club: 'Kairos Esport',
      roster: { name: 'Kairos', slug: 'kairos' },
      rulesVersion: 'Saison 4',
      players: [],
      locked: false,
    });
    expect(status.ok && status.candidates.map((entry) => entry.playerId)).toEqual(playerIds);
    expect(status.ok && status.candidates[0]).toMatchObject({
      role: null,
      captain: false,
      gaps: [],
      unavailable: false,
    });
    expect(registrationStatus(db, playerIds[0] ?? 0, 1, NOW)).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('marks a player under the league’s age, or one in another registration of the league', async () => {
    const { db, owner, playerIds, file } = await setup();
    file();
    const [young, taken] = playerIds;
    db.update(schema.player)
      .set({ birthDate: '2015-01-01' })
      .where(eq(schema.player.id, young ?? 0))
      .run();
    db.insert(schema.request)
      .values({
        competitionId: 1,
        seasonId: db.select().from(schema.request).get()?.seasonId ?? 0,
        kind: 'registration',
        payloadJson: { rules: { versionId: 1, acceptedAt: 1 } },
        approval: 'staff',
        requestedBy: owner,
        requestedAt: 1,
      })
      .run();
    db.insert(schema.registrationPlayer)
      .values({ requestId: 2, playerId: taken ?? 0, role: 'player', joinedAt: 1 })
      .run();
    const status = registrationStatus(db, owner, 1, NOW);
    expect(status.ok && status.candidates.slice(0, 2)).toMatchObject([
      { gaps: ['too_young'], unavailable: false },
      { gaps: [], unavailable: true },
    ]);
  });

  it('still shows an older registration, filed with its club and roster, and staff’s answer', async () => {
    const { db, owner } = await setup();
    db.insert(schema.request)
      .values({
        competitionId: 1,
        seasonId:
          db.select().from(schema.season).where(eq(schema.season.name, 'Saison 4')).get()?.id ?? 0,
        kind: 'registration',
        payloadJson: {
          club: {
            kind: 'new',
            name: 'Benelux Club',
            city: null,
            legalStatus: null,
            socials: [],
            discordUrl: null,
          },
          roster: {
            name: 'Benelux',
            tag: 'BNL',
            colors: ['#000000', '#FFFFFF'],
            logoKey: null,
            canStream: false,
          },
          rules: { versionId: 1, acceptedAt: 1 },
        },
        approval: 'staff',
        status: 'rejected',
        reason: 'Logo non conforme',
        decidedAt: 2,
        requestedBy: owner,
        requestedAt: 1,
      })
      .run();
    expect(registrationStatus(db, owner, 1, NOW)).toMatchObject({
      ok: true,
      status: 'rejected',
      club: 'Benelux Club',
      roster: { name: 'Benelux', slug: null },
      candidates: [],
      decision: { reason: 'Logo non conforme' },
    });
  });
});
