import { schema } from '@ligo/db';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fakeEvidenceStore } from '../assets/evidence-store.ts';
import { fakeAssetStore } from '../assets/store.ts';
import { registrationDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { saveGameProfile } from './game-profile.ts';
import { inviteToken } from './invites.ts';
import { joinRegistration } from './joining.ts';
import { pngForTests } from './logo.ts';
import { setNationality, setStatsConsent } from './me.ts';
import type { Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';
import {
  approveRegistration,
  registrationsToApprove,
  rejectRegistration,
} from './registration-approval.ts';
import { setLineup } from './registration-lineup.ts';
import { fileRegistration, type RegistrationRequest } from './registrations.ts';
import { setTeamOwner } from './team-staff.ts';

// Staff approve a registration (design doc section 7; maintainer, 14 and 15 November 2026): its
// lineup complete, into a division with room (O-16, O-26), none of its players on another roster
// of the competition (O-29). Approval creates the club if new, the roster, its place in the
// division and its players; staff may refuse with a reason.

const NOW = 10_000;
const LATER = 20_000;
const SECRET = 's'.repeat(40);
const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const MEMBER: Actor = { ...STAFF, memberRoleIds: [] };
const always = () => Promise.resolve(true);

const REQUEST: RegistrationRequest = {
  club: {
    kind: 'new',
    name: 'Kairos Esport',
    city: 'Lyon',
    legalStatus: 'association_1901',
    socials: 'https://x.com/kairos',
    discordUrl: 'https://discord.gg/kairos',
  },
  roster: { name: 'Kairos', tag: 'KRS', colors: ['#112233', '#FFFFFF'], canStream: true },
  logo: pngForTests({ width: 512, height: 512, colorType: 6 }),
  rulesVersionId: 1,
  rulesAccepted: true,
};

async function setup(
  options: {
    players?: number;
    request?: Partial<RegistrationRequest>;
    /** Runs before the registration is filed. */
    before?: (db: ReturnType<typeof registrationDatabase>) => void;
  } = {},
) {
  const db = registrationDatabase();
  const evidence = fakeEvidenceStore();
  const assets = fakeAssetStore();
  const filer = ensurePlayer(
    db,
    { orgId: 1, discordUserId: '700000000000000001', displayName: 'Ana' },
    1,
  ).id;
  options.before?.(db);
  await fileRegistration(db, evidence, filer, 'lfr', { ...REQUEST, ...options.request }, NOW);
  const invite = db
    .select()
    .from(schema.registrationInvite)
    .orderBy(schema.registrationInvite.id)
    .all()
    .at(-1);
  if (!invite) throw new Error('no invitation');
  const link = { inviteId: invite.id, token: inviteToken(SECRET, invite), secret: SECRET };
  const requestId = invite.requestId;
  const ids: number[] = [];
  for (let n = 1; n <= (options.players ?? 5); n += 1) {
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
    await joinRegistration(db, always, { id, discordUserId }, link, NOW);
    ids.push(id);
  }
  if (ids.length > 0)
    setLineup(db, filer, requestId, { roles: new Map(), captainId: ids[0] ?? 0 }, NOW);
  const divisions = db
    .select()
    .from(schema.division)
    .where(eq(schema.division.seasonId, 2))
    .orderBy(schema.division.level)
    .all();
  const ligue2 = divisions[1]?.id ?? 0;
  const approve = (divisionId = ligue2, actor = STAFF) =>
    approveRegistration(db, assets, evidence, actor, { requestId, divisionId }, LATER);
  return { db, assets, evidence, filer, ids, requestId, divisions, ligue2, approve };
}

describe('registrationsToApprove', () => {
  it('lists waiting registrations with their players and the divisions’ room', async () => {
    const { db, ids } = await setup();
    const [entry] = registrationsToApprove(db, 1);
    expect(entry).toMatchObject({
      id: 1,
      roster: { name: 'Kairos', tag: 'KRS', hasLogo: true },
      club: { name: 'Kairos Esport', existing: false },
      filer: 'Ana',
      filedAt: NOW,
      lineup: { complete: true },
      onOtherRoster: [],
      divisions: [
        { name: 'Ligue 1', teams: 0, max: 12 },
        { name: 'Ligue 2', teams: 0, max: 12 },
      ],
    });
    // Staff see whether a player is old enough, never their birth date.
    expect(entry?.players[0]).toEqual({
      playerId: ids[0],
      name: 'P1',
      role: 'player',
      captain: true,
      ubisoftName: 'Player1',
      rank: 'gold',
      nationality: 'FR',
      ready: true,
    });
    expect(JSON.stringify(entry)).not.toContain('2000-01-01');
  });
});

describe('approveRegistration', () => {
  it('creates the club, the roster, its place and its players, audited', async () => {
    const { db, assets, filer, ids, ligue2, approve } = await setup();
    const reply = await approve();
    expect(reply).toEqual({ ok: true, teamId: expect.any(Number) as number, logoLost: false });
    if (!reply.ok) return;

    const club = db.select().from(schema.club).where(eq(schema.club.slug, 'kairos-esport')).get();
    const logoKey = Object.keys(assets.files)[0];
    expect(logoKey).toMatch(/^logos\/kairos-[0-9a-f]{8}\.png$/);
    expect(club).toMatchObject({
      name: 'Kairos Esport',
      city: 'Lyon',
      legalStatus: 'association_1901',
      colorsJson: ['#112233', '#FFFFFF'],
      logoKey,
      socialsJson: [{ label: 'x.com', url: 'https://x.com/kairos' }],
      discordUrl: 'https://discord.gg/kairos',
    });
    expect(
      db
        .select()
        .from(schema.clubStaff)
        .where(eq(schema.clubStaff.clubId, club?.id ?? 0))
        .all(),
    ).toMatchObject([{ playerId: filer, role: 'owner', since: LATER, until: null }]);
    // A new club's first roster takes the club's colours and logo.
    expect(
      db.select().from(schema.team).where(eq(schema.team.id, reply.teamId)).get(),
    ).toMatchObject({
      clubId: club?.id,
      title: 'r6',
      name: 'Kairos',
      tag: 'KRS',
      slug: 'kairos',
      colorsJson: null,
      logoKey: null,
      canStream: true,
    });
    expect(
      db.select().from(schema.slot).where(eq(schema.slot.teamId, reply.teamId)).all(),
    ).toMatchObject([{ divisionId: ligue2, status: 'active' }]);
    expect(
      db
        .select()
        .from(schema.rosterEntry)
        .where(eq(schema.rosterEntry.teamId, reply.teamId))
        .all()
        .map((row) => [row.playerId, row.role, row.captain, row.seasonId, row.validFrom]),
    ).toEqual(ids.map((id, index) => [id, 'player', index === 0, 2, LATER]));
    expect(db.select().from(schema.request).get()).toMatchObject({
      status: 'approved',
      decidedAt: LATER,
      teamId: reply.teamId,
    });
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      action: 'registration.approve',
      entity: 'request',
      entityId: '1',
      afterJson: { teamId: reply.teamId, divisionId: ligue2, clubId: club?.id },
    });
  });

  it('gives a new roster of an existing club its own colours and logo', async () => {
    const { db, assets, filer, approve } = await setup({
      // Ana runs Bravo's club, and registers a second roster of it.
      before: (db) =>
        setTeamOwner(
          db,
          STAFF,
          { teamId: 2, member: { id: '700000000000000001', displayName: 'Ana' } },
          5,
        ),
      request: {
        club: { kind: 'existing', clubId: 2 },
        roster: { name: 'Bravo B', tag: 'BRVB', colors: ['#AA0000', '#000000'], canStream: false },
      },
    });
    const clubs = db.select().from(schema.club).all().length;
    const reply = await approve();
    if (!reply.ok) throw new Error(reply.error);
    expect(db.select().from(schema.club).all()).toHaveLength(clubs);
    expect(
      db.select().from(schema.team).where(eq(schema.team.id, reply.teamId)).get(),
    ).toMatchObject({
      clubId: 2,
      name: 'Bravo B',
      colorsJson: ['#AA0000', '#000000'],
      logoKey: Object.keys(assets.files)[0],
    });
    expect(Object.keys(assets.files)[0]).toMatch(/^logos\/bravo-b-[0-9a-f]{8}\.png$/);
    // She already runs the club: no second owner row.
    expect(
      db
        .select()
        .from(schema.clubStaff)
        .where(and(eq(schema.clubStaff.clubId, 2), eq(schema.clubStaff.playerId, filer)))
        .all(),
    ).toHaveLength(1);
  });

  it('refuses what is not ready, with every reason at once', async () => {
    const { db, ids, approve } = await setup({ players: 4 });
    db.insert(schema.rosterEntry)
      .values({ seasonId: 2, teamId: 1, playerId: ids[1] ?? 0, role: 'player', validFrom: 1 })
      .run();
    const lfr = db.select().from(schema.competition).get();
    if (!lfr) throw new Error('no competition');
    db.update(schema.competition)
      .set({
        rulesetJson: {
          ...lfr.rulesetJson,
          registration: { ...lfr.rulesetJson.registration, division_max: 2 },
        },
      })
      .run();
    const ligue2 = db
      .select()
      .from(schema.division)
      .where(and(eq(schema.division.seasonId, 2), eq(schema.division.name, 'Ligue 2')))
      .get();
    for (const teamId of [1, 3]) {
      db.insert(schema.slot)
        .values({ divisionId: ligue2?.id ?? 0, teamId })
        .run();
    }
    expect(await approve()).toEqual({
      ok: false,
      error: 'not_approvable',
      reasons: [
        { error: 'lineup_incomplete' },
        { error: 'player_on_other_roster', playerIds: [ids[1]] },
        { error: 'division_full', max: 2 },
      ],
    });
    expect(db.select().from(schema.request).get()?.status).toBe('pending');
  });

  it('is for the league’s staff, into a division of the registration’s season, once', async () => {
    const { db, approve } = await setup();
    expect(await approve(undefined, MEMBER)).toEqual({ ok: false, error: 'not_staff' });
    const season3 = db.select().from(schema.division).where(eq(schema.division.seasonId, 1)).get();
    expect(await approve(season3?.id ?? 0)).toEqual({ ok: false, error: 'invalid_division' });
    expect(await approve()).toMatchObject({ ok: true });
    expect(await approve()).toEqual({ ok: false, error: 'not_found' });
  });

  it('refuses a name or tag a team took since the filing', async () => {
    const { db, approve } = await setup();
    db.update(schema.team).set({ tag: 'KRS' }).where(eq(schema.team.id, 1)).run();
    expect(await approve()).toEqual({ ok: false, error: 'tag_taken' });
  });

  it('approves without the logo when it cannot be kept, and says so', async () => {
    const { db, approve, assets } = await setup();
    assets.write = () => Promise.reject(new Error('disk full'));
    expect(await approve()).toMatchObject({ ok: true, logoLost: true });
    expect(
      db.select().from(schema.club).where(eq(schema.club.slug, 'kairos-esport')).get()?.logoKey,
    ).toBeNull();
  });
});

describe('rejectRegistration', () => {
  it('refuses with a reason, audited', async () => {
    const { db, requestId } = await setup();
    expect(rejectRegistration(db, STAFF, { requestId, reason: ' ' }, LATER)).toEqual({
      ok: false,
      error: 'reason_required',
    });
    expect(rejectRegistration(db, MEMBER, { requestId, reason: 'Logo' }, LATER)).toEqual({
      ok: false,
      error: 'not_staff',
    });
    expect(
      rejectRegistration(db, STAFF, { requestId, reason: 'Logo non conforme' }, LATER),
    ).toEqual({
      ok: true,
    });
    expect(db.select().from(schema.request).get()).toMatchObject({
      status: 'rejected',
      reason: 'Logo non conforme',
      decidedAt: LATER,
    });
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      action: 'registration.reject',
      afterJson: { status: 'rejected', reason: 'Logo non conforme' },
    });
    expect(rejectRegistration(db, STAFF, { requestId, reason: 'x' }, LATER)).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});
