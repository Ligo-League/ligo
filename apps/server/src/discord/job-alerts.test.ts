import { claimJob, enqueueJob, failJob, type Db, schema } from '@ligo/db';
import { describe, expect, it, vi } from 'vitest';
import { leagueDatabase } from '../testing.ts';
import { tick } from './clock.ts';
import { fakeGateway } from './testing.ts';

// A job the worker could not finish after three attempts (design doc section 8, "Server jobs"):
// the server tells league staff in the staff queue, once. Only the server talks to Discord.

const QUEUE = '400000000000000001';
const MINUTE = 60_000;

/** Fails a job for good: three claims and three failures. */
function failForGood(
  db: Db,
  kind: 'verify_replay' | 'stitch_game',
  payload: Record<string, unknown>,
) {
  const id = enqueueJob(db, { kind, payload }, 0);
  for (const now of [0, MINUTE, 6 * MINUTE]) {
    claimJob(db, now);
    failJob(db, id, 'R2 answered 503', now);
  }
  return id;
}

function setup() {
  const db = leagueDatabase();
  db.update(schema.leagueGuild).set({ alertsChannelId: QUEUE }).run();
  const gateway = fakeGateway();
  const logger = { error: vi.fn() };
  const run = () =>
    tick({
      db,
      gateway,
      logger,
      locale: 'fr',
      publicUrl: new URL('https://ligoleague.eu'),
      now: () => 10 * MINUTE,
    });
  return { db, gateway, logger, run };
}

describe('failed jobs on the clock', () => {
  it('tells staff once, in the staff queue, with the match’s page', async () => {
    const { db, gateway, run } = setup();
    const id = failForGood(db, 'stitch_game', { matchId: 1 });
    await run();
    expect(gateway.posted).toHaveLength(1);
    expect(gateway.posted[0]?.channelId).toBe(QUEUE);
    const content = gateway.posted[0]?.message.content ?? '';
    expect(content).toContain('assembler les replays');
    expect(content).toContain('https://ligoleague.eu/matches/1');
    expect(content).toContain('R2 answered 503');
    expect(db.select().from(schema.job).get()?.alertedAt).toBe(10 * MINUTE);
    await run();
    expect(gateway.posted).toHaveLength(1);
    expect(id).toBe(1);
  });

  it('finds the match of a replay file’s job', async () => {
    const { db, gateway, run } = setup();
    const org = db.select().from(schema.org).get();
    if (!org) throw new Error('no organisation');
    const uploader = db
      .insert(schema.player)
      .values({ orgId: org.id, slug: 'uploader', displayName: 'Uploader', createdAt: 0 })
      .returning()
      .get();
    const file = db
      .insert(schema.replayFile)
      .values({
        matchId: 3,
        uploaderPlayerId: uploader.id,
        title: 'r6',
        fileName: 'Match-R01.rec',
        size: 10,
        sha256: 'ab'.repeat(32),
        lobbyId: 'L1',
        unitNumber: 0,
        parserVersion: 'r6-0123456789abcdef',
        parsedJson: {},
        createdAt: 0,
      })
      .returning()
      .get();
    failForGood(db, 'verify_replay', { fileId: file.id });
    await run();
    expect(gateway.posted[0]?.message.content).toContain('vérifier un replay');
    expect(gateway.posted[0]?.message.content).toContain('/matches/3');
  });

  it('tries again on the next tick when Discord refused the post', async () => {
    const { db, gateway, logger, run } = setup();
    failForGood(db, 'stitch_game', { matchId: 1 });
    gateway.failing = true;
    await run();
    expect(db.select().from(schema.job).get()?.alertedAt).toBeNull();
    expect(logger.error).toHaveBeenCalled();
    gateway.failing = false;
    await run();
    expect(gateway.posted).toHaveLength(1);
  });

  it('logs a failure it has nowhere to post, and does not try again', async () => {
    const { db, gateway, logger, run } = setup();
    db.update(schema.leagueGuild).set({ alertsChannelId: null }).run();
    failForGood(db, 'stitch_game', { matchId: 1 });
    await run();
    expect(gateway.posted).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 1 }),
      'A job failed and the league has no staff queue',
    );
    expect(db.select().from(schema.job).get()?.alertedAt).toBe(10 * MINUTE);
  });
});
