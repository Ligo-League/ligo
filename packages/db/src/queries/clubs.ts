import { asc, eq } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { club, team } from '../schema/index.ts';

// Clubs and their rosters (design doc section 4, "Clubs and rosters"). A roster wears its own
// colours and logo when it has them, its club's otherwise.

export interface ClubRef {
  id: number;
  name: string;
  slug: string;
}

export interface Roster {
  teamId: number;
  name: string;
  tag: string;
  slug: string;
  colors: string[];
  logoKey: string | null;
  club: ClubRef;
}

const rosterColumns = {
  teamId: team.id,
  name: team.name,
  tag: team.tag,
  slug: team.slug,
  colors: team.colorsJson,
  logoKey: team.logoKey,
  clubColors: club.colorsJson,
  clubLogoKey: club.logoKey,
  clubId: club.id,
  clubName: club.name,
  clubSlug: club.slug,
};

interface RosterRow {
  teamId: number;
  name: string;
  tag: string;
  slug: string;
  colors: string[] | null;
  logoKey: string | null;
  clubColors: string[];
  clubLogoKey: string | null;
  clubId: number;
  clubName: string;
  clubSlug: string;
}

function rosterOf(row: RosterRow): Roster {
  const { clubColors, clubLogoKey, clubId, clubName, clubSlug, ...own } = row;
  return {
    ...own,
    colors: own.colors ?? clubColors,
    logoKey: own.logoKey ?? clubLogoKey,
    club: { id: clubId, name: clubName, slug: clubSlug },
  };
}

/** A roster by its ID or its URL slug, with the look it wears and its club. */
export function findRoster(
  db: Pick<Db, 'select'>,
  by: { teamId: number } | { slug: string },
): Roster | undefined {
  const row = db
    .select(rosterColumns)
    .from(team)
    .innerJoin(club, eq(team.clubId, club.id))
    .where('teamId' in by ? eq(team.id, by.teamId) : eq(team.slug, by.slug))
    .orderBy(asc(team.id))
    .get();
  return row ? rosterOf(row) : undefined;
}

/** A club by its URL slug. */
export function findClub(db: Pick<Db, 'select'>, slug: string) {
  return db.select().from(club).where(eq(club.slug, slug)).orderBy(asc(club.id)).get();
}

/** A club's rosters, by name. */
export function listClubRosters(db: Pick<Db, 'select'>, clubId: number): Roster[] {
  return db
    .select(rosterColumns)
    .from(team)
    .innerJoin(club, eq(team.clubId, club.id))
    .where(eq(team.clubId, clubId))
    .orderBy(asc(team.name), asc(team.id))
    .all()
    .map(rosterOf);
}
