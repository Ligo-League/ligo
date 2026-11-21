import { discordSettingsSchema, matchChannelKey, type GuildSnapshot } from '@ligo/core';
import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fakeTranscriptStore, transcriptKey } from '../assets/transcript-store.ts';
import { syncManagedLeagues } from '../discord/reconciler-clock.ts';
import type { ChannelMessage } from '../discord/gateway.ts';
import { fakeGateway } from '../discord/testing.ts';
import { leagueDatabase, TEST_GUILD } from '../testing.ts';
import { syncLeague } from './reconciler.ts';
import { channelsToSave, releasedChannels, saveTranscripts } from './transcripts.ts';

// Season end for match channels (phase 4; design doc section 6): in leagueDatabase(), match 3
// (Bravo v Charlie, Ligue 1 week 3) has a channel Ligo made, archived in its category.

const NOW = 1_800_000_000_000;
const CHANNEL = '800000000000000700';
const CATEGORY = '800000000000000701';
const SITE = new URL('https://ligoleague.eu');

const message = (id: string, content: string): ChannelMessage => ({
  id,
  author: { id: '222222222222222222', username: 'lea', bot: false },
  content,
  createdAt: NOW - 1000,
  editedAt: null,
  pinned: false,
  attachments: [{ name: 'score.png', size: 1234, contentType: 'image/png' }],
  embeds: [],
});

function setUp() {
  const db = leagueDatabase();
  const store = (kind: 'match_channel' | 'archive_category', key: string, discordId: string) =>
    db
      .insert(schema.discordObject)
      .values({ guildId: TEST_GUILD, kind, key, discordId, createdByLigo: true, createdAt: 1 })
      .run();
  store('match_channel', matchChannelKey(3), CHANNEL);
  store('archive_category', 'division:1:1', CATEGORY);
  const seasonId =
    db
      .select({ seasonId: schema.stage.seasonId })
      .from(schema.match)
      .innerJoin(schema.stage, eq(schema.match.stageId, schema.stage.id))
      .where(eq(schema.match.id, 3))
      .get()?.seasonId ?? 0;
  const close = () =>
    db.update(schema.season).set({ status: 'closed' }).where(eq(schema.season.id, seasonId)).run();
  const gateway = fakeGateway();
  gateway.histories.set(CHANNEL, {
    name: 'w3-brv-cha',
    messages: [message('1', 'On joue mardi ?'), message('2', 'Ok pour 21h')],
    truncated: false,
  });
  const transcripts = fakeTranscriptStore();
  const deps = { db, gateway, transcripts, now: () => NOW };
  const saved = () => db.select().from(schema.matchTranscript).all();
  return { db, gateway, transcripts, deps, seasonId, close, saved };
}

function server(): GuildSnapshot {
  return {
    everyoneId: TEST_GUILD,
    roles: [{ id: TEST_GUILD, name: '@everyone', color: null, mentionable: false }],
    categories: [{ id: CATEGORY, name: 'Archives · L1' }],
    channels: [{ id: CHANNEL, name: 'w3-brv-cha', parentId: CATEGORY, overwrites: [] }],
    members: [],
  };
}

function manage(db: ReturnType<typeof leagueDatabase>) {
  const row = db.select().from(schema.competition).get();
  if (!row) throw new Error('set up');
  db.update(schema.competition)
    .set({
      rulesetJson: { ...row.rulesetJson, discord: discordSettingsSchema.parse({ manage: true }) },
    })
    .run();
}

describe('saveTranscripts', () => {
  it('saves nothing while the season is not closed', async () => {
    const { deps, transcripts, saved } = setUp();
    expect(await saveTranscripts(deps, TEST_GUILD)).toEqual({ saved: 0, failures: [] });
    expect(transcripts.files.size).toBe(0);
    expect(saved()).toEqual([]);
  });

  it('saves a closed season’s channel as JSON, once, and lets it go', async () => {
    const { deps, transcripts, seasonId, close, saved, db } = setUp();
    close();
    expect(channelsToSave(db, TEST_GUILD)).toEqual([{ matchId: 3, seasonId, channelId: CHANNEL }]);
    expect(await saveTranscripts(deps, TEST_GUILD)).toEqual({ saved: 1, failures: [] });
    const key = transcriptKey(seasonId, 3);
    const file = JSON.parse(transcripts.files.get(key) ?? '{}') as Record<string, unknown>;
    expect(file).toMatchObject({
      format: 1,
      guildId: TEST_GUILD,
      channelId: CHANNEL,
      channelName: 'w3-brv-cha',
      matchId: 3,
      seasonId,
      savedAt: NOW,
      truncated: false,
    });
    expect(file['messages']).toHaveLength(2);
    expect(saved()).toMatchObject([{ matchId: 3, storageKey: key, messageCount: 2 }]);
    expect(releasedChannels(db, TEST_GUILD)).toEqual([
      { kind: 'match_channel', key: matchChannelKey(3) },
    ]);
    // Saved once: the next run has nothing left to read.
    expect(await saveTranscripts(deps, TEST_GUILD)).toEqual({ saved: 0, failures: [] });
  });

  it('skips a channel deleted by hand, which the sync forgets', async () => {
    const { deps, gateway, close, saved } = setUp();
    gateway.histories.clear();
    close();
    expect(await saveTranscripts(deps, TEST_GUILD)).toEqual({ saved: 0, failures: [] });
    expect(saved()).toEqual([]);
  });

  it('keeps the channel when Discord or the disk refuses, for the next run', async () => {
    const { deps, gateway, transcripts, close, saved, db } = setUp();
    close();
    gateway.failing = true;
    expect(await saveTranscripts(deps, TEST_GUILD)).toMatchObject({
      saved: 0,
      failures: [{ matchId: 3 }],
    });
    gateway.failing = false;
    transcripts.failing = true;
    expect(await saveTranscripts(deps, TEST_GUILD)).toMatchObject({
      saved: 0,
      failures: [{ matchId: 3 }],
    });
    expect(saved()).toEqual([]);
    expect(releasedChannels(db, TEST_GUILD)).toEqual([]);
  });

  it('leaves a channel Ligo did not make', async () => {
    const { deps, db, close } = setUp();
    db.update(schema.discordObject)
      .set({ createdByLigo: false })
      .where(eq(schema.discordObject.discordId, CHANNEL))
      .run();
    close();
    expect(await saveTranscripts(deps, TEST_GUILD)).toEqual({ saved: 0, failures: [] });
  });
});

describe('the sync at season end', () => {
  it('keeps a closed season’s channel until its transcript is saved, then deletes it', async () => {
    const { db, gateway, deps, close } = setUp();
    manage(db);
    const guild = server();
    gateway.snapshots.set(TEST_GUILD, guild);
    close();
    const options = { dryRun: false, now: NOW, actorPlayerId: null };
    await syncLeague(db, gateway, 1, options);
    expect(guild.channels.map((channel) => channel.id)).toEqual([CHANNEL]);
    await saveTranscripts(deps, TEST_GUILD);
    expect(await syncLeague(db, gateway, 1, options)).toMatchObject({ ok: true, failures: [] });
    expect(guild.channels).toEqual([]);
    // Its archive category, empty now, goes with it.
    expect(guild.categories).toEqual([]);
    expect(releasedChannels(db, TEST_GUILD)).toEqual([]);
  });

  it('saves and deletes in one run of the clock', async () => {
    const { db, gateway, transcripts, close, seasonId } = setUp();
    manage(db);
    const guild = server();
    gateway.snapshots.set(TEST_GUILD, guild);
    close();
    const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
    await syncManagedLeagues({
      db,
      gateway,
      logger,
      locale: 'fr',
      publicUrl: SITE,
      transcripts,
      now: () => NOW,
    });
    expect(transcripts.files.has(transcriptKey(seasonId, 3))).toBe(true);
    expect(guild.channels).toEqual([]);
    expect(gateway.changes.map((entry) => entry.change.kind)).toContain('delete_channel');
  });
});
