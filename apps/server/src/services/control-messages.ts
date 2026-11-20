import { assignSides, playPeriod, type PlayPeriod } from '@ligo/core';
import { listLeagueMatches, schema, type Db, type LeagueMatch } from '@ligo/db';
import { and, eq, inArray } from 'drizzle-orm';
import { teamRoleKey } from './team-roles.ts';
import { ranksOf } from './veto.ts';

// A match channel's control message (phase 4; design doc section 6, "Match channel lifecycle"):
// posted and pinned once the channel exists, and posted again in a channel made anew. Which
// channels still wait for one, and what it says.

const { competition, discordObject, match } = schema;
type Reader = Pick<Db, 'select'>;

const MATCH_KEY = /^match:(\d{1,9})$/;

/** The match channels of a server whose control message is not posted there yet. */
export function pendingControlMessages(
  db: Reader,
  guildId: string,
): { matchId: number; channelId: string }[] {
  const channels = db
    .select({ key: discordObject.key, channelId: discordObject.discordId })
    .from(discordObject)
    .where(and(eq(discordObject.guildId, guildId), eq(discordObject.kind, 'match_channel')))
    .all()
    .flatMap((row) => {
      const id = MATCH_KEY.exec(row.key)?.[1];
      return id === undefined ? [] : [{ matchId: Number(id), channelId: row.channelId }];
    });
  if (channels.length === 0) return [];
  const posted = new Map(
    db
      .select({ id: match.id, channelId: match.channelId, messageId: match.controlMessageId })
      .from(match)
      .where(
        inArray(
          match.id,
          channels.map((entry) => entry.matchId),
        ),
      )
      .all()
      .map((row) => [row.id, row]),
  );
  return channels.filter((entry) => {
    const row = posted.get(entry.matchId);
    return row !== undefined && (row.channelId !== entry.channelId || row.messageId === null);
  });
}

export interface ControlMessageData {
  match: LeagueMatch;
  period: PlayPeriod;
  /**
   * Who would host and choose the sides if the veto started now, from live standings; `byCoin`
   * when the ranks are equal and a coin toss decides at the veto. Null without standings.
   */
  sides: { host: 'a' | 'b' | null; chooser: 'a' | 'b' | null; byCoin: boolean } | null;
  /** The two teams' roles in the server, to mention them. */
  teamRoleIds: string[];
}

/** What a match's control message shows, or null for a match that is gone. */
export function controlMessageData(
  db: Reader,
  guildId: string,
  matchId: number,
): ControlMessageData | null {
  const [found] = listLeagueMatches(db, { matchId });
  if (!found) return null;
  const row = db
    .select({ scheduling: competition.schedulingJson })
    .from(competition)
    .where(eq(competition.id, found.competitionId))
    .get();
  if (!row) return null;
  const ranks = ranksOf(db, found);
  const assigned = ranks ? assignSides(ranks.a, ranks.b, 'a') : null;
  const roleKeys = [teamRoleKey(found.a.teamId), teamRoleKey(found.b.teamId)];
  const teamRoleIds = db
    .select({ discordId: discordObject.discordId })
    .from(discordObject)
    .where(
      and(
        eq(discordObject.guildId, guildId),
        eq(discordObject.kind, 'team_role'),
        inArray(discordObject.key, roleKeys),
      ),
    )
    .all()
    .map((entry) => entry.discordId);
  return {
    match: found,
    period: playPeriod(found.window, row.scheduling),
    sides: assigned && {
      host: assigned.host,
      chooser: assigned.sideChooser,
      byCoin: assigned.byCoin,
    },
    teamRoleIds,
  };
}

/** Stores where the control message was posted, so it is not posted again. */
export function recordControlMessage(
  db: Pick<Db, 'update'>,
  matchId: number,
  channelId: string,
  messageId: string,
): void {
  db.update(match)
    .set({ channelId, controlMessageId: messageId })
    .where(eq(match.id, matchId))
    .run();
}
