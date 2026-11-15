import { lineupStatus, mayApprove, slugify, type ApprovalError, type LineupGap } from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { EvidenceStore } from '../assets/evidence-store.ts';
import type { AssetStore } from '../assets/store.ts';
import { requireStaff, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';
import { REQUEST_REASON_MAX_LENGTH } from './requests.ts';
import { lineupOf, waitingRegistration } from './registrations.ts';

// Staff answer a registration (design doc section 7; maintainer, 14 and 15 November 2026). They
// see it as soon as it is filed (M-29) and approve it once its lineup is complete, into a division
// with room (O-16, O-26), none of its players on another roster of the competition (O-29).
// Approval creates the club if it is new, with the filer as its owner, the roster, its place in
// the division and its players, captain included. Staff may refuse with a reason.

const {
  auditLog,
  club,
  clubStaff,
  division,
  gameAccount,
  player,
  request,
  rosterEntry,
  slot,
  team,
} = schema;

type Reader = Pick<Db, 'select'>;
type Waiting = NonNullable<ReturnType<typeof waitingRegistration>>;

// A slot still in the division: a withdrawn or excluded team frees its place.
const HOLDS_PLACE = ['active', 'frozen'] as const;

/** The registration's players already on another roster of the competition this season. */
function onOtherRoster(db: Reader, seasonId: number, playerIds: readonly number[]): number[] {
  if (playerIds.length === 0) return [];
  const found = new Set(
    db
      .select({ playerId: rosterEntry.playerId })
      .from(rosterEntry)
      .where(
        and(
          eq(rosterEntry.seasonId, seasonId),
          inArray(rosterEntry.playerId, [...playerIds]),
          isNull(rosterEntry.validTo),
        ),
      )
      .all()
      .map((row) => row.playerId),
  );
  return playerIds.filter((id) => found.has(id));
}

function teamsIn(db: Reader, divisionId: number): number {
  return db
    .select({ id: slot.id })
    .from(slot)
    .where(and(eq(slot.divisionId, divisionId), inArray(slot.status, [...HOLDS_PLACE])))
    .all().length;
}

function clubNameOf(db: Reader, found: Waiting): string {
  const { payload } = found;
  return payload.club.kind === 'new'
    ? payload.club.name
    : (db.select({ name: club.name }).from(club).where(eq(club.id, payload.club.clubId)).get()
        ?.name ?? '?');
}

export interface RegistrationToApprove {
  id: number;
  roster: { name: string; tag: string; colors: string[]; canStream: boolean; hasLogo: boolean };
  club: { name: string; existing: boolean };
  filer: string;
  filedAt: number;
  /** Each player as staff check them: ready, but never their birth date (O-33). */
  players: {
    playerId: number;
    name: string;
    role: 'player' | 'sub';
    captain: boolean;
    ubisoftName: string | null;
    rank: string | null;
    nationality: string | null;
    ready: boolean;
  }[];
  lineup: { complete: boolean; gaps: LineupGap[] };
  onOtherRoster: number[];
  divisions: { id: number; name: string; teams: number; max: number }[];
}

/** The registrations waiting for a competition's staff, oldest first. */
export function registrationsToApprove(db: Reader, competitionId: number): RegistrationToApprove[] {
  const ids = db
    .select({ id: request.id })
    .from(request)
    .where(
      and(
        eq(request.competitionId, competitionId),
        eq(request.kind, 'registration'),
        eq(request.status, 'pending'),
      ),
    )
    .orderBy(asc(request.requestedAt), asc(request.id))
    .all();
  return ids.flatMap(({ id }) => {
    const found = waitingRegistration(db, id);
    if (!found) return [];
    const settings = found.competition.rulesetJson.registration;
    const members = lineupOf(db, id, found.competition.title, settings, found.season.startsOn);
    const playerIds = members.map((entry) => entry.playerId);
    const accounts = new Map(
      playerIds.length === 0
        ? []
        : db
            .select({
              playerId: gameAccount.playerId,
              name: gameAccount.displayName,
              rank: gameAccount.rank,
            })
            .from(gameAccount)
            .where(
              and(
                inArray(gameAccount.playerId, playerIds),
                eq(gameAccount.title, found.competition.title),
              ),
            )
            .all()
            .map((row) => [row.playerId, row] as const),
    );
    const nationalities = new Map(
      playerIds.length === 0
        ? []
        : db
            .select({ id: player.id, nationality: player.nationality })
            .from(player)
            .where(inArray(player.id, playerIds))
            .all()
            .map((row) => [row.id, row.nationality] as const),
    );
    const filer = db
      .select({ name: player.displayName })
      .from(player)
      .where(eq(player.id, found.request.requestedBy))
      .get();
    const { roster } = found.payload;
    return [
      {
        id,
        roster: {
          name: roster.name,
          tag: roster.tag,
          colors: roster.colors,
          canStream: roster.canStream,
          hasLogo: roster.logoKey !== null,
        },
        club: { name: clubNameOf(db, found), existing: found.payload.club.kind === 'existing' },
        filer: filer?.name ?? '?',
        filedAt: found.request.requestedAt,
        players: members.map((entry) => ({
          playerId: entry.playerId,
          name: entry.name,
          role: entry.role,
          captain: entry.captain,
          ubisoftName: accounts.get(entry.playerId)?.name ?? null,
          rank: accounts.get(entry.playerId)?.rank ?? null,
          nationality: nationalities.get(entry.playerId) ?? null,
          ready: entry.ready,
        })),
        lineup: lineupStatus(members, settings),
        onOtherRoster: onOtherRoster(db, found.season.id, playerIds),
        divisions: db
          .select({ id: division.id, name: division.name })
          .from(division)
          .where(eq(division.seasonId, found.season.id))
          .orderBy(asc(division.level), asc(division.id))
          .all()
          .map((row) => ({ ...row, teams: teamsIn(db, row.id), max: settings.division_max })),
      },
    ];
  });
}

export type ApproveError =
  | 'not_linked'
  | 'not_staff'
  | 'not_found'
  | 'invalid_division'
  | 'club_taken'
  | 'name_taken'
  | 'tag_taken';

export type ApproveReply =
  | { ok: true; teamId: number; logoLost: boolean }
  | { ok: false; error: ApproveError }
  | { ok: false; error: 'not_approvable'; reasons: ApprovalError[] };

/** The staff's league's waiting registration, and the division it goes into. */
function approvable(
  db: Reader,
  actor: Pick<Actor, 'guildId' | 'memberRoleIds'>,
  requestId: number,
  divisionId: number,
):
  | { ok: true; found: Waiting; slugs: { team: string; club: string | null } }
  | Exclude<ApproveReply, { ok: true }> {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const found = waitingRegistration(db, requestId);
  if (found?.competition.id !== staff.league.competition.id) {
    return { ok: false, error: 'not_found' };
  }
  const target = db.select().from(division).where(eq(division.id, divisionId)).get();
  if (target?.seasonId !== found.season.id) return { ok: false, error: 'invalid_division' };

  const settings = found.competition.rulesetJson.registration;
  const members = lineupOf(db, requestId, found.competition.title, settings, found.season.startsOn);
  const verdict = mayApprove(
    {
      lineup: lineupStatus(members, settings),
      onOtherRoster: onOtherRoster(
        db,
        found.season.id,
        members.map((entry) => entry.playerId),
      ),
      divisionTeams: teamsIn(db, divisionId),
    },
    settings,
  );
  if (!verdict.ok) return { ok: false, error: 'not_approvable', reasons: verdict.errors };

  // The filing checked names and tags; a team created since may have taken one.
  const { roster, club: clubPayload } = found.payload;
  const orgId = found.competition.orgId;
  const slugOf = (name: string) => {
    const slug = slugify(name);
    return slug.ok ? slug.slug : null;
  };
  const teamSlug = slugOf(roster.name);
  const sameTeam = (where: ReturnType<typeof and>) =>
    db.select({ id: team.id }).from(team).where(where).get() !== undefined;
  if (teamSlug === null || sameTeam(and(eq(team.orgId, orgId), eq(team.slug, teamSlug)))) {
    return { ok: false, error: 'name_taken' };
  }
  const tagWhere = and(
    eq(team.orgId, orgId),
    eq(team.title, found.competition.title),
    eq(team.tag, roster.tag),
  );
  if (sameTeam(tagWhere)) return { ok: false, error: 'tag_taken' };
  let clubSlug: string | null = null;
  if (clubPayload.kind === 'new') {
    clubSlug = slugOf(clubPayload.name);
    const taken =
      clubSlug === null ||
      db
        .select({ id: club.id })
        .from(club)
        .where(and(eq(club.orgId, orgId), eq(club.slug, clubSlug)))
        .get() !== undefined;
    if (taken) return { ok: false, error: 'club_taken' };
  }
  return { ok: true, found, slugs: { team: teamSlug, club: clubSlug } };
}

/**
 * Staff approve a registration into a division. The roster's logo is copied where images and
 * pages read logos; if that fails, the roster is approved without it, and staff are told.
 */
export async function approveRegistration(
  db: Db,
  assets: Pick<AssetStore, 'write'>,
  evidence: Pick<EvidenceStore, 'read'>,
  actor: Actor,
  input: { requestId: number; divisionId: number },
  now: number,
): Promise<ApproveReply> {
  const first = approvable(db, actor, input.requestId, input.divisionId);
  if (!first.ok) return first;

  const uploaded = first.found.payload.roster.logoKey;
  let logoKey: string | null = null;
  if (uploaded !== null) {
    // The upload is named by its content's hash: eight of its characters keep the key unique.
    const hash = /([0-9a-f]{8})[0-9a-f]*\.png$/.exec(uploaded)?.[1] ?? '00000000';
    const key = `logos/${first.slugs.team}-${hash}.png`;
    try {
      const data = await evidence.read(uploaded);
      if (data) {
        await assets.write(key, data);
        logoKey = key;
      }
    } catch {
      logoKey = null;
    }
  }

  return db.transaction((tx): ApproveReply => {
    // The logo took a moment: everything is checked again before anything is written.
    const checked = approvable(tx, actor, input.requestId, input.divisionId);
    if (!checked.ok) return checked;
    const { found, slugs } = checked;
    const { payload } = found;
    const orgId = found.competition.orgId;
    const filer = found.request.requestedBy;
    const staff = requireStaff(tx, actor);
    if (!staff.ok) return staff;
    const by = ensurePlayer(
      tx,
      {
        orgId: staff.league.org.id,
        discordUserId: actor.user.id,
        displayName: actor.user.displayName,
      },
      now,
    ).id;

    let clubId: number;
    if (payload.club.kind === 'new') {
      clubId = tx
        .insert(club)
        .values({
          orgId,
          name: payload.club.name,
          slug: slugs.club ?? '',
          city: payload.club.city,
          legalStatus: payload.club.legalStatus,
          // A new club's first roster gives it its colours and logo; the roster inherits them.
          colorsJson: payload.roster.colors,
          logoKey,
          socialsJson: payload.club.socials,
          discordUrl: payload.club.discordUrl,
        })
        .returning({ id: club.id })
        .get().id;
      tx.insert(clubStaff).values({ clubId, playerId: filer, role: 'owner', since: now }).run();
    } else {
      clubId = payload.club.clubId;
    }
    const existing = payload.club.kind === 'existing';
    const teamId = tx
      .insert(team)
      .values({
        orgId,
        clubId,
        title: found.competition.title,
        name: payload.roster.name,
        tag: payload.roster.tag,
        slug: slugs.team,
        colorsJson: existing ? payload.roster.colors : null,
        logoKey: existing ? logoKey : null,
        canStream: payload.roster.canStream,
      })
      .returning({ id: team.id })
      .get().id;
    tx.insert(slot).values({ divisionId: input.divisionId, teamId }).run();
    const members = lineupOf(
      tx,
      found.request.id,
      found.competition.title,
      found.competition.rulesetJson.registration,
      found.season.startsOn,
    );
    for (const entry of members) {
      tx.insert(rosterEntry)
        .values({
          seasonId: found.season.id,
          teamId,
          playerId: entry.playerId,
          role: entry.role,
          captain: entry.captain,
          validFrom: now,
        })
        .run();
    }
    tx.update(request)
      .set({ status: 'approved', decidedBy: by, decidedAt: now, teamId })
      .where(eq(request.id, found.request.id))
      .run();
    tx.insert(auditLog)
      .values({
        actorPlayerId: by,
        actorKind: 'user',
        action: 'registration.approve',
        entity: 'request',
        entityId: String(found.request.id),
        beforeJson: { status: 'pending' },
        afterJson: {
          status: 'approved',
          teamId,
          clubId,
          divisionId: input.divisionId,
          players: members.map((entry) => entry.playerId),
        },
        at: now,
      })
      .run();
    return { ok: true, teamId, logoLost: uploaded !== null && logoKey === null };
  });
}

/** Staff refuse a registration, always with a reason, which the filer reads on its page. */
export function rejectRegistration(
  db: Db,
  actor: Actor,
  input: { requestId: number; reason: string },
  now: number,
):
  | { ok: true }
  | { ok: false; error: 'not_linked' | 'not_staff' | 'not_found' | 'reason_required' } {
  const reason = input.reason.trim().slice(0, REQUEST_REASON_MAX_LENGTH);
  if (reason === '') return { ok: false, error: 'reason_required' };
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  return db.transaction((tx) => {
    const found = waitingRegistration(tx, input.requestId);
    if (found?.competition.id !== staff.league.competition.id) {
      return { ok: false as const, error: 'not_found' as const };
    }
    const by = ensurePlayer(
      tx,
      {
        orgId: staff.league.org.id,
        discordUserId: actor.user.id,
        displayName: actor.user.displayName,
      },
      now,
    ).id;
    tx.update(request)
      .set({ status: 'rejected', decidedBy: by, decidedAt: now, reason })
      .where(eq(request.id, input.requestId))
      .run();
    tx.insert(auditLog)
      .values({
        actorPlayerId: by,
        actorKind: 'user',
        action: 'registration.reject',
        entity: 'request',
        entityId: String(input.requestId),
        beforeJson: { status: 'pending' },
        afterJson: { status: 'rejected', reason },
        at: now,
      })
      .run();
    return { ok: true as const };
  });
}
