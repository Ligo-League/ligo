import { createHash } from 'node:crypto';
import { slugify } from '@ligo/core';
import { orgSettingsSchema, schema, type Db } from '@ligo/db';
import { squareLogo } from '@ligo/render';
import { asc, eq } from 'drizzle-orm';
import { LOGO_SIZE, type AssetStore } from '../assets/store.ts';
import type { DiscordGateway } from '../discord/gateway.ts';
import { isDiscordInvite } from './league-discord.ts';
import { checkLogo, type LogoError } from './logo.ts';
import { RESERVED_ORG_SLUGS } from './paths.ts';

// Organisations in the admin panel (design doc section 7; M-20, maintainer, 19 November 2026).
// Whoever may manage a Discord server where the bot is installed may create one; its creator
// owns it. The owner is a Discord account kept in Ligo, not read from Discord, since an
// organisation's competitions sit on several servers. The owner edits the organisation and may
// hand it over to someone Ligo knows. Every change writes `audit_log`.

const { auditLog, competition, org, player } = schema;
type Reader = Pick<Db, 'select'>;

/** Who acts: the website's user, by their Discord account. */
export interface OrgUser {
  playerId: number;
  discordUserId: string | null;
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const LOCALES = ['fr', 'en'] as const;
const NAME_MAX = 60;
const DESCRIPTION_MAX = 500;

export interface OrgValues {
  name: string;
  /** Empty: made from the name. */
  slug: string;
  locale: string;
  description: string;
}

export type OrgFieldError = 'length' | 'invalid' | 'taken' | 'reserved';
export type OrgErrors = Partial<
  Record<'name' | 'slug' | 'locale' | 'description', OrgFieldError>
> & {
  form?: 'no_server' | 'no_account';
};

const isLocale = (value: string): value is (typeof LOCALES)[number] =>
  (LOCALES as readonly string[]).includes(value);

function checkName(name: string): OrgFieldError | null {
  const trimmed = name.trim();
  return trimmed.length < 2 || trimmed.length > NAME_MAX ? 'length' : null;
}

/** Creates an organisation owned by its creator. */
export function createOrg(
  db: Db,
  user: OrgUser,
  values: OrgValues,
  discord: { managesAServer: boolean },
  now: number,
): { ok: true; slug: string } | { ok: false; errors: OrgErrors } {
  if (user.discordUserId === null) return { ok: false, errors: { form: 'no_account' } };
  if (!discord.managesAServer) return { ok: false, errors: { form: 'no_server' } };
  const errors: OrgErrors = {};
  const nameError = checkName(values.name);
  if (nameError) errors.name = nameError;
  if (!isLocale(values.locale)) errors.locale = 'invalid';
  if (values.description.trim().length > DESCRIPTION_MAX) errors.description = 'length';
  const typed = values.slug.trim();
  const made = slugify(values.name);
  const slug = typed !== '' ? typed : made.ok ? made.slug.slice(0, 40).replace(/-+$/, '') : '';
  if (!SLUG.test(slug)) errors.slug = 'invalid';
  else if (RESERVED_ORG_SLUGS.includes(slug)) errors.slug = 'reserved';
  else if (db.select({ id: org.id }).from(org).where(eq(org.slug, slug)).get()) {
    errors.slug = 'taken';
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const name = values.name.trim();
  const description = values.description.trim();
  db.transaction((tx) => {
    const created = tx
      .insert(org)
      .values({
        name,
        slug,
        locale: isLocale(values.locale) ? values.locale : 'fr',
        settingsJson: orgSettingsSchema.parse({}),
        ownerDiscordUserId: user.discordUserId,
        description: description === '' ? null : description,
      })
      .returning()
      .get();
    tx.insert(auditLog)
      .values({
        actorPlayerId: user.playerId,
        actorKind: 'user',
        action: 'org.create',
        entity: 'org',
        entityId: String(created.id),
        beforeJson: null,
        afterJson: { name, slug, locale: created.locale },
        at: now,
      })
      .run();
  });
  return { ok: true, slug };
}

const ownerOf = (row: { ownerDiscordUserId: string | null }, user: OrgUser) =>
  user.discordUserId !== null && row.ownerDiscordUserId === user.discordUserId;

/** The organisations the user owns, by name. */
export function ownedOrgs(db: Reader, user: OrgUser) {
  if (user.discordUserId === null) return [];
  return db
    .select({ name: org.name, slug: org.slug })
    .from(org)
    .where(eq(org.ownerDiscordUserId, user.discordUserId))
    .orderBy(asc(org.name))
    .all();
}

export type OrgAdminView =
  | {
      ok: true;
      org: {
        id: number;
        name: string;
        slug: string;
        locale: 'fr' | 'en';
        description: string | null;
        inviteUrl: string | null;
        logoKey: string | null;
      };
      owner: { discordUserId: string; name: string | null };
      competitions: { name: string; slug: string; title: string }[];
    }
  | { ok: false; error: 'not_found' | 'not_owner' };

/** An organisation as its admin page shows it, for its owner only. */
export function orgAdmin(db: Reader, user: OrgUser, slug: string): OrgAdminView {
  const row = db.select().from(org).where(eq(org.slug, slug)).get();
  if (!row) return { ok: false, error: 'not_found' };
  if (!ownerOf(row, user) || row.ownerDiscordUserId === null) {
    return { ok: false, error: 'not_owner' };
  }
  const ownerName =
    db
      .select({ name: player.displayName })
      .from(player)
      .where(eq(player.discordUserId, row.ownerDiscordUserId))
      .get()?.name ?? null;
  return {
    ok: true,
    org: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      locale: row.locale,
      description: row.description,
      inviteUrl: row.inviteUrl,
      logoKey: row.logoKey,
    },
    owner: { discordUserId: row.ownerDiscordUserId, name: ownerName },
    competitions: db
      .select({ name: competition.name, slug: competition.slug, title: competition.title })
      .from(competition)
      .where(eq(competition.orgId, row.id))
      .orderBy(asc(competition.name))
      .all(),
  };
}

export interface OrgChange {
  name: string;
  locale: string;
  description: string;
  /** Empty: none. Checked with Discord by `checkOrgInvite` before it is saved. */
  inviteUrl: string;
}

export type UpdateOrgReply =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'not_owner' }
  | { ok: false; error: 'invalid'; errors: OrgErrors & { inviteUrl?: 'invalid' } };

/** The owner changes the organisation's name, language, description and invitation. */
export function updateOrg(
  db: Db,
  user: OrgUser,
  slug: string,
  change: OrgChange,
  now: number,
): UpdateOrgReply {
  const row = db.select().from(org).where(eq(org.slug, slug)).get();
  if (!row) return { ok: false, error: 'not_found' };
  if (!ownerOf(row, user)) return { ok: false, error: 'not_owner' };
  const errors: OrgErrors & { inviteUrl?: 'invalid' } = {};
  const nameError = checkName(change.name);
  if (nameError) errors.name = nameError;
  if (!isLocale(change.locale)) errors.locale = 'invalid';
  const description = change.description.trim();
  if (description.length > DESCRIPTION_MAX) errors.description = 'length';
  const inviteUrl = change.inviteUrl.trim();
  if (inviteUrl !== '' && !isDiscordInvite(inviteUrl)) errors.inviteUrl = 'invalid';
  if (Object.keys(errors).length > 0 || !isLocale(change.locale)) {
    return { ok: false, error: 'invalid', errors };
  }
  const after = {
    name: change.name.trim(),
    locale: change.locale,
    description: description === '' ? null : description,
    inviteUrl: inviteUrl === '' ? null : inviteUrl,
  };
  db.transaction((tx) => {
    tx.update(org).set(after).where(eq(org.id, row.id)).run();
    tx.insert(auditLog)
      .values({
        actorPlayerId: user.playerId,
        actorKind: 'user',
        action: 'org.update',
        entity: 'org',
        entityId: String(row.id),
        beforeJson: {
          name: row.name,
          locale: row.locale,
          description: row.description,
          inviteUrl: row.inviteUrl,
        },
        afterJson: after,
        at: now,
      })
      .run();
  });
  return { ok: true };
}

export type OrgInviteProblem = 'invalid' | 'expires' | 'discord_unavailable';

/**
 * Whether Discord knows the invitation and it never expires: people follow it for a long time.
 * Null when it is fine or empty.
 */
export async function checkOrgInvite(
  gateway: Pick<DiscordGateway, 'resolveInvite'>,
  inviteUrl: string,
): Promise<OrgInviteProblem | null> {
  const url = inviteUrl.trim();
  if (url === '') return null;
  if (!isDiscordInvite(url)) return 'invalid';
  try {
    const invite = await gateway.resolveInvite(url);
    if (!invite) return 'invalid';
    return invite.expiresAt === null ? null : 'expires';
  } catch {
    return 'discord_unavailable';
  }
}

export type HandOverReply =
  | { ok: true; owner: string }
  | { ok: false; error: 'not_found' | 'not_owner' | 'unknown_player' | 'same_owner' };

/**
 * The owner hands the organisation to someone Ligo knows (they logged in once), by their Discord
 * user ID. The old owner keeps no say.
 */
export function handOverOrg(
  db: Db,
  user: OrgUser,
  slug: string,
  newOwnerDiscordId: string,
  now: number,
): HandOverReply {
  const row = db.select().from(org).where(eq(org.slug, slug)).get();
  if (!row) return { ok: false, error: 'not_found' };
  if (!ownerOf(row, user)) return { ok: false, error: 'not_owner' };
  const target = newOwnerDiscordId.trim();
  if (target === row.ownerDiscordUserId) return { ok: false, error: 'same_owner' };
  const next = /^\d{17,20}$/.test(target)
    ? db
        .select({ name: player.displayName })
        .from(player)
        .where(eq(player.discordUserId, target))
        .get()
    : undefined;
  if (!next) return { ok: false, error: 'unknown_player' };
  db.transaction((tx) => {
    tx.update(org).set({ ownerDiscordUserId: target }).where(eq(org.id, row.id)).run();
    tx.insert(auditLog)
      .values({
        actorPlayerId: user.playerId,
        actorKind: 'user',
        action: 'org.owner',
        entity: 'org',
        entityId: String(row.id),
        beforeJson: { owner: row.ownerDiscordUserId },
        afterJson: { owner: target },
        at: now,
      })
      .run();
  });
  return { ok: true, owner: next.name };
}

export type OrgLogoReply =
  { ok: true } | { ok: false; error: 'not_found' | 'not_owner' | LogoError | 'logo_not_stored' };

/**
 * The owner gives the organisation a logo: the same checks as a roster's, kept as the 128 px
 * square images and pages use, in the asset store.
 */
export async function setOrgLogo(
  db: Db,
  assets: Pick<AssetStore, 'write'>,
  user: OrgUser,
  slug: string,
  file: Uint8Array,
  now: number,
): Promise<OrgLogoReply> {
  const row = db.select().from(org).where(eq(org.slug, slug)).get();
  if (!row) return { ok: false, error: 'not_found' };
  if (!ownerOf(row, user)) return { ok: false, error: 'not_owner' };
  const checked = checkLogo(file);
  if (!checked.ok) return { ok: false, error: checked.error };
  let logo: Uint8Array;
  try {
    logo = squareLogo(file, LOGO_SIZE);
  } catch {
    return { ok: false, error: 'invalid_logo' };
  }
  const hash = createHash('sha256').update(logo).digest('hex').slice(0, 8);
  // Organisation slugs are at most 40 characters: the key fits the asset store's names.
  const key = `logos/org-${row.slug}-${hash}.png`;
  try {
    await assets.write(key, logo);
  } catch {
    return { ok: false, error: 'logo_not_stored' };
  }
  db.transaction((tx) => {
    tx.update(org).set({ logoKey: key }).where(eq(org.id, row.id)).run();
    tx.insert(auditLog)
      .values({
        actorPlayerId: user.playerId,
        actorKind: 'user',
        action: 'org.logo',
        entity: 'org',
        entityId: String(row.id),
        beforeJson: { logoKey: row.logoKey },
        afterJson: { logoKey: key },
        at: now,
      })
      .run();
  });
  return { ok: true };
}
