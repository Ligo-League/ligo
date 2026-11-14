import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { team } from '../schema/index.ts';
import type { TeamRow } from '../seed/parse-teams-csv.ts';
import { seedLfr } from '../seed/seed-lfr.ts';
import { openTestDatabase } from '../testing.ts';
import { findClub, findRoster, listClubRosters } from './clubs.ts';

const row = (name: string, tag: string, colors: string[], club: string | null): TeamRow => ({
  division: 'Ligue 2',
  name,
  tag,
  slug: name.toLowerCase().replaceAll(' ', '-'),
  city: null,
  colors,
  logo: 'nova',
  club,
});

function nova() {
  const db = openTestDatabase();
  // Season 3's Nova: two rosters, the second in colours of its own.
  seedLfr(
    db,
    [
      row('Nova 1 Esport', 'NOVA1', ['#800080', '#000000'], 'Nova Esport'),
      row('Nova 2 Esport', 'NOVA2', ['#FFFFFF', '#800080'], 'Nova Esport'),
    ],
    1000,
  );
  return db;
}

describe('findRoster', () => {
  it('wears its club’s look unless it has its own', () => {
    const db = nova();
    expect(findRoster(db, { slug: 'nova-1-esport' })).toEqual({
      teamId: 1,
      name: 'Nova 1 Esport',
      tag: 'NOVA1',
      slug: 'nova-1-esport',
      colors: ['#800080', '#000000'],
      logoKey: 'logos/nova.png',
      club: { id: 1, name: 'Nova Esport', slug: 'nova-esport' },
    });
    expect(findRoster(db, { teamId: 2 })).toMatchObject({
      colors: ['#FFFFFF', '#800080'],
      logoKey: 'logos/nova.png',
    });
    db.update(team).set({ logoKey: 'logos/nova2.png' }).where(eq(team.id, 2)).run();
    expect(findRoster(db, { teamId: 2 })?.logoKey).toBe('logos/nova2.png');
    expect(findRoster(db, { slug: 'zulu' })).toBeUndefined();
  });
});

describe('clubs', () => {
  it('find a club by its slug, and list its rosters by name', () => {
    const db = nova();
    expect(findClub(db, 'nova-esport')).toMatchObject({ id: 1, name: 'Nova Esport' });
    expect(findClub(db, 'zulu')).toBeUndefined();
    expect(listClubRosters(db, 1).map((roster) => roster.tag)).toEqual(['NOVA1', 'NOVA2']);
  });
});
