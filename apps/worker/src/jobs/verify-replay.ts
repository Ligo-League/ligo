import { isDeepStrictEqual } from 'node:util';
import { enqueueJob, schema, type Db } from '@ligo/db';
import { DEFAULT_MAX_FILE_BYTES, sha256Hex, type Parser } from '@ligo/parsers';
import type { ObjectStore } from '@ligo/storage';
import { normalizeR6 } from '@ligo/titles';
import { eq } from 'drizzle-orm';

// `verify_replay` (design doc section 8, trust model 3): the JSON a browser sent is untrusted
// until the server re-parses the raw file with the same build and normalises it the same way.
// - The same reading: `verified`.
// - Another reading: `mismatch` for staff, and the server's reading replaces the browser's, so
//   stitching never counts a forged round. The game is stitched again.
// - A browser on an older build: the server's reading replaces it, `verified`.
// - A raw file that is not the one hashed, or that the parser refuses: `mismatch`.
// A raw file not stored yet, or a parser stopped (time, memory), throws: the job runs again.

const { competition, match, replayFile, season, stage } = schema;

export interface VerifyDeps {
  db: Db;
  objects: ObjectStore;
  parser: Parser;
  now: () => number;
}

function tradeWindowOf(db: Db, matchId: number): number {
  const found = db
    .select({ ruleset: competition.rulesetJson })
    .from(match)
    .innerJoin(stage, eq(match.stageId, stage.id))
    .innerJoin(season, eq(stage.seasonId, season.id))
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .where(eq(match.id, matchId))
    .get();
  if (!found) throw new Error(`Match ${String(matchId)} has no competition`);
  return found.ruleset.replays.trade_window_s;
}

export async function verifyReplay(
  deps: VerifyDeps,
  payload: Record<string, unknown>,
): Promise<void> {
  const { db } = deps;
  if (typeof payload.fileId !== 'number') throw new Error('verify_replay needs a fileId');
  const file = db.select().from(replayFile).where(eq(replayFile.id, payload.fileId)).get();
  // A file removed since (a duplicate, staff): nothing to verify.
  if (!file) return;
  const setVerified = (verified: 'verified' | 'mismatch') => {
    db.update(replayFile).set({ verified }).where(eq(replayFile.id, file.id)).run();
  };

  if (file.rawStatus !== 'stored' || file.rawKey === null) {
    throw new Error('The raw file is not stored yet');
  }
  const bytes = await deps.objects.get(file.rawKey, DEFAULT_MAX_FILE_BYTES);
  if (!bytes) throw new Error('The raw file is missing from storage');
  if ((await sha256Hex(bytes)) !== file.sha256) {
    setVerified('mismatch');
    return;
  }

  const outcome = await deps.parser.parse(bytes);
  if (!outcome.ok) {
    if (outcome.error === 'not_a_replay' || outcome.error === 'parse_failed') {
      setVerified('mismatch');
      return;
    }
    throw new Error(`${outcome.error}: ${outcome.message}`);
  }
  const unit = normalizeR6(JSON.parse(outcome.json) as unknown, {
    parser: deps.parser.version,
    fileSha256: file.sha256,
    tradeWindowS: tradeWindowOf(db, file.matchId),
  });
  if (!unit.ok) {
    setVerified('mismatch');
    return;
  }

  const sameBuild = file.parserVersion === deps.parser.version;
  if (sameBuild && isDeepStrictEqual(unit.unit, file.parsedJson)) {
    setVerified('verified');
    return;
  }
  db.transaction((tx) => {
    tx.update(replayFile)
      .set({
        parsedJson: unit.unit as unknown as Record<string, unknown>,
        parserVersion: deps.parser.version,
        verified: sameBuild ? 'mismatch' : 'verified',
      })
      .where(eq(replayFile.id, file.id))
      .run();
    enqueueJob(tx, { kind: 'stitch_game', payload: { matchId: file.matchId } }, deps.now());
  });
}
