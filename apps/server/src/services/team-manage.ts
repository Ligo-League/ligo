import { findRoster, schema, type Db } from '@ligo/db';
import { and, desc, eq, ne } from 'drizzle-orm';

// `/teams/:slug/manage`: the website's `/team`, for one roster. It acts in the league the roster
// plays in now, as `/team` does in that league's Discord server.

export interface ManagedRoster {
  teamId: number;
  name: string;
  tag: string;
  slug: string;
  /** The competition of the latest season the roster has a place in, registration aside. */
  competitionId: number;
}

/**
 * The roster of that slug and the competition it plays in, or null when there is none. A roster
 * whose only place is in a season still in registration has no league to act in yet: `/team`
 * acts on the league's current season.
 */
export function rosterToManage(db: Pick<Db, 'select'>, slug: string): ManagedRoster | null {
  const roster = findRoster(db, { slug });
  if (!roster) return null;
  const { division, season, slot } = schema;
  const place = db
    .select({ competitionId: season.competitionId })
    .from(slot)
    .innerJoin(division, eq(slot.divisionId, division.id))
    .innerJoin(season, eq(division.seasonId, season.id))
    .where(and(eq(slot.teamId, roster.teamId), ne(season.status, 'registration')))
    .orderBy(desc(season.startsOn), desc(season.id))
    .get();
  if (!place) return null;
  return {
    teamId: roster.teamId,
    name: roster.name,
    tag: roster.tag,
    slug: roster.slug,
    competitionId: place.competitionId,
  };
}
