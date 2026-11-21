import { matchChannelKey, type ChannelKind } from '@ligo/core';
import { schema, type Db } from '@ligo/db';
import { and, eq, inArray } from 'drizzle-orm';
import { transcriptKey, type TranscriptStore } from '../assets/transcript-store.ts';
import type { DiscordGateway } from '../discord/gateway.ts';

// Season end for match channels (phase 4; design doc section 6, "Season end"): once staff close
// a season, each of its match channels is saved as JSON, then Ligo deletes it. The reconciler
// deletes a channel only once its transcript is recorded here, so a mistake in what Ligo wants
// can never erase a conversation.

const { discordObject, match, matchTranscript, season, stage } = schema;
type Reader = Pick<Db, 'select'>;

/** Far above any match channel; a bound on what one transcript holds in memory. */
export const TRANSCRIPT_MESSAGE_LIMIT = 20_000;

/** The transcript file's layout version, for whoever reads it later. */
const FORMAT = 1;

const MATCH_KEY = /^match:([1-9]\d{0,9})$/;

interface ClosedChannel {
  matchId: number;
  seasonId: number;
  channelId: string;
}

/** The server's match channels Ligo made whose season is closed, with no transcript yet. */
export function channelsToSave(db: Reader, guildId: string): ClosedChannel[] {
  const objects = db
    .select({ key: discordObject.key, discordId: discordObject.discordId })
    .from(discordObject)
    .where(
      and(
        eq(discordObject.guildId, guildId),
        eq(discordObject.kind, 'match_channel'),
        eq(discordObject.createdByLigo, true),
      ),
    )
    .all()
    .flatMap((row) => {
      const id = MATCH_KEY.exec(row.key)?.[1];
      return id === undefined ? [] : [{ matchId: Number(id), channelId: row.discordId }];
    });
  if (objects.length === 0) return [];
  const ids = objects.map((object) => object.matchId);
  const closed = new Map(
    db
      .select({ id: match.id, seasonId: season.id })
      .from(match)
      .innerJoin(stage, eq(match.stageId, stage.id))
      .innerJoin(season, eq(stage.seasonId, season.id))
      .where(and(inArray(match.id, ids), eq(season.status, 'closed')))
      .all()
      .map((row) => [row.id, row.seasonId]),
  );
  const saved = new Set(
    db
      .select({ matchId: matchTranscript.matchId })
      .from(matchTranscript)
      .where(and(eq(matchTranscript.guildId, guildId), inArray(matchTranscript.matchId, ids)))
      .all()
      .map((row) => row.matchId),
  );
  return objects.flatMap((object) => {
    const seasonId = closed.get(object.matchId);
    return seasonId === undefined || saved.has(object.matchId) ? [] : [{ ...object, seasonId }];
  });
}

/** The match channels Ligo still holds whose transcript is saved: the reconciler may delete them. */
export function releasedChannels(
  db: Reader,
  guildId: string,
): { kind: ChannelKind; key: string }[] {
  const held = new Set(
    db
      .select({ key: discordObject.key })
      .from(discordObject)
      .where(and(eq(discordObject.guildId, guildId), eq(discordObject.kind, 'match_channel')))
      .all()
      .map((row) => row.key),
  );
  return db
    .select({ matchId: matchTranscript.matchId })
    .from(matchTranscript)
    .where(eq(matchTranscript.guildId, guildId))
    .orderBy(matchTranscript.matchId)
    .all()
    .map((row) => matchChannelKey(row.matchId))
    .filter((key) => held.has(key))
    .map((key) => ({ kind: 'match_channel' as const, key }));
}

export interface TranscriptRun {
  saved: number;
  failures: { matchId: number; message: string }[];
}

/**
 * Saves the transcript of each match channel of a closed season, one after the other. A channel
 * deleted by hand has nothing left to save: the reconciler forgets it. A channel Discord refuses
 * to read stays, and the next run tries again.
 */
export async function saveTranscripts(
  deps: {
    db: Db;
    gateway: Pick<DiscordGateway, 'channelMessages'>;
    transcripts: TranscriptStore;
    now(): number;
  },
  guildId: string,
): Promise<TranscriptRun> {
  const run: TranscriptRun = { saved: 0, failures: [] };
  for (const channel of channelsToSave(deps.db, guildId)) {
    try {
      const history = await deps.gateway.channelMessages(
        channel.channelId,
        TRANSCRIPT_MESSAGE_LIMIT,
      );
      if (!history) continue;
      const savedAt = deps.now();
      const key = transcriptKey(channel.seasonId, channel.matchId);
      const json = JSON.stringify({
        format: FORMAT,
        guildId,
        channelId: channel.channelId,
        channelName: history.name,
        matchId: channel.matchId,
        seasonId: channel.seasonId,
        savedAt,
        truncated: history.truncated,
        messages: history.messages,
      });
      await deps.transcripts.put(key, json);
      deps.db
        .insert(matchTranscript)
        .values({
          guildId,
          matchId: channel.matchId,
          channelId: channel.channelId,
          storageKey: key,
          messageCount: history.messages.length,
          savedAt,
        })
        .run();
      run.saved += 1;
    } catch (error) {
      run.failures.push({
        matchId: channel.matchId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return run;
}
