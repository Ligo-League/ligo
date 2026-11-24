import { schema, type Db } from '@ligo/db';
import { openTestDatabase, seedLfr, seedMatches } from '@ligo/db/testing';

// A small league for the worker's tests: LFR's rules, Ligue 1 with Alpha (ALP) and Bravo (BRV),
// and their match, number 1, still to play.

const team = (tag: string, name: string) => ({
  division: 'Ligue 1',
  name,
  tag,
  slug: name.toLowerCase(),
  city: null,
  colors: ['#112233', '#FFFFFF'],
});

export function workerDatabase(): { db: Db; matchId: number; uploaderId: number } {
  const db = openTestDatabase();
  seedLfr(db, [team('ALP', 'Alpha'), team('BRV', 'Bravo')], 1_000);
  seedMatches(
    db,
    [{ division: 'Ligue 1', week: 1, teamA: 'ALP', teamB: 'BRV', result: { kind: 'none' } }],
    2_000,
  );
  const org = db.select().from(schema.org).get();
  const found = db.select().from(schema.match).get();
  if (!org || !found) throw new Error('The seed made no organisation or match');
  const uploader = db
    .insert(schema.player)
    .values({ orgId: org.id, slug: 'uploader', displayName: 'Uploader', createdAt: 0 })
    .returning()
    .get();
  return { db, matchId: found.id, uploaderId: uploader.id };
}
