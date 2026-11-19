import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase } from '../testing.ts';
import { pngForTests } from './logo.ts';
import { ensurePlayer } from './players.ts';
import { fakeAssetStore } from '../assets/store.ts';
import { fakeGateway } from '../discord/testing.ts';
import {
  checkOrgInvite,
  createOrg,
  handOverOrg,
  orgAdmin,
  ownedOrgs,
  setOrgLogo,
  updateOrg,
} from './orgs.ts';

// Organisations in the admin panel (design doc section 7; M-20, maintainer, 19 November 2026):
// whoever may manage a Discord server where the bot is creates one and owns it; the owner is a
// Discord account kept in Ligo, who edits it and may hand it over.

const NOW = 1_800_000_000_000;
const ZOE = { discordUserId: '700000000000000031', playerId: 0 };

function league() {
  const db = leagueDatabase();
  const zoe = {
    ...ZOE,
    playerId: ensurePlayer(
      db,
      { orgId: 1, discordUserId: ZOE.discordUserId, displayName: 'Zoé' },
      1,
    ).id,
  };
  const create = (values: Partial<Parameters<typeof createOrg>[2]> = {}, manages = true) =>
    createOrg(
      db,
      zoe,
      { name: 'Benelux Siege League', slug: '', locale: 'en', description: '', ...values },
      { managesAServer: manages },
      NOW,
    );
  const orgRow = (slug: string) =>
    db.select().from(schema.org).where(eq(schema.org.slug, slug)).get();
  return { db, zoe, create, orgRow };
}

describe('creating an organisation', () => {
  it('makes its creator the owner, with a slug from its name, and audits it', () => {
    const { db, create, orgRow } = league();
    expect(create()).toEqual({ ok: true, slug: 'benelux-siege-league' });
    expect(orgRow('benelux-siege-league')).toMatchObject({
      name: 'Benelux Siege League',
      locale: 'en',
      ownerDiscordUserId: ZOE.discordUserId,
      description: null,
    });
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      action: 'org.create',
      entity: 'org',
      afterJson: { name: 'Benelux Siege League', slug: 'benelux-siege-league' },
    });
  });

  it('is for someone who manages a Discord server where the bot is', () => {
    const { create } = league();
    expect(create({}, false)).toEqual({ ok: false, errors: { form: 'no_server' } });
  });

  it('refuses a slug taken, reserved or not a slug, and a name too short', () => {
    const { create } = league();
    expect(create({ slug: 'mlb-group' })).toEqual({ ok: false, errors: { slug: 'taken' } });
    expect(create({ slug: 'staff' })).toEqual({ ok: false, errors: { slug: 'reserved' } });
    expect(create({ slug: 'Bad Slug' })).toEqual({ ok: false, errors: { slug: 'invalid' } });
    expect(create({ name: ' x ', slug: 'bsl' })).toEqual({ ok: false, errors: { name: 'length' } });
    expect(create({ locale: 'de' })).toEqual({ ok: false, errors: { locale: 'invalid' } });
  });
});

describe('an organisation’s admin page', () => {
  it('is its owner’s, with its competitions', () => {
    const { db, zoe, create } = league();
    create();
    expect(orgAdmin(db, zoe, 'benelux-siege-league')).toMatchObject({
      ok: true,
      org: { name: 'Benelux Siege League', slug: 'benelux-siege-league', locale: 'en' },
      competitions: [],
    });
    // MLB Group is someone else's.
    expect(orgAdmin(db, zoe, 'mlb-group')).toEqual({ ok: false, error: 'not_owner' });
    expect(orgAdmin(db, zoe, 'nowhere')).toEqual({ ok: false, error: 'not_found' });
    const owner = { discordUserId: '994597181476569170', playerId: 0 };
    expect(orgAdmin(db, owner, 'mlb-group')).toMatchObject({
      ok: true,
      competitions: [{ name: 'LFR', slug: 'lfr' }],
    });
    expect(ownedOrgs(db, zoe).map((entry) => entry.slug)).toEqual(['benelux-siege-league']);
  });

  it('saves the name, language, description and invitation, audited', () => {
    const { db, zoe, create, orgRow } = league();
    create();
    const reply = updateOrg(
      db,
      zoe,
      'benelux-siege-league',
      {
        name: 'BSL',
        locale: 'fr',
        description: '  La ligue du Benelux.  ',
        inviteUrl: 'https://discord.gg/bsl',
      },
      NOW,
    );
    expect(reply).toEqual({ ok: true });
    expect(orgRow('benelux-siege-league')).toMatchObject({
      name: 'BSL',
      locale: 'fr',
      description: 'La ligue du Benelux.',
      inviteUrl: 'https://discord.gg/bsl',
    });
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      action: 'org.update',
      beforeJson: { name: 'Benelux Siege League', locale: 'en' },
      afterJson: { name: 'BSL', locale: 'fr' },
    });
    expect(
      updateOrg(
        db,
        zoe,
        'benelux-siege-league',
        { name: 'BSL', locale: 'fr', description: '', inviteUrl: '' },
        NOW,
      ),
    ).toEqual({ ok: true });
    expect(orgRow('benelux-siege-league')?.inviteUrl).toBeNull();
    expect(
      updateOrg(
        db,
        zoe,
        'mlb-group',
        { name: 'X', locale: 'fr', description: '', inviteUrl: '' },
        NOW,
      ),
    ).toEqual({ ok: false, error: 'not_owner' });
  });
});

describe('handing an organisation over', () => {
  it('goes to someone Ligo knows, after which the old owner has no say', () => {
    const { db, zoe, create, orgRow } = league();
    create();
    expect(handOverOrg(db, zoe, 'benelux-siege-league', '700000000000000099', NOW)).toEqual({
      ok: false,
      error: 'unknown_player',
    });
    expect(handOverOrg(db, zoe, 'benelux-siege-league', ZOE.discordUserId, NOW)).toEqual({
      ok: false,
      error: 'same_owner',
    });
    ensurePlayer(db, { orgId: 1, discordUserId: '700000000000000032', displayName: 'Bas' }, 1);
    expect(handOverOrg(db, zoe, 'benelux-siege-league', ' 700000000000000032 ', NOW)).toEqual({
      ok: true,
      owner: 'Bas',
    });
    expect(orgRow('benelux-siege-league')?.ownerDiscordUserId).toBe('700000000000000032');
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      action: 'org.owner',
      beforeJson: { owner: ZOE.discordUserId },
      afterJson: { owner: '700000000000000032' },
    });
    expect(orgAdmin(db, zoe, 'benelux-siege-league')).toEqual({ ok: false, error: 'not_owner' });
  });
});

describe('the organisation’s Discord invitation', () => {
  it('must lead somewhere and never expire; none is fine', async () => {
    const gateway = fakeGateway();
    gateway.invites.set('https://discord.gg/bsl', { guildId: '1', expiresAt: null });
    gateway.invites.set('https://discord.gg/week', { guildId: '1', expiresAt: NOW });
    expect(await checkOrgInvite(gateway, '')).toBeNull();
    expect(await checkOrgInvite(gateway, 'https://discord.gg/bsl')).toBeNull();
    expect(await checkOrgInvite(gateway, 'https://discord.gg/week')).toBe('expires');
    expect(await checkOrgInvite(gateway, 'https://discord.gg/gone')).toBe('invalid');
    expect(await checkOrgInvite(gateway, 'https://example.com/x')).toBe('invalid');
  });
});

describe('the organisation’s logo', () => {
  it('is kept square in the asset store, for its owner only', async () => {
    const { db, zoe, create, orgRow } = league();
    create();
    const assets = fakeAssetStore();
    const png = pngForTests({ width: 256, height: 256, colorType: 6 });
    expect(await setOrgLogo(db, assets, zoe, 'benelux-siege-league', png, NOW)).toEqual({
      ok: true,
    });
    const key = orgRow('benelux-siege-league')?.logoKey ?? '';
    expect(key).toMatch(/^logos\/org-benelux-siege-league-[0-9a-f]{8}\.png$/);
    expect(Object.keys(assets.files)).toEqual([key]);
    expect(await setOrgLogo(db, assets, zoe, 'mlb-group', png, NOW)).toEqual({
      ok: false,
      error: 'not_owner',
    });
    expect(
      await setOrgLogo(db, assets, zoe, 'benelux-siege-league', new Uint8Array([1, 2, 3]), NOW),
    ).toMatchObject({ ok: false });
  });
});
