import { schema, type Db } from '@ligo/db';
import { and, asc, eq } from 'drizzle-orm';
import { competitionPath } from './paths.ts';

// Finding a competition from its address, `/:org/:comp`: a competition slug is unique within its
// organisation only.

const { competition, org } = schema;

/** The two slugs of a competition's address. */
export interface CompetitionKey {
  org: string;
  competition: string;
}

export type FoundCompetition = typeof competition.$inferSelect & {
  orgSlug: string;
  /** Its address, `/:org/:comp`. */
  path: string;
};

const found = (row: { competition: typeof competition.$inferSelect; orgSlug: string }) => ({
  ...row.competition,
  orgSlug: row.orgSlug,
  path: competitionPath(row.orgSlug, row.competition.slug),
});

const withOrg = (db: Pick<Db, 'select'>) =>
  db
    .select({ competition, orgSlug: org.slug })
    .from(competition)
    .innerJoin(org, eq(competition.orgId, org.id));

/** The competition an address names, or undefined. */
export function findCompetitionAt(
  db: Pick<Db, 'select'>,
  key: CompetitionKey,
): FoundCompetition | undefined {
  const row = withOrg(db)
    .where(and(eq(org.slug, key.org), eq(competition.slug, key.competition)))
    .get();
  return row && found(row);
}

/** A competition by its ID, with its address. */
export function findCompetitionById(
  db: Pick<Db, 'select'>,
  competitionId: number,
): FoundCompetition | undefined {
  const row = withOrg(db).where(eq(competition.id, competitionId)).get();
  return row && found(row);
}

/**
 * The competition an old address, `/c/:comp`, meant: the first with that slug. Such addresses
 * were made when one organisation held every league; they now redirect.
 */
export function findLegacyCompetition(
  db: Pick<Db, 'select'>,
  competitionSlug: string,
): FoundCompetition | undefined {
  const row = withOrg(db)
    .where(eq(competition.slug, competitionSlug))
    .orderBy(asc(competition.id))
    .get();
  return row && found(row);
}
