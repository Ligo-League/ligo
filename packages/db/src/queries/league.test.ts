import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLog, leagueGuild, season } from '../schema/index.ts';
import { linkGuild } from '../seed/link-guild.ts';
import type { TeamRow } from '../seed/parse-teams-csv.ts';
import { seedLfr } from '../seed/seed-lfr.ts';
import { seedMatches } from '../seed/seed-matches.ts';
import { openTestDatabase } from '../testing.ts';
import { findGuildLeague } from './league.ts';

const GUILD = '876543210987654321';
const STAFF_ROLE = '111111111111111111';
const TEAMS: TeamRow[] = [
  { division: 'Ligue 2', name: 'Bravo', tag: 'BRV', slug: 'bravo', city: null, colors: [] },
  { division: 'Ligue 1', name: 'Alpha', tag: 'ALP', slug: 'alpha', city: null, colors: [] },
];

function seeded() {
  const db = openTestDatabase();
  seedLfr(db, TEAMS, 1000);
  return db;
}

describe('linkGuild', () => {
  it('maps the server to the LFR competition and audits it', () => {
    const db = seeded();
    expect(linkGuild(db, { guildId: GUILD, staffRoleId: STAFF_ROLE }, 2000)).toBe('created');
    expect(db.select().from(leagueGuild).all()).toMatchObject([
      { guildId: GUILD, orgId: 1, competitionId: 1, staffRoleId: STAFF_ROLE },
    ]);
    expect(
      db.select().from(auditLog).where(eq(auditLog.action, 'seed.guild.link')).all(),
    ).toMatchObject([{ actorKind: 'system', entity: 'league_guild', entityId: GUILD, at: 2000 }]);
  });

  it('changes nothing when run again, and updates a changed staff role', () => {
    const db = seeded();
    linkGuild(db, { guildId: GUILD, staffRoleId: STAFF_ROLE }, 2000);
    expect(linkGuild(db, { guildId: GUILD, staffRoleId: STAFF_ROLE }, 3000)).toBe('unchanged');
    expect(linkGuild(db, { guildId: GUILD, staffRoleId: '222222222222222222' }, 4000)).toBe(
      'updated',
    );
    expect(db.select().from(leagueGuild).all()).toMatchObject([
      { guildId: GUILD, staffRoleId: '222222222222222222' },
    ]);
    expect(
      db.select().from(auditLog).where(eq(auditLog.action, 'seed.guild.link')).all(),
    ).toHaveLength(2);
  });

  it('refuses to run before the competition exists', () => {
    expect(() =>
      linkGuild(openTestDatabase(), { guildId: GUILD, staffRoleId: STAFF_ROLE }, 1),
    ).toThrow(/no competition/);
  });
});

describe('findGuildLeague', () => {
  it('finds nothing for a server that is not linked', () => {
    expect(findGuildLeague(seeded(), GUILD)).toBeUndefined();
  });

  it('returns the competition, the current season and its divisions by level', () => {
    const db = seeded();
    linkGuild(db, { guildId: GUILD, staffRoleId: STAFF_ROLE }, 2000);
    seedMatches(db, [], 2000);

    expect(findGuildLeague(db, GUILD)).toMatchObject({
      guild: { staffRoleId: STAFF_ROLE },
      org: { slug: 'lfr', locale: 'fr' },
      competition: { slug: 'lfr', title: 'r6' },
      season: { name: 'Saison 3', status: 'active' },
      divisions: [
        { division: { name: 'Ligue 1', level: 1 }, stageId: 1 },
        { division: { name: 'Ligue 2', level: 2 }, stageId: 2 },
      ],
    });
  });

  it('leaves the stage undefined for a division that has none yet', () => {
    const db = seeded();
    linkGuild(db, { guildId: GUILD, staffRoleId: STAFF_ROLE }, 2000);
    expect(findGuildLeague(db, GUILD)?.divisions.map((entry) => entry.stageId)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('prefers the latest season that has left registration', () => {
    const db = seeded();
    linkGuild(db, { guildId: GUILD, staffRoleId: STAFF_ROLE }, 2000);
    const settingsJson = { forfeit_score: [0, 0] as [number, number], map_pool: [] };
    const base = { competitionId: 1, settingsJson, endsOn: '2027-03-01' };
    db.insert(season)
      .values([
        { ...base, name: 'Saison 4', startsOn: '2027-01-04', status: 'registration' },
        { ...base, name: 'Saison 2', startsOn: '2026-06-01', status: 'closed' },
      ])
      .run();
    expect(findGuildLeague(db, GUILD)?.season?.name).toBe('Saison 3');

    db.update(season).set({ status: 'active' }).where(eq(season.name, 'Saison 4')).run();
    const league = findGuildLeague(db, GUILD);
    expect(league?.season?.name).toBe('Saison 4');
    expect(league?.divisions).toEqual([]);
  });

  it('has no season while the only one is still in registration', () => {
    const db = seeded();
    linkGuild(db, { guildId: GUILD, staffRoleId: STAFF_ROLE }, 2000);
    db.update(season).set({ status: 'registration' }).run();
    expect(findGuildLeague(db, GUILD)).toMatchObject({ season: undefined, divisions: [] });
  });
});
