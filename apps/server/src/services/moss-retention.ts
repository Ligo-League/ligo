import { schema, type Db } from '@ligo/db';
import type { ObjectStore } from '@ligo/storage';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';

// MOSS files are kept only in case of suspected cheating (M-47, maintainer 20 November 2026):
// every file of a season goes when staff close it, or earlier, `moss.retention_days` after its
// upload when the league sets it (null by default). Files of a match staff hold stay until they
// release them. The row stays with `deleted_at`: what was sent, and when, is still known.

const { auditLog, competition, evidence, match, season, stage } = schema;

const DAY = 86_400_000;
/** Files deleted per tick: a season's close spreads over a few minutes. */
const BATCH = 50;

export interface DueFile {
  id: number;
  matchId: number;
  key: string;
  why: 'season_closed' | 'retention';
}

/** The MOSS files to delete now, oldest first. */
export function dueMossFiles(db: Pick<Db, 'select'>, now: number): DueFile[] {
  const rows = db
    .select({
      id: evidence.id,
      matchId: evidence.matchId,
      key: evidence.objectKey,
      at: evidence.at,
      seasonStatus: season.status,
      ruleset: competition.rulesetJson,
    })
    .from(evidence)
    .innerJoin(match, eq(evidence.matchId, match.id))
    .innerJoin(stage, eq(match.stageId, stage.id))
    .innerJoin(season, eq(stage.seasonId, season.id))
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .where(
      and(
        eq(evidence.kind, 'moss'),
        isNull(evidence.deletedAt),
        isNotNull(evidence.objectKey),
        isNull(match.mossHeldAt),
      ),
    )
    .orderBy(evidence.at, evidence.id)
    .all();
  const due: DueFile[] = [];
  for (const row of rows) {
    if (row.key === null) continue;
    const days = row.ruleset.moss.retention_days;
    const why =
      row.seasonStatus === 'closed'
        ? 'season_closed'
        : days !== null && row.at + days * DAY <= now
          ? 'retention'
          : null;
    if (why) due.push({ id: row.id, matchId: row.matchId, key: row.key, why });
    if (due.length >= BATCH) break;
  }
  return due;
}

/**
 * Deletes the files due: each from storage first, then marked deleted, with one audit row per
 * match. A file storage could not delete is tried again on the next tick.
 */
export async function deleteDueMoss(
  db: Db,
  objects: ObjectStore,
  now: number,
  onError: (details: object) => void,
): Promise<number> {
  const deleted: DueFile[] = [];
  for (const file of dueMossFiles(db, now)) {
    try {
      await objects.delete(file.key);
      deleted.push(file);
    } catch {
      onError({ evidenceId: file.id });
    }
  }
  if (deleted.length === 0) return 0;
  db.transaction((tx) => {
    const byMatch = new Map<number, DueFile[]>();
    for (const file of deleted) {
      tx.update(evidence)
        .set({ deletedAt: now })
        .where(and(eq(evidence.id, file.id), isNull(evidence.deletedAt)))
        .run();
      byMatch.set(file.matchId, [...(byMatch.get(file.matchId) ?? []), file]);
    }
    for (const [matchId, files] of byMatch) {
      tx.insert(auditLog)
        .values({
          actorKind: 'system',
          action: 'match.moss_delete',
          entity: 'match',
          entityId: String(matchId),
          afterJson: { evidenceIds: files.map((f) => f.id), why: files[0]?.why ?? 'retention' },
          at: now,
        })
        .run();
    }
  });
  return deleted.length;
}
