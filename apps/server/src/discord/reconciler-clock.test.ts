import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fakeTranscriptStore } from '../assets/transcript-store.ts';
import { leagueDatabase, TEST_GUILD } from '../testing.ts';
import { syncManagedLeagues } from './reconciler-clock.ts';
import { fakeGateway } from './testing.ts';

// The reconciler's own runs (design doc section 6): once the bot is connected, then every few
// minutes, for every league that lets Ligo manage its server. A failure is logged, never thrown.

const NOW = 1_800_000_000_000;
const SITE = new URL('https://ligoleague.eu');

function setUp(manage: boolean) {
  const db = leagueDatabase();
  const row = db.select().from(schema.competition).get();
  if (!row) throw new Error('set up');
  db.update(schema.competition)
    .set({ rulesetJson: { ...row.rulesetJson, discord: { ...row.rulesetJson.discord, manage } } })
    .run();
  const gateway = fakeGateway();
  gateway.snapshots.set(TEST_GUILD, {
    everyoneId: TEST_GUILD,
    roles: [],
    categories: [],
    channels: [],
    members: [],
  });
  const logged: { level: string; details: object; message: string }[] = [];
  const logger = {
    info: (details: object, message: string) => logged.push({ level: 'info', details, message }),
    warn: (details: object, message: string) => logged.push({ level: 'warn', details, message }),
    error: (details: object, message: string) => logged.push({ level: 'error', details, message }),
  };
  // How many times the server was read.
  let snapshots = 0;
  const read = gateway.guildSnapshot.bind(gateway);
  gateway.guildSnapshot = (id) => {
    snapshots += 1;
    return read(id);
  };
  return { db, gateway, logger, logged, snapshots: () => snapshots };
}

describe('syncManagedLeagues', () => {
  it('leaves a league that does not let Ligo manage its server alone', async () => {
    const { db, gateway, logger, logged, snapshots } = setUp(false);
    await syncManagedLeagues({
      db,
      gateway,
      logger,
      locale: 'fr' as const,
      publicUrl: SITE,
      transcripts: fakeTranscriptStore(),
      now: () => NOW,
    });
    expect(snapshots()).toBe(0);
    expect(logged).toEqual([]);
  });

  it('syncs a managed league’s server', async () => {
    const { db, gateway, logger, logged, snapshots } = setUp(true);
    await syncManagedLeagues({
      db,
      gateway,
      logger,
      locale: 'fr' as const,
      publicUrl: SITE,
      transcripts: fakeTranscriptStore(),
      now: () => NOW,
    });
    expect(snapshots()).toBe(1);
    expect(logged.filter((line) => line.level !== 'info')).toEqual([]);
  });

  it('logs a sync Discord could not answer, and never throws', async () => {
    const { db, gateway, logger, logged } = setUp(true);
    gateway.failing = true;
    await expect(
      syncManagedLeagues({
        db,
        gateway,
        logger,
        locale: 'fr' as const,
        publicUrl: SITE,
        transcripts: fakeTranscriptStore(),
        now: () => NOW,
      }),
    ).resolves.toBeUndefined();
    expect(logged).toEqual([
      {
        level: 'warn',
        details: { competitionId: 1, error: 'discord_unavailable' },
        message: 'League server sync did not run',
      },
    ]);
  });
});

describe('the quick check between full runs', () => {
  it('syncs a league only once its wanted state changed', async () => {
    const { db, gateway, logger, snapshots } = setUp(true);
    const deps = {
      db,
      gateway,
      logger,
      locale: 'fr' as const,
      publicUrl: SITE,
      transcripts: fakeTranscriptStore(),
      now: () => NOW,
    };
    const last = new Map<number, string>();
    await syncManagedLeagues(deps, last, true);
    expect(snapshots()).toBe(1);
    await syncManagedLeagues(deps, last, true);
    expect(snapshots()).toBe(1);
    // A team withdraws: its role is no longer wanted.
    db.update(schema.slot).set({ status: 'withdrawn' }).where(eq(schema.slot.teamId, 1)).run();
    await syncManagedLeagues(deps, last, true);
    expect(snapshots()).toBe(2);
    // A full run syncs anyway, to put right what was changed by hand in Discord.
    await syncManagedLeagues(deps, last);
    expect(snapshots()).toBe(3);
  });
});

describe('control messages from the clock', () => {
  it('posts and pins the control message in a match channel the sync just made', async () => {
    const { db, gateway, logger } = setUp(true);
    await syncManagedLeagues({
      db,
      gateway,
      logger,
      locale: 'fr',
      publicUrl: SITE,
      transcripts: fakeTranscriptStore(),
      now: () => NOW,
    });
    const channel = gateway.snapshots.get(TEST_GUILD)?.channels[0];
    expect(channel?.name).toBe('w3-brv-cha');
    expect(gateway.posted.map((post) => post.channelId)).toEqual([channel?.id]);
    expect(gateway.pinned).toHaveLength(1);
  });
});
