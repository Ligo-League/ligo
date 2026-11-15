import { randomBytes } from 'node:crypto';
import {
  checkRosterDetails,
  lineupLocked,
  lineupStatus,
  playerGaps,
  slugify,
  type FieldErrors,
  type LineupGap,
  type PlayerProfile,
  type RegistrationSettings,
  type RosterDetailsError,
  zonedDate,
} from '@ligo/core';
import { schema, type Db, type RegistrationPayload } from '@ligo/db';
import { and, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import type { EvidenceStore } from '../assets/evidence-store.ts';
import { checkLogo, logoKeyOf, type LogoError } from './logo.ts';

// Registering a roster (design doc section 7, "Registration"; maintainer, 14 November 2026). A
// logged-in member files the club and roster details, with the rulebook in force accepted; the
// registration is a `registration` request, which staff approve in phase 3d-4b. Players join from
// the invitation with their own account (phase 3d-4a-2): nobody declares another person's data.

const {
  auditLog,
  club,
  clubStaff,
  competition,
  gameAccount,
  player,
  registrationInvite,
  registrationPlayer,
  request,
  rulesVersion,
  season,
  team,
} = schema;

const DAY_MS = 86_400_000;
const SOCIALS_MAX = 5;
const LEGAL_STATUSES = ['association', 'association_1901', 'company', 'amateur'] as const;

type Reader = Pick<Db, 'select'>;

/** The competition, its season taking registrations, and the rulebook in force. */
function openSeason(db: Reader, competitionSlug: string, now: number) {
  const found = db.select().from(competition).where(eq(competition.slug, competitionSlug)).get();
  if (!found) return { ok: false as const, error: 'not_found' as const };
  const open = db
    .select()
    .from(season)
    .where(and(eq(season.competitionId, found.id), eq(season.status, 'registration')))
    .orderBy(desc(season.startsOn), desc(season.id))
    .get();
  if (!open) return { ok: false as const, error: 'closed' as const };
  const rules = db
    .select({ id: rulesVersion.id, version: rulesVersion.version })
    .from(rulesVersion)
    .where(and(eq(rulesVersion.competitionId, found.id), lte(rulesVersion.effectiveFrom, now)))
    .orderBy(desc(rulesVersion.effectiveFrom), desc(rulesVersion.id))
    .get();
  if (!rules) return { ok: false as const, error: 'no_rules' as const };
  return { ok: true as const, competition: found, season: open, rules };
}

/** The clubs the player runs now, as owner or manager, in the competition's organisation. */
function clubsRunBy(db: Reader, playerId: number, orgId: number) {
  const rows = db
    .select({ id: club.id, name: club.name })
    .from(clubStaff)
    .innerJoin(club, eq(clubStaff.clubId, club.id))
    .where(and(eq(clubStaff.playerId, playerId), isNull(clubStaff.until), eq(club.orgId, orgId)))
    .orderBy(club.name)
    .all();
  // Owner and manager rows of the same club come once.
  return rows.filter((row, index) => rows.findIndex((other) => other.id === row.id) === index);
}

export type RegistrationClosed = { ok: false; error: 'not_found' | 'closed' | 'no_rules' };

export type RegistrationForm =
  | {
      ok: true;
      competition: { id: number; name: string; slug: string };
      season: { id: number; name: string };
      rules: { id: number; version: string };
      /** Clubs the member runs: a new roster may join one of them. */
      clubs: { id: number; name: string }[];
      settings: RegistrationSettings;
    }
  | RegistrationClosed;

export function registrationForm(
  db: Reader,
  competitionSlug: string,
  playerId: number,
  now: number,
): RegistrationForm {
  const open = openSeason(db, competitionSlug, now);
  if (!open.ok) return open;
  return {
    ok: true,
    competition: {
      id: open.competition.id,
      name: open.competition.name,
      slug: open.competition.slug,
    },
    season: { id: open.season.id, name: open.season.name },
    rules: open.rules,
    clubs: clubsRunBy(db, playerId, open.competition.orgId),
    settings: open.competition.rulesetJson.registration,
  };
}

/** What the form sends, as typed: everything is checked here. */
export interface RegistrationRequest {
  club:
    | {
        kind: 'new';
        name: string;
        city: string;
        legalStatus: string;
        /** One link per line. */
        socials: string;
        discordUrl: string;
      }
    | { kind: 'existing'; clubId: number };
  roster: { name: string; tag: string; colors: string[]; canStream: boolean };
  logo: Uint8Array | null;
  /** The version the form showed: a newer one in force means asking again. */
  rulesVersionId: number;
  rulesAccepted: boolean;
}

export type RegistrationFieldError =
  | RosterDetailsError
  | LogoError
  | 'logo_not_stored'
  | 'invalid_club_name'
  | 'club_taken'
  | 'invalid_city'
  | 'invalid_legal_status'
  | 'invalid_link'
  | 'invalid_discord_url'
  | 'not_your_club'
  | 'name_taken'
  | 'tag_taken'
  | 'rules_not_accepted'
  | 'rules_changed';

export type FileRegistrationReply =
  | { ok: true; id: number }
  | RegistrationClosed
  | { ok: false; errors: FieldErrors<RegistrationFieldError> };

const slugOf = (name: string) => {
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

type NewClub = Extract<RegistrationPayload['club'], { kind: 'new' }>;

function checkNewClub(
  input: Extract<RegistrationRequest['club'], { kind: 'new' }>,
  fail: (field: string, error: RegistrationFieldError) => void,
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
function waitingRegistrations(db: Reader): RegistrationPayload[] {
  return db
    .select({ payload: request.payloadJson })
    .from(request)
    .where(and(eq(request.kind, 'registration'), eq(request.status, 'pending')))
    .all()
    .flatMap(({ payload }) => ('roster' in payload ? [payload] : []));
}

/**
 * A member registers a roster: checked, its logo kept, then filed with an invitation for the
 * players. Every problem comes back with its field, and nothing is stored then.
 */
export async function fileRegistration(
  db: Db,
  store: EvidenceStore,
  playerId: number,
  competitionSlug: string,
  input: RegistrationRequest,
  now: number,
): Promise<FileRegistrationReply> {
  const open = openSeason(db, competitionSlug, now);
  if (!open.ok) return open;
  const orgId = open.competition.orgId;

  const errors: FieldErrors<RegistrationFieldError> = [];
  const fail = (field: string, error: RegistrationFieldError) => errors.push({ field, error });
  const waiting = waitingRegistrations(db);

  let clubPayload: RegistrationPayload['club'];
  if (input.club.kind === 'new') {
    const created = checkNewClub(input.club, fail);
    const slug = slugOf(created.name);
    const taken =
      slug !== null &&
      (db
        .select({ id: club.id })
        .from(club)
        .where(and(eq(club.orgId, orgId), eq(club.slug, slug)))
        .get() !== undefined ||
        waiting.some((other) => other.club.kind === 'new' && slugOf(other.club.name) === slug));
    if (taken) fail('club.name', 'club_taken');
    clubPayload = created;
  } else {
    const { clubId } = input.club;
    if (!clubsRunBy(db, playerId, orgId).some((entry) => entry.id === clubId)) {
      fail('club.clubId', 'not_your_club');
    }
    clubPayload = { kind: 'existing', clubId };
  }

  const details = checkRosterDetails({
    rosterName: input.roster.name,
    tag: input.roster.tag,
    colors: input.roster.colors,
  });
  const detailErrors = details.ok ? [] : details.errors;
  errors.push(...detailErrors);
  const rosterName = input.roster.name.trim();
  const rosterSlug = slugOf(rosterName);
  const tag = input.roster.tag.trim().toUpperCase();
  if (!detailErrors.some((entry) => entry.field === 'rosterName') && rosterSlug !== null) {
    const taken =
      db
        .select({ id: team.id })
        .from(team)
        .where(and(eq(team.orgId, orgId), eq(team.slug, rosterSlug)))
        .get() !== undefined || waiting.some((other) => slugOf(other.roster.name) === rosterSlug);
    if (taken) fail('rosterName', 'name_taken');
  }
  if (!detailErrors.some((entry) => entry.field === 'tag')) {
    const taken =
      db
        .select({ id: team.id })
        .from(team)
        .where(
          and(eq(team.orgId, orgId), eq(team.title, open.competition.title), eq(team.tag, tag)),
        )
        .get() !== undefined || waiting.some((other) => other.roster.tag === tag);
    if (taken) fail('tag', 'tag_taken');
  }

  if (input.logo !== null) {
    const logo = checkLogo(input.logo);
    if (!logo.ok) fail('logo', logo.error);
  }
  if (!input.rulesAccepted) fail('rules', 'rules_not_accepted');
  else if (input.rulesVersionId !== open.rules.id) fail('rules', 'rules_changed');
  if (errors.length > 0 || !details.ok) return { ok: false, errors };

  let logoKey: string | null = null;
  if (input.logo !== null) {
    logoKey = logoKeyOf(input.logo);
    try {
      await store.put(logoKey, input.logo);
    } catch {
      return { ok: false, errors: [{ field: 'logo', error: 'logo_not_stored' }] };
    }
  }

  const payload: RegistrationPayload = {
    club: clubPayload,
    roster: {
      name: details.value.rosterName,
      tag: details.value.tag,
      colors: details.value.colors,
      logoKey,
      canStream: input.roster.canStream,
    },
    rules: { versionId: open.rules.id, acceptedAt: now },
  };
  return db.transaction((tx): FileRegistrationReply => {
    // The logo upload took a moment: another registration may have taken the name or the tag.
    const again = waitingRegistrations(tx);
    if (again.some((other) => other.roster.tag === payload.roster.tag)) {
      return { ok: false, errors: [{ field: 'tag', error: 'tag_taken' }] };
    }
    const stored = tx
      .insert(request)
      .values({
        competitionId: open.competition.id,
        seasonId: open.season.id,
        teamId: null,
        kind: 'registration',
        payloadJson: payload,
        approval: 'staff',
        requestedBy: playerId,
        requestedAt: now,
      })
      .returning({ id: request.id })
      .get();
    tx.insert(registrationInvite)
      .values({
        requestId: stored.id,
        nonce: randomBytes(32).toString('base64url'),
        createdAt: now,
        expiresAt: now + open.competition.rulesetJson.registration.invite_days * DAY_MS,
      })
      .run();
    const clubName =
      clubPayload.kind === 'new'
        ? clubPayload.name
        : (tx.select({ name: club.name }).from(club).where(eq(club.id, clubPayload.clubId)).get()
            ?.name ?? null);
    tx.insert(auditLog)
      .values({
        actorPlayerId: playerId,
        actorKind: 'user',
        action: 'registration.file',
        entity: 'request',
        entityId: String(stored.id),
        afterJson: {
          roster: payload.roster.name,
          tag: payload.roster.tag,
          club: clubName,
          rulesVersionId: open.rules.id,
        },
        at: now,
      })
      .run();
    return { ok: true, id: stored.id };
  });
}

/** Whether a season's lineups are locked now, in the league's time zone (M-29). */
export function lockedNow(
  found: {
    competition: Pick<typeof competition.$inferSelect, 'schedulingJson' | 'rulesetJson'>;
    season: Pick<typeof season.$inferSelect, 'startsOn'>;
  },
  now: number,
): boolean {
  const today = zonedDate(now, found.competition.schedulingJson.time_zone).date;
  return lineupLocked(
    today,
    found.season.startsOn,
    found.competition.rulesetJson.registration.lineup_lock_days,
  );
}

/** A registration still waiting for staff, with its competition and season; nothing otherwise. */
export function waitingRegistration(db: Reader, requestId: number) {
  const row = db
    .select({ request, competition, season })
    .from(request)
    .innerJoin(competition, eq(request.competitionId, competition.id))
    .innerJoin(season, eq(request.seasonId, season.id))
    .where(
      and(
        eq(request.id, requestId),
        eq(request.kind, 'registration'),
        eq(request.status, 'pending'),
      ),
    )
    .get();
  const payload = row?.request.payloadJson;
  return row && payload && 'roster' in payload ? { ...row, payload } : null;
}

/** What each player declared, for whether they may play: see `playerGaps`. */
export function profilesOf(
  db: Reader,
  playerIds: readonly number[],
  title: string,
): Map<number, PlayerProfile> {
  if (playerIds.length === 0) return new Map();
  const ranked = new Set(
    db
      .select({ playerId: gameAccount.playerId, rank: gameAccount.rank, title: gameAccount.title })
      .from(gameAccount)
      .where(inArray(gameAccount.playerId, [...playerIds]))
      .all()
      .filter((account) => account.title === title && account.rank !== null)
      .map((account) => account.playerId),
  );
  return new Map(
    db
      .select()
      .from(player)
      .where(inArray(player.id, [...playerIds]))
      .all()
      .map((found) => [
        found.id,
        {
          gameAccount: ranked.has(found.id),
          nationality: found.nationality,
          statsConsent: found.statsConsentAt !== null,
          birthDate: found.birthDate,
        },
      ]),
  );
}

/**
 * The players who joined a registration, in the order they joined. Ready: nothing keeps them
 * from playing (their account, nationality, consent where required, and the league's age).
 */
export function lineupOf(
  db: Reader,
  requestId: number,
  title: string,
  settings: RegistrationSettings,
  seasonStartsOn: string,
): RegistrationPlayerView[] {
  const joined = db
    .select({ entry: registrationPlayer, name: player.displayName })
    .from(registrationPlayer)
    .innerJoin(player, eq(registrationPlayer.playerId, player.id))
    .where(eq(registrationPlayer.requestId, requestId))
    .orderBy(registrationPlayer.joinedAt)
    .all();
  const profiles = profilesOf(
    db,
    joined.map(({ entry }) => entry.playerId),
    title,
  );
  return joined.map(({ entry, name }) => {
    const profile = profiles.get(entry.playerId);
    return {
      playerId: entry.playerId,
      name,
      role: entry.role,
      captain: entry.captain,
      ready: profile !== undefined && playerGaps(profile, settings, seasonStartsOn).length === 0,
    };
  });
}

export interface RegistrationPlayerView {
  playerId: number;
  name: string;
  role: 'player' | 'sub';
  captain: boolean;
  ready: boolean;
}

export type RegistrationStatus =
  | {
      ok: true;
      id: number;
      status: string;
      requestedAt: number;
      competition: { name: string; slug: string };
      season: string;
      club: { name: string; existing: boolean };
      roster: { name: string; tag: string; colors: string[]; canStream: boolean; hasLogo: boolean };
      rulesVersion: string;
      /** The invitation in use; its link is computed from `nonce` by the website. */
      invite: { id: number; nonce: string; expiresAt: number; active: boolean } | null;
      players: RegistrationPlayerView[];
      lineup: { complete: boolean; gaps: LineupGap[] };
      /** Lineups are locked: no player joins, leaves or changes role (M-29). */
      locked: boolean;
    }
  | { ok: false; error: 'not_found' };

/**
 * A registration as its filer follows it. Anyone else finds nothing: staff see registrations in
 * their own list (phase 3d-4b).
 */
export function registrationStatus(
  db: Reader,
  playerId: number,
  requestId: number,
  now: number,
): RegistrationStatus {
  const row = db
    .select({ request, competition, season })
    .from(request)
    .innerJoin(competition, eq(request.competitionId, competition.id))
    .innerJoin(season, eq(request.seasonId, season.id))
    .where(and(eq(request.id, requestId), eq(request.kind, 'registration')))
    .get();
  const payload = row?.request.payloadJson;
  if (!row || row.request.requestedBy !== playerId || !payload || !('roster' in payload)) {
    return { ok: false, error: 'not_found' };
  }
  const settings = row.competition.rulesetJson.registration;

  const clubName =
    payload.club.kind === 'new'
      ? payload.club.name
      : (db.select({ name: club.name }).from(club).where(eq(club.id, payload.club.clubId)).get()
          ?.name ?? '?');
  const rules = db
    .select({ version: rulesVersion.version })
    .from(rulesVersion)
    .where(eq(rulesVersion.id, payload.rules.versionId))
    .get();
  const invite = db
    .select()
    .from(registrationInvite)
    .where(and(eq(registrationInvite.requestId, requestId), isNull(registrationInvite.revokedAt)))
    .orderBy(desc(registrationInvite.id))
    .get();

  const players = lineupOf(db, requestId, row.competition.title, settings, row.season.startsOn);

  return {
    ok: true,
    id: row.request.id,
    status: row.request.status,
    requestedAt: row.request.requestedAt,
    competition: { name: row.competition.name, slug: row.competition.slug },
    season: row.season.name,
    club: { name: clubName, existing: payload.club.kind === 'existing' },
    roster: {
      name: payload.roster.name,
      tag: payload.roster.tag,
      colors: payload.roster.colors,
      canStream: payload.roster.canStream,
      hasLogo: payload.roster.logoKey !== null,
    },
    rulesVersion: rules?.version ?? '?',
    invite: invite
      ? {
          id: invite.id,
          nonce: invite.nonce,
          expiresAt: invite.expiresAt,
          active: invite.expiresAt > now,
        }
      : null,
    players,
    lineup: lineupStatus(players, settings),
    locked: lockedNow(row, now),
  };
}
