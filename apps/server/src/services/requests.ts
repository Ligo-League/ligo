import {
  approvalFor,
  decideRequest,
  mayFile,
  reminderAt,
  requestDeadline,
  type AddableTeamRole,
  type ApprovalMode,
  type FilingError,
  type RequestKind,
  type RequestStatus,
  type RequestsSettings,
} from '@ligo/core';
import {
  findGuildLeague,
  listSeasonTeams,
  schema,
  type Db,
  type GuildLeague,
  type RequestPayload,
  type SeasonTeam,
  type Tx,
} from '@ligo/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { requireStaff, teamsActedFor, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';
import { queuePostsOf, type PostRef } from './queue-posts.ts';
import {
  applyStaffChange,
  changeTeamStaff,
  checkStaffChange,
  filterTeams,
  listTeamStaff,
  searchTeams,
  showTeamStaff,
  type MemberRef,
  type TeamMember,
  type TeamStaffChange,
  type TeamStaffReply,
} from './team-staff.ts';

// Team requests (design doc section 5, "Team requests"; maintainer, 13 November 2026). A team's
// owner and managers ask for a change to who acts for the team; the league approves what its
// rules restrict and the rest applies at once. League staff can still change a team directly
// (services/team-staff.ts). Every request is kept, whatever became of it.

const { auditLog, competition, leagueGuild, player, request, team } = schema;

export const REQUEST_NOTE_MAX_LENGTH = 500;
export const REQUEST_REASON_MAX_LENGTH = 500;

export interface PersonRef {
  playerId: number;
  discordUserId: string | null;
  displayName: string;
}

/** A request as messages and pages show it. */
export interface RequestView {
  id: number;
  kind: RequestKind;
  /** The role asked for, for an addition. */
  role: AddableTeamRole | null;
  status: RequestStatus;
  approval: ApprovalMode;
  team: { teamId: number; name: string; tag: string };
  /** Who the request is about. */
  subject: PersonRef;
  requester: PersonRef;
  note: string | null;
  /** Why staff refused it. */
  reason: string | null;
  decidedBy: PersonRef | null;
  requestedAt: number;
  /** When staff should have answered; null for a request applied at once. */
  deadline: number | null;
}

type RequestRow = typeof request.$inferSelect;

function personOf(db: Pick<Db, 'select'>, playerId: number): PersonRef {
  const row = db
    .select({ displayName: player.displayName, discordUserId: player.discordUserId })
    .from(player)
    .where(eq(player.id, playerId))
    .get();
  return {
    playerId,
    displayName: row?.displayName ?? '?',
    discordUserId: row?.discordUserId ?? null,
  };
}

function viewOf(db: Pick<Db, 'select'>, row: RequestRow, settings: RequestsSettings): RequestView {
  const payload: RequestPayload = row.payloadJson;
  const teamRow = db
    .select({ name: team.name, tag: team.tag })
    .from(team)
    .where(eq(team.id, row.teamId ?? -1))
    .get();
  return {
    id: row.id,
    kind: row.kind,
    role: 'role' in payload ? payload.role : null,
    status: row.status,
    approval: row.approval,
    team: { teamId: row.teamId ?? -1, name: teamRow?.name ?? '?', tag: teamRow?.tag ?? '?' },
    subject: personOf(db, payload.playerId),
    requester: personOf(db, row.requestedBy),
    note: row.note,
    reason: row.reason,
    decidedBy: row.decidedBy === null ? null : personOf(db, row.decidedBy),
    requestedAt: row.requestedAt,
    deadline: row.approval === 'staff' ? requestDeadline(row.requestedAt, settings) : null,
  };
}

const changeOf = (row: Pick<RequestRow, 'kind' | 'payloadJson'>): TeamStaffChange => {
  const payload = row.payloadJson;
  if (row.kind === 'team_member_add') {
    // The payload was built from the same kind when the request was filed.
    if (!('role' in payload)) throw new Error('An addition request without a role');
    return { kind: row.kind, playerId: payload.playerId, role: payload.role };
  }
  return { kind: row.kind, playerId: payload.playerId };
};

function audit(
  tx: Tx,
  action: string,
  row: RequestRow,
  by: number | null,
  after: Record<string, unknown>,
  now: number,
): void {
  tx.insert(auditLog)
    .values({
      actorPlayerId: by,
      actorKind: by === null ? 'system' : 'user',
      action,
      entity: 'request',
      entityId: String(row.id),
      beforeJson: { status: row.status },
      afterJson: after,
      at: now,
    })
    .run();
}

/** The team's owner, if it has one. */
const ownerOf = (members: readonly TeamMember[]) => members.find((m) => m.role === 'owner');

/** The people told of a decision: who asked, the team's owner, and who it is about. */
function recipientsOf(view: RequestView, members: readonly TeamMember[]): string[] {
  const ids = [
    view.requester.discordUserId,
    ownerOf(members)?.discordUserId ?? null,
    view.subject.discordUserId,
  ];
  return [...new Set(ids.filter((id): id is string => id !== null))];
}

// ---------------------------------------------------------------------------------------------
// The team a member acts for

type TeamOfError = 'not_linked' | 'no_season' | 'not_official' | 'team_required';

interface Official {
  league: GuildLeague;
  seasonId: number;
  team: SeasonTeam;
  playerId: number;
  role: TeamMember['role'];
}

/**
 * The team of the current season the member acts for: the one named, or their only one. A team
 * they do not act for is refused like a team they have nothing to do with.
 */
function officialOf(
  db: Pick<Db, 'select'>,
  actor: Actor,
  teamId: number | null,
): { ok: true; official: Official } | { ok: false; error: TeamOfError } {
  const league = actor.guildId === null ? undefined : findGuildLeague(db, actor.guildId);
  if (!league) return { ok: false, error: 'not_linked' };
  if (!league.season) return { ok: false, error: 'no_season' };
  const acting = teamsActedFor(db, actor);
  const seasonTeams = listSeasonTeams(db, league.season.id);
  const mine = acting.teams.flatMap((held) => {
    const found = seasonTeams.find((candidate) => candidate.teamId === held.teamId);
    return found ? [{ team: found, role: held.role }] : [];
  });
  if (acting.playerId === null || mine.length === 0) return { ok: false, error: 'not_official' };
  const chosen =
    teamId === null
      ? mine.length === 1
        ? mine[0]
        : undefined
      : mine.find((entry) => entry.team.teamId === teamId);
  if (!chosen) return { ok: false, error: teamId === null ? 'team_required' : 'not_official' };
  return {
    ok: true,
    official: {
      league,
      seasonId: league.season.id,
      team: chosen.team,
      playerId: acting.playerId,
      role: chosen.role,
    },
  };
}

/** The teams a member may pick in `/team`: every team for league staff, else their own. */
export function teamChoices(
  db: Pick<Db, 'select'>,
  actor: Actor,
  query: string,
  limit: number,
): SeasonTeam[] {
  if (requireStaff(db, actor).ok) return searchTeams(db, actor, query, limit);
  const league = actor.guildId === null ? undefined : findGuildLeague(db, actor.guildId);
  if (!league?.season) return [];
  const mine = new Set(teamsActedFor(db, actor).teams.map((held) => held.teamId));
  const teams = listSeasonTeams(db, league.season.id).filter((t) => mine.has(t.teamId));
  return filterTeams(teams, query, limit);
}

/** Who acts for a team: any team for league staff, their own team for its officials. */
export function teamOfficials(
  db: Db,
  actor: Actor,
  teamId: number | null,
): TeamStaffReply | { ok: false; error: TeamOfError } {
  if (requireStaff(db, actor).ok) {
    return teamId === null
      ? { ok: false, error: 'team_required' }
      : showTeamStaff(db, actor, teamId);
  }
  const found = officialOf(db, actor, teamId);
  if (!found.ok) return found;
  const { team: chosen } = found.official;
  return { ok: true, team: chosen, members: listTeamStaff(db, chosen.teamId) };
}

// ---------------------------------------------------------------------------------------------
// Filing

/** What a team asks; `member` null means the one asking, who leaves the team. */
export type RequestInput = (
  | { kind: 'team_owner'; member: MemberRef }
  | { kind: 'team_member_add'; member: MemberRef; role: AddableTeamRole }
  | { kind: 'team_member_remove'; member: MemberRef | null }
) & { teamId: number | null; note: string | null };

export type FileError =
  | TeamOfError
  | FilingError
  | 'queue_not_set'
  | 'already_requested'
  | 'already_on_team'
  | 'not_on_team';

export type FileReply =
  | {
      ok: true;
      request: RequestView;
      team: SeasonTeam;
      /** True when it applied at once; otherwise it waits for league staff. */
      applied: boolean;
      members: TeamMember[];
      queueChannelId: string | null;
    }
  | { ok: false; error: FileError }
  | { ok: false; error: 'role_full'; max: number };

/** A team's owner or manager asks for a change to the team; see `mayFile` for who may ask what. */
export function fileRequest(db: Db, actor: Actor, input: RequestInput, now: number): FileReply {
  const found = officialOf(db, actor, input.teamId);
  if (!found.ok) return found;
  const { league, seasonId, team: chosen, playerId: filer, role: filerRole } = found.official;
  const { rulesetJson } = league.competition;
  const note = input.note?.trim().slice(0, REQUEST_NOTE_MAX_LENGTH) || null;
  const queueChannelId = league.guild.alertsChannelId;

  return db.transaction((tx): FileReply => {
    let subject: number;
    if (input.member === null) {
      subject = filer;
    } else if (input.kind === 'team_member_remove') {
      const { id } = input.member;
      const member = listTeamStaff(tx, chosen.teamId).find((m) => m.discordUserId === id);
      if (!member) return { ok: false, error: 'not_on_team' };
      subject = member.playerId;
    } else {
      subject = ensurePlayer(
        tx,
        {
          orgId: league.org.id,
          discordUserId: input.member.id,
          displayName: input.member.displayName,
        },
        now,
      ).id;
    }
    const self = subject === filer;
    const allowed = mayFile(input.kind, filerRole, self);
    if (!allowed.ok) return allowed;

    const change: TeamStaffChange =
      input.kind === 'team_member_add'
        ? { kind: input.kind, playerId: subject, role: input.role }
        : { kind: input.kind, playerId: subject };
    const checked = checkStaffChange(tx, chosen.teamId, change, rulesetJson.team_roles);
    if (!checked.ok) return checked;

    const approval = approvalFor(input.kind, rulesetJson.requests, self);
    if (approval === 'staff') {
      if (!queueChannelId) return { ok: false, error: 'queue_not_set' };
      const waiting = tx
        .select()
        .from(request)
        .where(
          and(
            eq(request.teamId, chosen.teamId),
            eq(request.kind, input.kind),
            eq(request.status, 'pending'),
          ),
        )
        .all();
      if (waiting.some((row) => row.payloadJson.playerId === subject)) {
        return { ok: false, error: 'already_requested' };
      }
    }

    const payloadJson: RequestPayload =
      change.kind === 'team_member_add'
        ? { playerId: subject, role: change.role }
        : { playerId: subject };
    const applied = approval === 'auto';
    const row = tx
      .insert(request)
      .values({
        competitionId: league.competition.id,
        seasonId,
        teamId: chosen.teamId,
        kind: input.kind,
        payloadJson,
        approval,
        status: applied ? 'approved' : 'pending',
        note,
        requestedBy: filer,
        requestedAt: now,
        decidedAt: applied ? now : null,
      })
      .returning()
      .get();
    audit(tx, 'request.file', { ...row, status: 'pending' }, filer, { status: row.status }, now);
    const members = applied
      ? applyStaffChange(
          tx,
          chosen.teamId,
          change,
          { playerId: filer, kind: 'user', requestId: row.id },
          now,
        )
      : checked.members;
    return {
      ok: true,
      request: viewOf(tx, row, rulesetJson.requests),
      team: chosen,
      applied,
      members,
      queueChannelId,
    };
  });
}

/**
 * The `/team` change commands: league staff change the team directly, as before; a team's
 * officials file a request instead.
 */
export function submitTeamChange(
  db: Db,
  actor: Actor,
  input: RequestInput,
  now: number,
):
  | { mode: 'direct'; reply: TeamStaffReply | { ok: false; error: 'team_required' } }
  | { mode: 'request'; reply: FileReply } {
  if (input.member === null || !requireStaff(db, actor).ok) {
    return { mode: 'request', reply: fileRequest(db, actor, input, now) };
  }
  if (input.teamId === null)
    return { mode: 'direct', reply: { ok: false, error: 'team_required' } };
  const change =
    input.kind === 'team_member_add'
      ? { kind: input.kind, member: input.member, role: input.role }
      : { kind: input.kind, member: input.member };
  return {
    mode: 'direct',
    reply: changeTeamStaff(db, actor, { teamId: input.teamId, change }, now),
  };
}

// ---------------------------------------------------------------------------------------------
// Answering

export type AnswerError =
  | 'not_linked'
  | 'not_staff'
  | 'not_found'
  | 'not_pending'
  | 'not_yours'
  | 'reason_required'
  | 'already_on_team'
  | 'not_on_team'
  | 'owner_cannot_leave';

export type AnswerReply =
  | {
      ok: true;
      request: RequestView;
      /** Who acts for the team now. */
      members: TeamMember[];
      /** The request's posts in the staff queue, to mark as handled. */
      posts: PostRef[];
      /** Told directly of the decision: who asked, the team's owner, who it is about. */
      recipientIds: string[];
      queueChannelId: string | null;
    }
  | { ok: false; error: AnswerError }
  | { ok: false; error: 'role_full'; max: number };

/**
 * Whether the member may answer the request now: league staff, a request of their league, still
 * waiting. Checked before the refusal form opens, so nobody types a reason for nothing.
 */
export function checkAnswer(
  db: Pick<Db, 'select'>,
  actor: Actor,
  requestId: number,
): { ok: true } | { ok: false; error: 'not_linked' | 'not_staff' | 'not_found' | 'not_pending' } {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const row = db.select().from(request).where(eq(request.id, requestId)).get();
  if (row?.competitionId !== staff.league.competition.id) return { ok: false, error: 'not_found' };
  return row.status === 'pending' ? { ok: true } : { ok: false, error: 'not_pending' };
}

/** League staff approve a request, which applies it, or refuse it with a reason. */
export function answerRequest(
  db: Db,
  actor: Actor,
  input: { requestId: number; decision: 'approve' | 'reject'; reason: string | null },
  now: number,
): AnswerReply {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const { league } = staff;
  const reason = input.reason?.trim().slice(0, REQUEST_REASON_MAX_LENGTH) || null;
  if (input.decision === 'reject' && reason === null) {
    return { ok: false, error: 'reason_required' };
  }

  return db.transaction((tx): AnswerReply => {
    const row = tx.select().from(request).where(eq(request.id, input.requestId)).get();
    // A request of another league is reported as missing, like an unknown one.
    if (row?.competitionId !== league.competition.id || row.teamId === null) {
      return { ok: false, error: 'not_found' };
    }
    const next = decideRequest(row.status, input.decision);
    if (!next.ok) return next;
    const by = ensurePlayer(
      tx,
      { orgId: league.org.id, discordUserId: actor.user.id, displayName: actor.user.displayName },
      now,
    ).id;

    let members = listTeamStaff(tx, row.teamId);
    if (input.decision === 'approve') {
      // The team may have changed since it asked: the change must still make sense.
      const change = changeOf(row);
      const checked = checkStaffChange(
        tx,
        row.teamId,
        change,
        league.competition.rulesetJson.team_roles,
      );
      if (!checked.ok) return checked;
      members = applyStaffChange(
        tx,
        row.teamId,
        change,
        { playerId: by, kind: 'user', requestId: row.id },
        now,
      );
    }
    tx.update(request)
      .set({ status: next.status, decidedBy: by, decidedAt: now, reason })
      .where(and(eq(request.id, row.id), eq(request.status, 'pending')))
      .run();
    audit(tx, `request.${input.decision}`, row, by, { status: next.status, reason }, now);

    const view = viewOf(
      tx,
      { ...row, status: next.status, decidedBy: by, decidedAt: now, reason },
      league.competition.rulesetJson.requests,
    );
    return {
      ok: true,
      request: view,
      members,
      posts: queuePostsOf(tx, { entity: 'request', entityId: row.id }),
      recipientIds: recipientsOf(view, members),
      queueChannelId: league.guild.alertsChannelId,
    };
  });
}

/** Whoever asked, or the team's owner, takes back a request still waiting. */
export function withdrawRequest(
  db: Db,
  actor: Actor,
  input: { requestId: number },
  now: number,
): AnswerReply {
  const league = actor.guildId === null ? undefined : findGuildLeague(db, actor.guildId);
  if (!league) return { ok: false, error: 'not_linked' };
  const { playerId } = teamsActedFor(db, actor);

  return db.transaction((tx): AnswerReply => {
    const row = tx.select().from(request).where(eq(request.id, input.requestId)).get();
    if (row?.competitionId !== league.competition.id || row.teamId === null) {
      return { ok: false, error: 'not_found' };
    }
    const members = listTeamStaff(tx, row.teamId);
    const owner = ownerOf(members)?.playerId;
    if (playerId === null || (playerId !== row.requestedBy && playerId !== owner)) {
      return { ok: false, error: 'not_yours' };
    }
    const next = decideRequest(row.status, 'withdraw');
    if (!next.ok) return next;
    tx.update(request)
      .set({ status: next.status, decidedBy: playerId, decidedAt: now })
      .where(and(eq(request.id, row.id), eq(request.status, 'pending')))
      .run();
    audit(tx, 'request.withdraw', row, playerId, { status: next.status }, now);
    const view = viewOf(
      tx,
      { ...row, status: next.status, decidedBy: playerId, decidedAt: now },
      league.competition.rulesetJson.requests,
    );
    return {
      ok: true,
      request: view,
      members,
      posts: queuePostsOf(tx, { entity: 'request', entityId: row.id }),
      // Nobody else needs telling: the requester or the owner took it back.
      recipientIds: [],
      queueChannelId: league.guild.alertsChannelId,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Lists and the clock

export type ListReply =
  { ok: true; staff: boolean; requests: RequestView[] } | { ok: false; error: TeamOfError };

/**
 * The requests waiting, oldest first: every team's for league staff (or one team's), their own
 * team's for its officials.
 */
export function listRequests(db: Db, actor: Actor, teamId: number | null): ListReply {
  const staff = requireStaff(db, actor);
  let league: GuildLeague;
  let only: number | null = teamId;
  if (staff.ok) {
    league = staff.league;
  } else {
    const found = officialOf(db, actor, teamId);
    if (!found.ok) return found;
    league = found.official.league;
    only = found.official.team.teamId;
  }
  const rows = db
    .select()
    .from(request)
    .where(
      and(
        eq(request.competitionId, league.competition.id),
        eq(request.status, 'pending'),
        only === null ? undefined : eq(request.teamId, only),
      ),
    )
    .orderBy(asc(request.requestedAt))
    .all();
  const settings = league.competition.rulesetJson.requests;
  return { ok: true, staff: staff.ok, requests: rows.map((row) => viewOf(db, row, settings)) };
}

/** One reminder to post in a league's staff queue. */
export interface RequestReminder {
  request: RequestView;
  guildId: string;
  queueChannelId: string;
  staffRoleId: string;
  /** The request's first post in the queue, to link to. */
  post: PostRef | null;
}

/**
 * Marks the requests whose reminder is due and returns them, once each: a second tick finds them
 * reminded. A league with no staff queue gets no reminder until it chooses one.
 */
export function runRequestTick(db: Db, now: number): RequestReminder[] {
  return db.transaction((tx) => {
    const rows = tx
      .select({ request, guild: leagueGuild, ruleset: competition.rulesetJson })
      .from(request)
      .innerJoin(competition, eq(request.competitionId, competition.id))
      .innerJoin(leagueGuild, eq(leagueGuild.competitionId, competition.id))
      .where(
        and(
          eq(request.status, 'pending'),
          eq(request.approval, 'staff'),
          isNull(request.remindedAt),
        ),
      )
      .all();
    const reminders: RequestReminder[] = [];
    const done = new Set<number>();
    for (const { request: row, guild, ruleset } of rows) {
      const at = reminderAt(row.requestedAt, ruleset.requests);
      if (at === null || at > now || !guild.alertsChannelId || done.has(row.id)) continue;
      done.add(row.id);
      tx.update(request).set({ remindedAt: now }).where(eq(request.id, row.id)).run();
      reminders.push({
        request: viewOf(tx, row, ruleset.requests),
        guildId: guild.guildId,
        queueChannelId: guild.alertsChannelId,
        staffRoleId: guild.staffRoleId,
        post: queuePostsOf(tx, { entity: 'request', entityId: row.id })[0] ?? null,
      });
    }
    return reminders;
  });
}
