import {
  canProposeAt,
  dueSchedulingAction,
  playPeriod,
  zonedDate,
  zonedDateTime,
  zonedMidnight,
  type PlayPeriod,
  type ZonedDateTimeResult,
  type ProposeRefusal,
} from '@ligo/core';
import {
  findGuildLeague,
  listLeagueMatches,
  listMatchesWithoutTime,
  schema,
  type Db,
  type GuildLeague,
  type LeagueMatch,
} from '@ligo/db';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import type { PostRef } from './queue-posts.ts';
import { hasExcludedTeam } from './exclusions.ts';
import { actsFor, matchActorOf, requireStaff, sideOf, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';
import { leagueMatch } from './reports.ts';
import { matchMentions, teamMentions } from './team-staff.ts';

// When a match is played: teams propose and accept a time; without one, the clock starts the
// extension and sets the automatic time (design doc section 5, "Scheduling").

const { auditLog, leagueGuild, match, matchProposal } = schema;

type Side = 'a' | 'b';
const other = (side: Side): Side => (side === 'a' ? 'b' : 'a');

/** The week of a match and its extension, by the league's scheduling settings. */
export const periodOf = (league: GuildLeague, found: LeagueMatch): PlayPeriod =>
  playPeriod(found.window, league.competition.schedulingJson);

// ---------------------------------------------------------------------------------------------
// A team proposes a time

export type ProposeError =
  | 'not_linked'
  | 'no_team'
  | 'match_not_found'
  | 'not_your_match'
  | 'not_schedulable'
  | 'team_excluded'
  | ProposeRefusal;

export type ProposeReply =
  | {
      ok: true;
      match: LeagueMatch;
      proposalId: number;
      side: Side;
      at: number;
      /** The other side's officials and captain, to mention (Discord IDs). */
      opponentIds: string[];
      /** Where a proposal made on the website is posted, when the league has set it (M-32). */
      scheduleChannelId: string | null;
    }
  | { ok: false; error: ProposeError };

/** A team's manager or staff proposes a time; it replaces the team's earlier pending proposal. */
export function proposeTime(
  db: Db,
  actor: Actor,
  request: { matchId: number; at: number },
  now: number,
): ProposeReply {
  const league = actor.guildId === null ? undefined : findGuildLeague(db, actor.guildId);
  if (!league) return { ok: false, error: 'not_linked' };

  return db.transaction((tx): ProposeReply => {
    const acting = matchActorOf(tx, actor, league.season?.id ?? null);
    if (acting.playerId === null || acting.teams.length === 0) {
      return { ok: false, error: 'no_team' };
    }
    const found = leagueMatch(tx, league, request.matchId);
    if (!found) return { ok: false, error: 'match_not_found' };
    // The captain acts for their roster in that match's season only.
    const side = sideOf(matchActorOf(tx, actor, found.seasonId).teams, found);
    if (side === null) return { ok: false, error: 'not_your_match' };
    if (found.status !== 'scheduled') return { ok: false, error: 'not_schedulable' };
    if (hasExcludedTeam(tx, found)) return { ok: false, error: 'team_excluded' };
    const allowed = canProposeAt(request.at, periodOf(league, found), now);
    if (!allowed.ok) return allowed;

    tx.update(matchProposal)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(matchProposal.matchId, found.id),
          eq(matchProposal.side, side),
          eq(matchProposal.status, 'pending'),
        ),
      )
      .run();
    const proposalId = tx
      .insert(matchProposal)
      .values({
        matchId: found.id,
        side,
        proposedBy: acting.playerId,
        at: request.at,
        createdAt: now,
      })
      .returning({ id: matchProposal.id })
      .get().id;
    tx.insert(auditLog)
      .values({
        actorPlayerId: acting.playerId,
        actorKind: 'user',
        action: 'match.propose_time',
        entity: 'match',
        entityId: String(found.id),
        beforeJson: { scheduledAt: found.scheduledAt },
        afterJson: { at: request.at, side, proposalId },
        at: now,
      })
      .run();

    return {
      ok: true,
      match: found,
      proposalId,
      side,
      at: request.at,
      opponentIds: teamMentions(tx, found[other(side)].teamId, found.seasonId, found.id),
      scheduleChannelId: league.guild.scheduleChannelId,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// The other team answers

export type AnswerProposalError =
  | 'not_linked'
  | 'stale'
  | 'match_not_found'
  | 'not_your_match'
  | 'not_opponent'
  | 'not_schedulable'
  | 'team_excluded'
  | 'in_past';

export type AnswerProposalReply =
  | {
      ok: true;
      match: LeagueMatch;
      status: 'accepted' | 'declined';
      at: number;
      /** The side that proposed. */
      side: Side;
      /** Where an agreed time is announced, when the league has set it. */
      scheduleChannelId: string | null;
      /** The proposal's post in Discord, to show the answer on; null when none was kept. */
      post: PostRef | null;
    }
  | { ok: false; error: AnswerProposalError };

/**
 * The other team accepts or declines a proposed time. The button names the proposal; one already
 * answered or replaced is stale. Accepting sets the match's time, replacing an automatic one.
 */
export function answerProposal(
  db: Db,
  actor: Actor,
  request: { matchId: number; proposalId: number; action: 'accept' | 'decline' },
  now: number,
): AnswerProposalReply {
  const league = actor.guildId === null ? undefined : findGuildLeague(db, actor.guildId);
  if (!league) return { ok: false, error: 'not_linked' };

  return db.transaction((tx): AnswerProposalReply => {
    const proposal = tx
      .select()
      .from(matchProposal)
      .where(eq(matchProposal.id, request.proposalId))
      .get();
    if (proposal?.matchId !== request.matchId || proposal.status !== 'pending') {
      return { ok: false, error: 'stale' };
    }
    const found = leagueMatch(tx, league, proposal.matchId);
    if (!found) return { ok: false, error: 'match_not_found' };
    const acting = matchActorOf(tx, actor, found.seasonId);
    if (acting.playerId === null || sideOf(acting.teams, found) === null) {
      return { ok: false, error: 'not_your_match' };
    }
    if (!actsFor(acting.teams, found, other(proposal.side))) {
      return { ok: false, error: 'not_opponent' };
    }
    if (found.status !== 'scheduled') return { ok: false, error: 'not_schedulable' };
    if (hasExcludedTeam(tx, found)) return { ok: false, error: 'team_excluded' };
    const accept = request.action === 'accept';
    if (accept && proposal.at <= now) return { ok: false, error: 'in_past' };

    const status = accept ? 'accepted' : 'declined';
    tx.update(matchProposal)
      .set({ status, answeredBy: acting.playerId, answeredAt: now })
      .where(eq(matchProposal.id, proposal.id))
      .run();
    if (accept) {
      tx.update(match)
        .set({ scheduledAt: proposal.at, autoScheduled: false })
        .where(eq(match.id, found.id))
        .run();
      // The match has its time: other proposals no longer mean anything.
      tx.update(matchProposal)
        .set({ status: 'superseded' })
        .where(and(eq(matchProposal.matchId, found.id), eq(matchProposal.status, 'pending')))
        .run();
    }
    tx.insert(auditLog)
      .values({
        actorPlayerId: acting.playerId,
        actorKind: 'user',
        action: accept ? 'match.accept_time' : 'match.decline_time',
        entity: 'match',
        entityId: String(found.id),
        beforeJson: { scheduledAt: found.scheduledAt, autoScheduled: found.autoScheduled },
        afterJson: accept
          ? { scheduledAt: proposal.at, proposalId: proposal.id }
          : { proposalId: proposal.id },
        at: now,
      })
      .run();
    return {
      ok: true,
      match: found,
      status,
      at: proposal.at,
      side: proposal.side,
      scheduleChannelId: league.guild.scheduleChannelId,
      post:
        proposal.channelId !== null && proposal.messageId !== null
          ? { channelId: proposal.channelId, messageId: proposal.messageId }
          : null,
    };
  });
}

/** Keeps where a proposal was posted in Discord, so that an answer given anywhere edits it. */
export function recordProposalPost(db: Pick<Db, 'update'>, proposalId: number, post: PostRef) {
  db.update(matchProposal)
    .set({ channelId: post.channelId, messageId: post.messageId })
    .where(eq(matchProposal.id, proposalId))
    .run();
}

export interface PendingProposal {
  id: number;
  side: Side;
  at: number;
  proposedBy: string;
}

/** A match's proposals waiting for an answer, oldest first: at most one per side. */
export function pendingProposals(db: Pick<Db, 'select'>, matchId: number): PendingProposal[] {
  return db
    .select({
      id: matchProposal.id,
      side: matchProposal.side,
      at: matchProposal.at,
      proposedBy: schema.player.displayName,
    })
    .from(matchProposal)
    .innerJoin(schema.player, eq(matchProposal.proposedBy, schema.player.id))
    .where(and(eq(matchProposal.matchId, matchId), eq(matchProposal.status, 'pending')))
    .orderBy(asc(matchProposal.id))
    .all();
}

// ---------------------------------------------------------------------------------------------
// Staff set a time

export type SetTimeReply =
  | { ok: true; match: LeagueMatch; at: number; scheduleChannelId: string | null }
  | { ok: false; error: 'not_linked' | 'not_staff' | 'match_not_found' | 'not_schedulable' };

/** Staff set a match's time, any time: the deadlines are theirs to bend. Pending proposals end. */
export function setMatchTime(
  db: Db,
  actor: Actor,
  request: { matchId: number; at: number },
  now: number,
): SetTimeReply {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const { league } = staff;

  return db.transaction((tx): SetTimeReply => {
    const found = leagueMatch(tx, league, request.matchId);
    if (!found) return { ok: false, error: 'match_not_found' };
    if (found.status !== 'scheduled') return { ok: false, error: 'not_schedulable' };
    const staffPlayer = ensurePlayer(
      tx,
      { orgId: league.org.id, discordUserId: actor.user.id, displayName: actor.user.displayName },
      now,
    );
    tx.update(match)
      .set({ scheduledAt: request.at, autoScheduled: false })
      .where(eq(match.id, found.id))
      .run();
    tx.update(matchProposal)
      .set({ status: 'withdrawn' })
      .where(and(eq(matchProposal.matchId, found.id), eq(matchProposal.status, 'pending')))
      .run();
    tx.insert(auditLog)
      .values({
        actorPlayerId: staffPlayer.id,
        actorKind: 'user',
        action: 'match.schedule',
        entity: 'match',
        entityId: String(found.id),
        beforeJson: { scheduledAt: found.scheduledAt, autoScheduled: found.autoScheduled },
        afterJson: { scheduledAt: request.at },
        at: now,
      })
      .run();
    return {
      ok: true,
      match: found,
      at: request.at,
      scheduleChannelId: league.guild.scheduleChannelId,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// The clock

export interface SchedulingNotice {
  match: LeagueMatch;
  /** The automatic time now set. */
  at: number;
  /** Until when the teams may still agree another time. */
  extensionEnd: number;
  /** The schedule channels of the servers of that league; empty when none is set. */
  channelIds: string[];
  /** Both teams' managers and staff. */
  mentionUserIds: string[];
}

/**
 * Starts the extension of every match whose week ended without a time: sets the automatic time,
 * audited as the system, and returns what to announce. Running it again changes nothing.
 */
export function runSchedulingTick(db: Db, now: number): SchedulingNotice[] {
  const notices: SchedulingNotice[] = [];
  for (const candidate of listMatchesWithoutTime(db, now)) {
    const notice = db.transaction((tx): SchedulingNotice | null => {
      // Read again inside the transaction: a team may have just agreed a time.
      const [found] = listLeagueMatches(tx, { matchId: candidate.matchId });
      // An excluded team plays no more: no extension, no automatic time.
      if (!found || hasExcludedTeam(tx, found)) return null;
      const period = playPeriod(found.window, candidate.scheduling);
      if (dueSchedulingAction(found, period, now) !== 'start_extension') return null;
      // dueSchedulingAction only answers 'start_extension' when there is an automatic time.
      const at = period.autoSlotAt ?? now;
      tx.update(match)
        .set({ scheduledAt: at, autoScheduled: true })
        .where(eq(match.id, found.id))
        .run();
      tx.insert(auditLog)
        .values({
          actorKind: 'system',
          action: 'match.auto_schedule',
          entity: 'match',
          entityId: String(found.id),
          beforeJson: { scheduledAt: null },
          afterJson: { scheduledAt: at, autoScheduled: true, extensionEnd: period.extensionEnd },
          at: now,
        })
        .run();
      const channelIds = tx
        .select({ id: leagueGuild.scheduleChannelId })
        .from(leagueGuild)
        .where(
          and(
            eq(leagueGuild.competitionId, candidate.competitionId),
            isNotNull(leagueGuild.scheduleChannelId),
          ),
        )
        .all()
        .flatMap((row) => row.id ?? []);
      const mentionUserIds = matchMentions(tx, found);
      return { match: found, at, extensionEnd: period.extensionEnd, channelIds, mentionUserIds };
    });
    if (notice) notices.push(notice);
  }
  return notices;
}

// ---------------------------------------------------------------------------------------------
// Suggestions

/**
 * The days a member can pick for a time: those left in the week and extension of the chosen
 * match when it is theirs, else the next two weeks. In the league's time zone.
 */
export function proposalDays(
  db: Pick<Db, 'select'>,
  actor: Actor,
  matchId: number | null,
  now: number,
): { date: string; weekday: number }[] {
  const league = actor.guildId === null ? undefined : findGuildLeague(db, actor.guildId);
  const zone = league?.competition.schedulingJson.time_zone ?? 'Europe/Paris';
  let from = now;
  // Today and the thirteen days after it.
  let until = zonedMidnight(zonedDate(now, zone).date, zone, 14);
  const found = league && matchId !== null ? leagueMatch(db, league, matchId) : undefined;
  if (league && found && sideOf(matchActorOf(db, actor, found.seasonId).teams, found) !== null) {
    const period = periodOf(league, found);
    from = Math.max(now, period.start);
    until = period.extensionEnd;
  }
  const first = zonedDate(from, zone).date;
  const days: { date: string; weekday: number }[] = [];
  for (let offset = 0; offset < 31; offset += 1) {
    const midnight = zonedMidnight(first, zone, offset);
    if (midnight >= until) break;
    const local = zonedDate(midnight, zone);
    days.push({ date: local.date, weekday: local.weekday });
  }
  return days;
}

/** A date and a time as typed, read in the league's time zone. */
export function readMatchTime(
  db: Pick<Db, 'select'>,
  actor: Pick<Actor, 'guildId'>,
  date: string,
  time: string,
): ZonedDateTimeResult {
  const league = actor.guildId === null ? undefined : findGuildLeague(db, actor.guildId);
  const zone = league?.competition.schedulingJson.time_zone ?? 'Europe/Paris';
  return zonedDateTime(date.trim(), time.trim(), zone);
}
