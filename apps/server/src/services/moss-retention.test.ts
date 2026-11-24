import { schema, type Db } from '@ligo/db';
import { fakeObjectStore } from '@ligo/storage';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { leagueDatabase, playedMatch } from '../testing.ts';
import { deleteDueMoss, dueMossFiles } from './moss-retention.ts';

// MOSS files are kept only in case of suspected cheating (M-47): deleted at the season's close,
// or `moss.retention_days` after their upload, unless staff hold the match's files.

const DAY = 86_400_000;

async function setup() {
  const db = leagueDatabase();
  playedMatch(db, 3, true);
  const objects = fakeObjectStore();
  for (const row of db.select().from(schema.evidence).all()) {
    await objects.put(row.objectKey ?? '', new Uint8Array(1), 'application/octet-stream');
  }
  return { db, objects };
}

const setRetention = (db: Db, days: number | null) => {
  for (const row of db.select().from(schema.competition).all()) {
    db.update(schema.competition)
      .set({
        rulesetJson: {
          ...row.rulesetJson,
          moss: { ...row.rulesetJson.moss, retention_days: days },
        },
      })
      .where(eq(schema.competition.id, row.id))
      .run();
  }
};
const closeSeason = (db: Db) => {
  db.update(schema.season).set({ status: 'closed' }).run();
};
const kept = (db: Db) =>
  db
    .select()
    .from(schema.evidence)
    .all()
    .filter((row) => row.deletedAt === null);

describe('MOSS retention', () => {
  it('keeps every file while the season runs and the league sets no retention', async () => {
    const { db } = await setup();
    expect(dueMossFiles(db, 1000 * DAY)).toEqual([]);
  });

  it('deletes a season’s files once it is closed, keeping the rows, with an audit row per match', async () => {
    const { db, objects } = await setup();
    closeSeason(db);
    expect(await deleteDueMoss(db, objects, 5, vi.fn())).toBe(10);
    expect(objects.objects.size).toBe(0);
    expect(kept(db)).toEqual([]);
    expect(db.select().from(schema.evidence).all()).toHaveLength(10);
    const audit = db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'match.moss_delete'))
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorKind: 'system', afterJson: { why: 'season_closed' } });
  });

  it('deletes a file the league’s retention days after its upload', async () => {
    const { db, objects } = await setup();
    setRetention(db, 30);
    expect(await deleteDueMoss(db, objects, 30 * DAY - 1, vi.fn())).toBe(0);
    expect(await deleteDueMoss(db, objects, 30 * DAY, vi.fn())).toBe(10);
  });

  it('keeps the files of a match staff hold, until they release them', async () => {
    const { db, objects } = await setup();
    closeSeason(db);
    db.update(schema.match)
      .set({ mossHeldAt: 1, mossHoldReason: 'Enquête' })
      .where(eq(schema.match.id, 3))
      .run();
    expect(await deleteDueMoss(db, objects, 5, vi.fn())).toBe(0);
    expect(objects.objects.size).toBe(10);
    db.update(schema.match).set({ mossHeldAt: null, mossHoldReason: null }).run();
    expect(await deleteDueMoss(db, objects, 6, vi.fn())).toBe(10);
  });

  it('tries again next time when storage could not delete a file', async () => {
    const { db, objects } = await setup();
    closeSeason(db);
    const onError = vi.fn();
    objects.delete = () => Promise.reject(new Error('R2 answered 503'));
    expect(await deleteDueMoss(db, objects, 5, onError)).toBe(0);
    expect(onError).toHaveBeenCalledTimes(10);
    expect(kept(db)).toHaveLength(10);
  });
});
