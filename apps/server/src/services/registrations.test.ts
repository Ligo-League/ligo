import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { fakeEvidenceStore } from '../assets/evidence-store.ts';
import { leagueDatabase, registrationDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { pngForTests } from './logo.ts';
import type { Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';
import {
  fileRegistration,
  registrationForm,
  registrationStatus,
  type RegistrationRequest,
} from './registrations.ts';
import { setTeamOwner } from './team-staff.ts';

// Registering a roster (design doc section 7, "Registration"; maintainer, 14 November 2026): a
// logged-in member files the club and roster details with the rulebook accepted; players then
// join from the invitation, with their own account. Staff approve in phase 3d-4b.

const NOW = 10_000;
const DAY = 86_400_000;
const LOGO = pngForTests({ width: 512, height: 512, colorType: 6 });
const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};

function setup(db = registrationDatabase()) {
  const filer = ensurePlayer(
    db,
    { orgId: 1, discordUserId: '700000000000000001', displayName: 'Ana' },
    1,
  ).id;
  const store = fakeEvidenceStore();
  const file = (overrides: Partial<RegistrationRequest> = {}, by = filer) =>
    fileRegistration(db, store, by, 'lfr', { ...REQUEST, ...overrides }, NOW);
  return { db, filer, store, file };
}

const REQUEST: RegistrationRequest = {
  club: {
    kind: 'new',
    name: 'Kairos Esport',
    city: 'Lyon',
    legalStatus: 'association_1901',
    socials: 'https://x.com/kairos\nhttps://www.twitch.tv/kairos',
    discordUrl: 'https://discord.gg/kairos',
  },
  roster: { name: 'Kairos', tag: 'krs', colors: ['#112233', '#ffffff'], canStream: true },
  logo: LOGO,
  rulesVersionId: 1,
  rulesAccepted: true,
};

describe('registrationForm', () => {
  it('opens while a season takes registrations and a rulebook is in force', () => {
    const { db, filer } = setup();
    expect(registrationForm(db, 'lfr', filer, NOW)).toMatchObject({
      ok: true,
      competition: { name: 'LFR', slug: 'lfr' },
      season: { name: 'Saison 4' },
      rules: { id: 1, version: 'Saison 4' },
      clubs: [],
      settings: { starters: 5, subs_max: 2, stats_consent_required: true },
    });
    expect(registrationForm(db, 'nope', filer, NOW)).toEqual({ ok: false, error: 'not_found' });
    const closed = setup(leagueDatabase());
    expect(registrationForm(closed.db, 'lfr', closed.filer, NOW)).toEqual({
      ok: false,
      error: 'closed',
    });
    const early = setup(registrationDatabase(NOW + 1));
    expect(registrationForm(early.db, 'lfr', early.filer, NOW)).toEqual({
      ok: false,
      error: 'no_rules',
    });
  });

  it('offers the clubs the member runs, for a new roster of one of them', () => {
    const { db, filer } = setup();
    setTeamOwner(
      db,
      STAFF,
      { teamId: 2, member: { id: '700000000000000001', displayName: 'Ana' } },
      5,
    );
    expect(registrationForm(db, 'lfr', filer, NOW)).toMatchObject({
      ok: true,
      clubs: [{ id: 2, name: 'Bravo' }],
    });
  });
});

describe('fileRegistration', () => {
  it('files the request with the rulebook accepted, keeps the logo, and opens an invitation', async () => {
    const { db, filer, store, file } = setup();
    expect(await file()).toEqual({ ok: true, id: 1 });

    const [stored] = db.select().from(schema.request).all();
    expect(stored).toMatchObject({
      competitionId: 1,
      seasonId: 2,
      teamId: null,
      kind: 'registration',
      approval: 'staff',
      status: 'pending',
      requestedBy: filer,
      requestedAt: NOW,
    });
    const logoKey = [...store.files.keys()][0];
    expect(logoKey).toMatch(/^uploads\/[0-9a-f]{64}\.png$/);
    expect(stored?.payloadJson).toEqual({
      club: {
        kind: 'new',
        name: 'Kairos Esport',
        city: 'Lyon',
        legalStatus: 'association_1901',
        socials: [
          { label: 'x.com', url: 'https://x.com/kairos' },
          { label: 'twitch.tv', url: 'https://www.twitch.tv/kairos' },
        ],
        discordUrl: 'https://discord.gg/kairos',
      },
      roster: {
        name: 'Kairos',
        tag: 'KRS',
        colors: ['#112233', '#FFFFFF'],
        logoKey,
        canStream: true,
      },
      rules: { versionId: 1, acceptedAt: NOW },
    });
    expect(db.select().from(schema.registrationInvite).all()).toMatchObject([
      { requestId: 1, createdAt: NOW, expiresAt: NOW + 7 * DAY, revokedAt: null },
    ]);
    expect(db.select().from(schema.registrationInvite).get()?.nonce).toMatch(/^[\w-]{43}$/);
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      actorPlayerId: filer,
      action: 'registration.file',
      entity: 'request',
      entityId: '1',
      afterJson: { roster: 'Kairos', tag: 'KRS', club: 'Kairos Esport', rulesVersionId: 1 },
    });
  });

  it('registers a new roster of a club the member runs, and no other club', async () => {
    const { db, file } = setup();
    expect(await file({ club: { kind: 'existing', clubId: 2 } })).toEqual({
      ok: false,
      errors: [{ field: 'club.clubId', error: 'not_your_club' }],
    });
    setTeamOwner(
      db,
      STAFF,
      { teamId: 2, member: { id: '700000000000000001', displayName: 'Ana' } },
      5,
    );
    expect(await file({ club: { kind: 'existing', clubId: 2 } })).toEqual({ ok: true, id: 1 });
  });

  it('can do without a logo', async () => {
    const { db, store, file } = setup();
    expect(await file({ logo: null })).toEqual({ ok: true, id: 1 });
    expect(store.files.size).toBe(0);
    expect(db.select().from(schema.request).get()?.payloadJson).toMatchObject({
      roster: { logoKey: null },
    });
  });

  it('reports every problem with its field, and stores nothing', async () => {
    const { db, store, file } = setup();
    const reply = await file({
      club: {
        kind: 'new',
        name: 'alpha esport',
        city: 'x'.repeat(61),
        legalStatus: 'club',
        socials: 'javascript:alert(1)',
        discordUrl: 'http://discord.gg/x',
      },
      roster: { name: 'Bravo', tag: 'brv', colors: ['#000000'], canStream: false },
      logo: pngForTests({ width: 512, height: 512, colorType: 2 }),
      rulesAccepted: false,
    });
    expect(reply).toEqual({
      ok: false,
      errors: [
        { field: 'club.city', error: 'invalid_city' },
        { field: 'club.legalStatus', error: 'invalid_legal_status' },
        { field: 'club.socials', error: 'invalid_link' },
        { field: 'club.discordUrl', error: 'invalid_discord_url' },
        { field: 'club.name', error: 'club_taken' },
        { field: 'colors', error: 'invalid_colors' },
        { field: 'rosterName', error: 'name_taken' },
        { field: 'tag', error: 'tag_taken' },
        { field: 'logo', error: 'logo_not_transparent' },
        { field: 'rules', error: 'rules_not_accepted' },
      ],
    });
    expect(db.select().from(schema.request).all()).toEqual([]);
    expect(store.files.size).toBe(0);
  });

  it('refuses a name or tag another registration already waits with', async () => {
    const { file } = setup();
    await file();
    expect(
      await file({
        club: { ...REQUEST.club, name: 'Kairos Two' } as RegistrationRequest['club'],
        roster: { ...REQUEST.roster, name: 'kairos' },
      }),
    ).toEqual({
      ok: false,
      errors: [
        { field: 'rosterName', error: 'name_taken' },
        { field: 'tag', error: 'tag_taken' },
      ],
    });
    expect(await file({ roster: { ...REQUEST.roster, name: 'Kairos B', tag: 'KRSB' } })).toEqual({
      ok: false,
      errors: [{ field: 'club.name', error: 'club_taken' }],
    });
  });

  it('asks again when the rulebook changed while the form was open', async () => {
    const { file } = setup();
    expect(await file({ rulesVersionId: 9 })).toEqual({
      ok: false,
      errors: [{ field: 'rules', error: 'rules_changed' }],
    });
  });

  it('refuses when registration is closed, or the competition unknown', async () => {
    const closed = setup(leagueDatabase());
    expect(await closed.file()).toEqual({ ok: false, error: 'closed' });
    const { db, filer, store } = setup();
    expect(await fileRegistration(db, store, filer, 'nope', REQUEST, NOW)).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('keeps nothing when the logo cannot be stored', async () => {
    const { db, store, file } = setup();
    store.failing = true;
    expect(await file()).toEqual({
      ok: false,
      errors: [{ field: 'logo', error: 'logo_not_stored' }],
    });
    expect(db.select().from(schema.request).all()).toEqual([]);
  });
});

describe('registrationStatus', () => {
  it('shows the filer the registration, its invitation and what is missing', async () => {
    const { db, filer, file } = setup();
    await file();
    expect(registrationStatus(db, filer, 1, NOW + DAY)).toMatchObject({
      ok: true,
      id: 1,
      status: 'pending',
      competition: { name: 'LFR', slug: 'lfr' },
      season: 'Saison 4',
      club: { name: 'Kairos Esport', existing: false },
      roster: { name: 'Kairos', tag: 'KRS', hasLogo: true },
      rulesVersion: 'Saison 4',
      invite: { id: 1, expiresAt: NOW + 7 * DAY, active: true },
      players: [],
      lineup: {
        complete: false,
        gaps: [
          { gap: 'starters', have: 0, want: 5 },
          { gap: 'captain', have: 0 },
        ],
      },
    });
    expect(registrationStatus(db, filer, 1, NOW + 8 * DAY)).toMatchObject({
      invite: { active: false },
    });
  });

  it('is the filer’s only: anyone else finds nothing there', async () => {
    const { db, file } = setup();
    await file();
    const other = ensurePlayer(
      db,
      { orgId: 1, discordUserId: '700000000000000002', displayName: 'Ben' },
      1,
    ).id;
    expect(registrationStatus(db, other, 1, NOW)).toEqual({ ok: false, error: 'not_found' });
    expect(registrationStatus(db, other, 99, NOW)).toEqual({ ok: false, error: 'not_found' });
  });
});
