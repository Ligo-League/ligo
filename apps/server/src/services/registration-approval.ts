import { lineupStatus, mayApprove, type ApprovalError, type LineupGap } from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { requireStaff, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';
import {
  clubNameOf,
  notOnServer,
  unavailablePlayers,
  type MemberCheck,
} from './registration-players.ts';
import { REQUEST_REASON_MAX_LENGTH } from './requests.ts';
import { lineupOf, waitingRegistration } from './registrations.ts';
import { listTeamStaff } from './team-staff.ts';

// Staff answer a registration (design doc section 7; maintainer, 14 and 15 November 2026). They
// see it as soon as it is filed (M-29) and approve it once its lineup is complete, into a division
// with room (O-16, O-26): none of its players on another roster of the competition (O-29), each
// on the league's Discord server (M-30), the roster's officials within the league's limits. The
// roster exists already (M-33): approval gives it its place in the division and the season's
// lineup, captain included. Staff may refuse with a reason.

const { auditLog, club, division, gameAccount, player, request, rosterEntry, slot } = schema;

type Reader = Pick<Db, 'select'>;
type Waiting = NonNullable<ReturnType<typeof waitingRegistration>>;

// A slot still in the division: a withdrawn or excluded team frees its place.
const HOLDS_PLACE = ['active', 'frozen'] as const;

function teamsIn(db: Reader, divisionId: number): number {
  return db
    .select({ id: slot.id })
    .from(slot)
    .where(and(eq(slot.divisionId, divisionId), inArray(slot.status, [...HOLDS_PLACE])))
    .all().length;
}

/** The roster's own managers and coaches, which the league limits. */
function officialsOf(db: Reader, teamId: number) {
  const members = listTeamStaff(db, teamId);
  return {
    manager: members.filter((member) => member.role === 'manager').length,
    coach: members.filter((member) => member.role === 'coach').length,
  };
}

const membersOf = (db: Reader, found: Waiting) =>
  lineupOf(
    db,
    found.request.id,
    found.competition.title,
    found.competition.rulesetJson.registration,
    found.season.startsOn,
  );

export interface RegistrationToApprove {
  id: number;
  roster: { name: string; tag: string; slug: string; colors: string[]; hasLogo: boolean };
  club: string;
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
  /** Players not on the league's Discord server now; null when Discord cannot say. */
  notOnServer: number[] | null;
  divisions: { id: number; name: string; teams: number; max: number }[];
}

/** The registrations waiting for a competition's staff, oldest first. */
export async function registrationsToApprove(
  db: Reader,
  memberOf: MemberCheck,
  competitionId: number,
): Promise<RegistrationToApprove[]> {
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
  const found: RegistrationToApprove[] = [];
  for (const { id } of ids) {
    const waiting = waitingRegistration(db, id);
    if (!waiting) continue;
    const settings = waiting.competition.rulesetJson.registration;
    const members = membersOf(db, waiting);
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
                eq(gameAccount.title, waiting.competition.title),
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
      .where(eq(player.id, waiting.request.requestedBy))
      .get();
    // A roster without colours or a logo of its own shows its club's.
    const clubRow = db.select().from(club).where(eq(club.id, waiting.team.clubId)).get();
    found.push({
      id,
      roster: {
        name: waiting.team.name,
        tag: waiting.team.tag,
        slug: waiting.team.slug,
        colors: waiting.team.colorsJson ?? clubRow?.colorsJson ?? [],
        hasLogo: (waiting.team.logoKey ?? clubRow?.logoKey ?? null) !== null,
      },
      club: clubNameOf(db, waiting.request),
      filer: filer?.name ?? '?',
      filedAt: waiting.request.requestedAt,
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
      onOtherRoster: unavailablePlayers(
        db,
        { requestId: id, competitionId, seasonId: waiting.season.id },
        playerIds,
      ),
      notOnServer: await notOnServer(db, memberOf, competitionId, playerIds),
      divisions: db
        .select({ id: division.id, name: division.name })
        .from(division)
        .where(eq(division.seasonId, waiting.season.id))
        .orderBy(asc(division.level), asc(division.id))
        .all()
        .map((row) => ({ ...row, teams: teamsIn(db, row.id), max: settings.division_max })),
    });
  }
  return found;
}

export type ApproveError =
  'not_linked' | 'not_staff' | 'not_found' | 'invalid_division' | 'discord_unavailable';

export type ApproveReply =
  | { ok: true; teamId: number }
  | { ok: false; error: ApproveError }
  | { ok: false; error: 'not_approvable'; reasons: ApprovalError[] };

/** The staff's league's waiting registration, and the division it goes into. */
function approvable(
  db: Reader,
  actor: Pick<Actor, 'guildId' | 'memberRoleIds'>,
  input: { requestId: number; divisionId: number },
  notMembers: readonly number[],
): { ok: true; found: Waiting } | Exclude<ApproveReply, { ok: true }> {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const found = waitingRegistration(db, input.requestId);
  if (found?.competition.id !== staff.league.competition.id) {
    return { ok: false, error: 'not_found' };
  }
  const target = db.select().from(division).where(eq(division.id, input.divisionId)).get();
  if (target?.seasonId !== found.season.id) return { ok: false, error: 'invalid_division' };

  const settings = found.competition.rulesetJson.registration;
  const members = membersOf(db, found);
  const verdict = mayApprove(
    {
      lineup: lineupStatus(members, settings),
      onOtherRoster: unavailablePlayers(
        db,
        {
          requestId: found.request.id,
          competitionId: found.competition.id,
          seasonId: found.season.id,
        },
        members.map((entry) => entry.playerId),
      ),
      notMembers,
      officials: officialsOf(db, found.team.id),
      divisionTeams: teamsIn(db, input.divisionId),
    },
    settings,
    found.competition.rulesetJson.team_roles,
  );
  if (!verdict.ok) return { ok: false, error: 'not_approvable', reasons: verdict.errors };
  return { ok: true, found };
}

/**
 * Staff approve a registration into a division: the roster takes its place there, and its
 * lineup becomes the season's, captain included. Discord is asked first whether each player is
 * on the league's server; everything else is checked again as it is written.
 */
export async function approveRegistration(
  db: Db,
  memberOf: MemberCheck,
  actor: Actor,
  input: { requestId: number; divisionId: number },
  now: number,
): Promise<ApproveReply> {
  const first = approvable(db, actor, input, []);
  // Discord is asked even for a registration not ready yet, so staff read every reason at once.
  if (!first.ok && first.error !== 'not_approvable') return first;
  const found = waitingRegistration(db, input.requestId);
  if (!found) return { ok: false, error: 'not_found' };
  const notMembers = await notOnServer(
    db,
    memberOf,
    found.competition.id,
    membersOf(db, found).map((entry) => entry.playerId),
  );
  if (notMembers === null) return { ok: false, error: 'discord_unavailable' };

  return db.transaction((tx): ApproveReply => {
    const checked = approvable(tx, actor, input, notMembers);
    if (!checked.ok) return checked;
    const { found } = checked;
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
    const teamId = found.team.id;
    tx.insert(slot).values({ divisionId: input.divisionId, teamId }).run();
    const members = membersOf(tx, found);
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
      .set({ status: 'approved', decidedBy: by, decidedAt: now })
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
          divisionId: input.divisionId,
          players: members.map((entry) => entry.playerId),
        },
        at: now,
      })
      .run();
    return { ok: true, teamId };
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
