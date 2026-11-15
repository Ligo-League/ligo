import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fakeAssetStore } from '../assets/store.ts';
import { leagueDatabase } from '../testing.ts';
import { addRoster, createClub, creationChoices, type ClubForm, type RosterForm } from './clubs.ts';
import { pngForTests } from './logo.ts';
import { ensurePlayer } from './players.ts';
import { listTeamStaff } from './team-staff.ts';

// Clubs and rosters before any competition (M-33, maintainer, 15 November 2026). The league
// database has the group MBL Group (org 1), LFR (R6), and the teams Alpha Esport, Bravo, Charlie,
// Xray and Yankee, each the roster of a club of the same name.

const CLUB: ClubForm = {
  name: 'Kairos Esport',
  city: 'Lyon',
  legalStatus: '',
  socials: '',
  discordUrl: '',
};
const ROSTER: RosterForm = {
  name: 'Kairos',
  tag: 'krs',
  colors: ['#112233', '#FFFFFF'],
  canStream: false,
};
const LOGO = pngForTests({ width: 256, height: 256, colorType: 6 });

function setup() {
  const db = leagueDatabase();
  const assets = fakeAssetStore();
  const ana = ensurePlayer(
    db,
    { orgId: 1, discordUserId: '700000000000000001', displayName: 'Ana' },
    1,
  ).id;
  const ben = ensurePlayer(
    db,
    { orgId: 1, discordUserId: '700000000000000002', displayName: 'Ben' },
    1,
  ).id;
  const create = (changes: Partial<Parameters<typeof createClub>[3]> = {}) =>
    createClub(
      db,
      assets,
      ana,
      { orgId: 1, title: 'r6', club: CLUB, roster: ROSTER, logo: null, ...changes },
      5000,
    );
  return { db, assets, ana, ben, create };
}

describe('creationChoices', () => {
  it('offers each group with the games its competitions are played in', () => {
    const { db } = setup();
    expect(creationChoices(db)).toEqual([
      { id: 1, name: expect.any(String) as string, titles: ['r6'] },
    ]);
  });
});

describe('createClub', () => {
  it('creates the club and its first roster, in no competition, owned by the creator', async () => {
    const { db, ana, create } = setup();
    expect(await create()).toEqual({ ok: true, clubSlug: 'kairos-esport', teamSlug: 'kairos' });
    const created = db
      .select()
      .from(schema.club)
      .where(eq(schema.club.slug, 'kairos-esport'))
      .get();
    expect(created).toMatchObject({
      name: 'Kairos Esport',
      city: 'Lyon',
      colorsJson: ['#112233', '#FFFFFF'],
    });
    const roster = db.select().from(schema.team).where(eq(schema.team.slug, 'kairos')).get();
    // The first roster inherits the club's colours and logo.
    expect(roster).toMatchObject({
      clubId: created?.id,
      title: 'r6',
      tag: 'KRS',
      colorsJson: null,
      logoKey: null,
    });
    expect(
      db
        .select()
        .from(schema.slot)
        .where(eq(schema.slot.teamId, roster?.id ?? 0))
        .all(),
    ).toEqual([]);
    expect(listTeamStaff(db, roster?.id ?? 0)).toMatchObject([{ playerId: ana, role: 'owner' }]);
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      actorPlayerId: ana,
      action: 'club.create',
      entity: 'club',
      entityId: String(created?.id),
    });
  });

  it('keeps the logo as a 128 px square where images read logos', async () => {
    const { db, assets, create } = setup();
    expect((await create({ logo: LOGO })).ok).toBe(true);
    const key = db
      .select()
      .from(schema.club)
      .where(eq(schema.club.slug, 'kairos-esport'))
      .get()?.logoKey;
    expect(key).toMatch(/^logos\/kairos-[0-9a-f]{8}\.png$/);
    expect(Object.keys(assets.files)).toEqual([key]);
  });

  it('refuses taken names and tags, a game the group does not play, and a bad logo, storing nothing', async () => {
    const { db, assets, create } = setup();
    const before = db.select().from(schema.team).all().length;
    const reply = await create({
      club: { ...CLUB, name: 'Bravo' },
      roster: { ...ROSTER, name: 'Charlie', tag: 'ALP' },
      logo: new Uint8Array([1, 2, 3]),
    });
    expect(reply).toEqual({
      ok: false,
      errors: [
        { field: 'club.name', error: 'club_taken' },
        { field: 'rosterName', error: 'name_taken' },
        { field: 'tag', error: 'tag_taken' },
        { field: 'logo', error: 'invalid_logo' },
      ],
    });
    expect(await create({ title: 'valorant' })).toEqual({
      ok: false,
      errors: [{ field: 'title', error: 'invalid_title' }],
    });
    expect(await create({ orgId: 99 })).toMatchObject({
      ok: false,
      errors: [{ field: 'org', error: 'invalid_org' }],
    });
    expect(db.select().from(schema.team).all()).toHaveLength(before);
    expect(assets.files).toEqual({});
  });

  it('refuses a name already waiting in a registration', async () => {
    const { db, create, ben } = setup();
    db.insert(schema.request)
      .values({
        competitionId: 1,
        seasonId: db.select().from(schema.season).get()?.id ?? 0,
        kind: 'registration',
        payloadJson: {
          club: {
            kind: 'new',
            name: 'Kairos Esport',
            city: null,
            legalStatus: null,
            socials: [],
            discordUrl: null,
          },
          roster: {
            name: 'Kairos',
            tag: 'KRS',
            colors: ['#112233', '#FFFFFF'],
            logoKey: null,
            canStream: false,
          },
          rules: { versionId: 1, acceptedAt: 1 },
        },
        approval: 'staff',
        requestedBy: ben,
        requestedAt: 1,
      })
      .run();
    expect(await create()).toMatchObject({
      ok: false,
      errors: [
        { field: 'club.name', error: 'club_taken' },
        { field: 'rosterName', error: 'name_taken' },
        { field: 'tag', error: 'tag_taken' },
      ],
    });
  });
});

describe('addRoster', () => {
  it('lets the club’s officials add a roster with its own colours', async () => {
    const { db, assets, ana, ben, create } = setup();
    await create();
    const academy = {
      ...ROSTER,
      name: 'Kairos Academy',
      tag: 'KRSA',
      colors: ['#000000', '#FF0000'],
    };
    expect(
      await addRoster(
        db,
        assets,
        ben,
        'kairos-esport',
        { title: 'r6', roster: academy, logo: null },
        6000,
      ),
    ).toEqual({
      ok: false,
      error: 'not_your_club',
    });
    expect(
      await addRoster(
        db,
        assets,
        ana,
        'nobody',
        { title: 'r6', roster: academy, logo: null },
        6000,
      ),
    ).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(
      await addRoster(
        db,
        assets,
        ana,
        'kairos-esport',
        { title: 'r6', roster: academy, logo: null },
        6000,
      ),
    ).toEqual({
      ok: true,
      teamSlug: 'kairos-academy',
    });
    expect(
      db.select().from(schema.team).where(eq(schema.team.slug, 'kairos-academy')).get(),
    ).toMatchObject({
      tag: 'KRSA',
      colorsJson: ['#000000', '#FF0000'],
    });
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      action: 'club.roster.add',
    });
  });
});
