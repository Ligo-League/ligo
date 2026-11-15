import { createHash } from 'node:crypto';
import { checkRosterDetails, slugify, type FieldErrors, type RosterDetailsError } from '@ligo/core';
import { schema, type Db, type RegistrationPayload } from '@ligo/db';
import { squareLogo } from '@ligo/render';
import { TITLES, type Title } from '@ligo/titles';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { LOGO_SIZE, type AssetStore } from '../assets/store.ts';
import { checkLogo, type LogoError } from './logo.ts';

// Clubs and rosters before any competition (M-33, maintainer, 15 November 2026): anyone logged
// in creates a club and its first roster, the creator its owner; the club's officials add
// rosters. Each roster then registers for a league. Names and tags are taken at creation.

const { auditLog, club, clubStaff, competition, org, request, team } = schema;

type Reader = Pick<Db, 'select'>;

const SOCIALS_MAX = 5;
const LEGAL_STATUSES = ['association', 'association_1901', 'company', 'amateur'] as const;

/** A new club's details, as typed: everything is checked here. */
export interface ClubForm {
  name: string;
  city: string;
  legalStatus: string;
  /** One link per line. */
  socials: string;
  discordUrl: string;
}

/** A roster's details, as typed. */
export interface RosterForm {
  name: string;
  tag: string;
  colors: string[];
  canStream: boolean;
}

export type ClubFieldError =
  | 'invalid_club_name'
  | 'club_taken'
  | 'invalid_city'
  | 'invalid_legal_status'
  | 'invalid_link'
  | 'invalid_discord_url';

export type RosterFieldError =
  | RosterDetailsError
  | LogoError
  | 'logo_not_stored'
  | 'name_taken'
  | 'tag_taken'
  | 'invalid_org'
  | 'invalid_title'
  | 'not_your_club';

export type NewClub = Extract<RegistrationPayload['club'], { kind: 'new' }>;

export const slugOf = (name: string) => {
  const slug = slugify(name);
  return slug.ok ? slug.slug : null;
};

/** An http(s) address, or null for anything else (javascript:, data:, a typo). */
function webAddress(text: string, protocols: readonly string[]): URL | null {
  try {
    const url = new URL(text);
    return protocols.includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

/** A new club's details, checked; each problem is reported with its field. */
export function checkNewClub(
  input: ClubForm,
  fail: (field: string, error: ClubFieldError) => void,
): NewClub {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 40 || slugOf(name) === null) {
    fail('club.name', 'invalid_club_name');
  }
  const city = input.city.trim();
  if (city.length > 60) fail('club.city', 'invalid_city');
  const legalStatus = LEGAL_STATUSES.find((status) => status === input.legalStatus) ?? null;
  if (input.legalStatus !== '' && legalStatus === null) {
    fail('club.legalStatus', 'invalid_legal_status');
  }
  const lines = input.socials
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const socials = lines.flatMap((line) => {
    const url = webAddress(line, ['https:', 'http:']);
    return url ? [{ label: url.hostname.replace(/^www\./, ''), url: url.href }] : [];
  });
  if (socials.length !== lines.length || socials.length > SOCIALS_MAX) {
    fail('club.socials', 'invalid_link');
  }
  const discordText = input.discordUrl.trim();
  const discord = discordText === '' ? null : webAddress(discordText, ['https:']);
  if (discordText !== '' && discord === null) fail('club.discordUrl', 'invalid_discord_url');
  return {
    kind: 'new',
    name,
    city: city === '' ? null : city,
    legalStatus,
    socials,
    discordUrl: discord?.href ?? null,
  };
}

/** The names, tags and new clubs of the registrations still waiting, which nobody may reuse. */
export function waitingRegistrations(db: Reader): RegistrationPayload[] {
  return db
    .select({ payload: request.payloadJson })
    .from(request)
    .where(and(eq(request.kind, 'registration'), eq(request.status, 'pending')))
    .all()
    .flatMap(({ payload }) => ('roster' in payload ? [payload] : []));
}

/** Whether a club of that name exists in the group, or waits in a registration. */
export function clubNameTaken(db: Reader, orgId: number, slug: string): boolean {
  const stored = db
    .select({ id: club.id })
    .from(club)
    .where(and(eq(club.orgId, orgId), eq(club.slug, slug)))
    .get();
  return (
    stored !== undefined ||
    waitingRegistrations(db).some(
      (other) => other.club.kind === 'new' && slugOf(other.club.name) === slug,
    )
  );
}

/** Whether a roster of that name exists in the group, or waits in a registration. */
export function rosterNameTaken(db: Reader, orgId: number, slug: string): boolean {
  const stored = db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.orgId, orgId), eq(team.slug, slug)))
    .get();
  return (
    stored !== undefined ||
    waitingRegistrations(db).some((other) => slugOf(other.roster.name) === slug)
  );
}

/** Whether a roster of that game has the tag in the group, or one waits in a registration. */
export function rosterTagTaken(db: Reader, orgId: number, title: Title, tag: string): boolean {
  const stored = db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.orgId, orgId), eq(team.title, title), eq(team.tag, tag)))
    .get();
  return stored !== undefined || waitingRegistrations(db).some((other) => other.roster.tag === tag);
}

/** The groups a club may be created in, each with the games its competitions are played in. */
export function creationChoices(db: Reader): { id: number; name: string; titles: Title[] }[] {
  const groups = db.select({ id: org.id, name: org.name }).from(org).orderBy(asc(org.id)).all();
  return groups.map((group) => {
    const played = new Set(
      db
        .select({ title: competition.title })
        .from(competition)
        .where(eq(competition.orgId, group.id))
        .all()
        .map((row) => row.title),
    );
    return { ...group, titles: TITLES.filter((title) => played.has(title)) };
  });
}

/** The clubs the player runs now, as owner or club manager, in the group. */
export function clubsRunBy(db: Reader, playerId: number, orgId: number) {
  const rows = db
    .select({ id: club.id, name: club.name, slug: club.slug })
    .from(clubStaff)
    .innerJoin(club, eq(clubStaff.clubId, club.id))
    .where(and(eq(clubStaff.playerId, playerId), isNull(clubStaff.until), eq(club.orgId, orgId)))
    .orderBy(club.name)
    .all();
  // Owner and manager rows of the same club come once.
  return rows.filter((row, index) => rows.findIndex((other) => other.id === row.id) === index);
}

interface CheckedRoster {
  name: string;
  tag: string;
  colors: string[];
  slug: string;
  logo: Uint8Array | null;
}

/** A roster's details and logo, checked against the group's names and tags of that game. */
function checkRoster(
  db: Reader,
  orgId: number,
  title: Title,
  input: RosterForm,
  logoFile: Uint8Array | null,
  fail: (field: string, error: RosterFieldError) => void,
): CheckedRoster | null {
  const details = checkRosterDetails({
    rosterName: input.name,
    tag: input.tag,
    colors: input.colors,
  });
  if (!details.ok) for (const entry of details.errors) fail(entry.field, entry.error);
  const slug = slugOf(input.name.trim());
  const nameChecked = !details.ok && details.errors.some((entry) => entry.field === 'rosterName');
  if (!nameChecked && slug !== null && rosterNameTaken(db, orgId, slug)) {
    fail('rosterName', 'name_taken');
  }
  const tagChecked = !details.ok && details.errors.some((entry) => entry.field === 'tag');
  const tag = input.tag.trim().toUpperCase();
  if (!tagChecked && rosterTagTaken(db, orgId, title, tag)) fail('tag', 'tag_taken');
  // Kept as the 128 px square images and pages use (design doc section 11); a file that passes
  // the checks but cannot be decoded is refused here, while the creator can fix it.
  let logo: Uint8Array | null = null;
  if (logoFile !== null) {
    const checked = checkLogo(logoFile);
    if (!checked.ok) fail('logo', checked.error);
    else {
      try {
        logo = squareLogo(logoFile, LOGO_SIZE);
      } catch {
        fail('logo', 'invalid_logo');
      }
    }
  }
  if (!details.ok || slug === null) return null;
  return {
    name: details.value.rosterName,
    tag: details.value.tag,
    colors: details.value.colors,
    slug,
    logo,
  };
}

/** Keeps the logo where images and pages read logos: by the roster's slug and the content. */
async function storeLogo(
  assets: Pick<AssetStore, 'write'>,
  teamSlug: string,
  logo: Uint8Array | null,
): Promise<{ ok: true; key: string | null } | { ok: false }> {
  if (logo === null) return { ok: true, key: null };
  const hash = createHash('sha256').update(logo).digest('hex').slice(0, 8);
  const key = `logos/${teamSlug}-${hash}.png`;
  try {
    await assets.write(key, logo);
    return { ok: true, key };
  } catch {
    return { ok: false };
  }
}

export type CreateClubReply =
  | { ok: true; clubSlug: string; teamSlug: string }
  | { ok: false; errors: FieldErrors<ClubFieldError | RosterFieldError> };

/**
 * Anyone logged in creates a club and its first roster, in no competition, and owns the club.
 * The first roster gives the club its colours and logo, and inherits them. Every problem comes
 * back with its field, and nothing is stored then.
 */
export async function createClub(
  db: Db,
  assets: Pick<AssetStore, 'write'>,
  playerId: number,
  input: {
    orgId: number;
    title: string;
    club: ClubForm;
    roster: RosterForm;
    logo: Uint8Array | null;
  },
  now: number,
): Promise<CreateClubReply> {
  const errors: FieldErrors<ClubFieldError | RosterFieldError> = [];
  const fail = (field: string, error: ClubFieldError | RosterFieldError) =>
    errors.push({ field, error });
  const group = creationChoices(db).find((entry) => entry.id === input.orgId);
  if (!group) fail('org', 'invalid_org');
  const title = group?.titles.find((entry) => entry === input.title);
  if (group && !title) fail('title', 'invalid_title');
  const clubDetails = checkNewClub(input.club, fail);
  const clubSlug = slugOf(clubDetails.name);
  // `/clubs/new` is the creation page: no club takes its address.
  if (clubSlug === 'new') fail('club.name', 'club_taken');
  else if (clubSlug !== null && clubNameTaken(db, input.orgId, clubSlug)) {
    fail('club.name', 'club_taken');
  }
  const roster = title ? checkRoster(db, input.orgId, title, input.roster, input.logo, fail) : null;
  if (errors.length > 0 || !title || !roster || clubSlug === null) return { ok: false, errors };

  const stored = await storeLogo(assets, roster.slug, roster.logo);
  if (!stored.ok) return { ok: false, errors: [{ field: 'logo', error: 'logo_not_stored' }] };
  const logoKey = stored.key;

  return db.transaction((tx): CreateClubReply => {
    // The logo took a moment: another creation may have taken a name or the tag.
    const raced: FieldErrors<ClubFieldError | RosterFieldError> = [];
    if (clubNameTaken(tx, input.orgId, clubSlug))
      raced.push({ field: 'club.name', error: 'club_taken' });
    if (rosterNameTaken(tx, input.orgId, roster.slug)) {
      raced.push({ field: 'rosterName', error: 'name_taken' });
    }
    if (rosterTagTaken(tx, input.orgId, title, roster.tag)) {
      raced.push({ field: 'tag', error: 'tag_taken' });
    }
    if (raced.length > 0) return { ok: false, errors: raced };
    const clubId = tx
      .insert(club)
      .values({
        orgId: input.orgId,
        name: clubDetails.name,
        slug: clubSlug,
        city: clubDetails.city,
        legalStatus: clubDetails.legalStatus,
        colorsJson: roster.colors,
        logoKey,
        socialsJson: clubDetails.socials,
        discordUrl: clubDetails.discordUrl,
      })
      .returning({ id: club.id })
      .get().id;
    tx.insert(clubStaff).values({ clubId, playerId, role: 'owner', since: now }).run();
    const teamId = tx
      .insert(team)
      .values({
        orgId: input.orgId,
        clubId,
        title,
        name: roster.name,
        tag: roster.tag,
        slug: roster.slug,
        colorsJson: null,
        logoKey: null,
        canStream: input.roster.canStream,
      })
      .returning({ id: team.id })
      .get().id;
    tx.insert(auditLog)
      .values({
        actorPlayerId: playerId,
        actorKind: 'user',
        action: 'club.create',
        entity: 'club',
        entityId: String(clubId),
        afterJson: { club: clubDetails.name, teamId, roster: roster.name, tag: roster.tag, title },
        at: now,
      })
      .run();
    return { ok: true, clubSlug, teamSlug: roster.slug };
  });
}

export type AddRosterReply =
  | { ok: true; teamSlug: string }
  | { ok: false; error: 'not_found' | 'not_your_club' }
  | { ok: false; errors: FieldErrors<RosterFieldError> };

/** The club's owner or one of its managers adds a roster, with its own colours and logo. */
export async function addRoster(
  db: Db,
  assets: Pick<AssetStore, 'write'>,
  playerId: number,
  clubSlug: string,
  input: { title: string; roster: RosterForm; logo: Uint8Array | null },
  now: number,
): Promise<AddRosterReply> {
  const found = db.select().from(club).where(eq(club.slug, clubSlug)).get();
  if (!found) return { ok: false, error: 'not_found' };
  if (!clubsRunBy(db, playerId, found.orgId).some((entry) => entry.id === found.id)) {
    return { ok: false, error: 'not_your_club' };
  }
  const errors: FieldErrors<RosterFieldError> = [];
  const fail = (field: string, error: RosterFieldError) => errors.push({ field, error });
  const title = creationChoices(db)
    .find((entry) => entry.id === found.orgId)
    ?.titles.find((entry) => entry === input.title);
  if (!title) fail('title', 'invalid_title');
  const roster = title ? checkRoster(db, found.orgId, title, input.roster, input.logo, fail) : null;
  if (errors.length > 0 || !title || !roster) return { ok: false, errors };

  const stored = await storeLogo(assets, roster.slug, roster.logo);
  if (!stored.ok) return { ok: false, errors: [{ field: 'logo', error: 'logo_not_stored' }] };
  const logoKey = stored.key;

  return db.transaction((tx): AddRosterReply => {
    if (!clubsRunBy(tx, playerId, found.orgId).some((entry) => entry.id === found.id)) {
      return { ok: false, error: 'not_your_club' };
    }
    if (rosterNameTaken(tx, found.orgId, roster.slug)) {
      return { ok: false, errors: [{ field: 'rosterName', error: 'name_taken' }] };
    }
    if (rosterTagTaken(tx, found.orgId, title, roster.tag)) {
      return { ok: false, errors: [{ field: 'tag', error: 'tag_taken' }] };
    }
    const teamId = tx
      .insert(team)
      .values({
        orgId: found.orgId,
        clubId: found.id,
        title,
        name: roster.name,
        tag: roster.tag,
        slug: roster.slug,
        colorsJson: roster.colors,
        logoKey,
        canStream: input.roster.canStream,
      })
      .returning({ id: team.id })
      .get().id;
    tx.insert(auditLog)
      .values({
        actorPlayerId: playerId,
        actorKind: 'user',
        action: 'club.roster.add',
        entity: 'club',
        entityId: String(found.id),
        afterJson: { teamId, roster: roster.name, tag: roster.tag, title },
        at: now,
      })
      .run();
    return { ok: true, teamSlug: roster.slug };
  });
}
