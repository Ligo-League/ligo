import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditLog, competition, division, org, season, slot, team } from '../schema/index.ts';
import { openTestDatabase } from '../testing.ts';
import { parseTeamsCsv, type TeamRow } from './parse-teams-csv.ts';
import { LFR_DIVISION_NAMES, seedLfr } from './seed-lfr.ts';

const HEADER = 'division,name,tag,city,color_1,color_2';
const parse = (...lines: string[]) =>
  parseTeamsCsv([HEADER, ...lines].join('\n'), LFR_DIVISION_NAMES);

describe('parseTeamsCsv', () => {
  it('reads the committed fixtures/lfr-s3-teams.csv', () => {
    const file = fileURLToPath(new URL('../../../../fixtures/lfr-s3-teams.csv', import.meta.url));
    const result = parseTeamsCsv(readFileSync(file, 'utf8'), LFR_DIVISION_NAMES);
    expect(result.ok).toBe(true);
  });

  it('reads teams, quoted names and optional columns', () => {
    expect(
      parse('Ligue 1,RCK Esport,RCK,Paris,#112233,#FFFFFF', 'Ligue 2,"Dupont, Durand & Co",DDC,,,'),
    ).toEqual({
      ok: true,
      teams: [
        {
          division: 'Ligue 1',
          name: 'RCK Esport',
          tag: 'RCK',
          slug: 'rck-esport',
          city: 'Paris',
          colors: ['#112233', '#FFFFFF'],
        },
        {
          division: 'Ligue 2',
          name: 'Dupont, Durand & Co',
          tag: 'DDC',
          slug: 'dupont-durand-co',
          city: null,
          colors: [],
        },
      ],
    });
  });

  it('accepts a file with only the header', () => {
    expect(parse()).toEqual({ ok: true, teams: [] });
  });

  it('reports every bad row with its line number', () => {
    expect(
      parse(
        'Ligue 1,Alpha,ALP,,,',
        'Ligue 3,Bravo,BRV,,,',
        'Ligue 1,,CHA,,,',
        'Ligue 2,Delta,alp,,,',
        'Ligue 2,Écho,ECH,,red,',
        'Ligue 2,alpha!,AL2,,,',
      ),
    ).toEqual({
      ok: false,
      errors: [
        'line 3: unknown division "Ligue 3" (expected Ligue 1 or Ligue 2)',
        'line 4: name is missing',
        'line 5: tag "alp" is already used on line 2',
        'line 6: colours must look like #1D4ED8',
        'line 7: name "alpha!" gives the same URL as the team on line 2',
      ],
    });
  });

  it('reports a missing column', () => {
    expect(parseTeamsCsv('division,name\nLigue 1,Alpha', LFR_DIVISION_NAMES)).toEqual({
      ok: false,
      errors: ['line 1: column "tag" is missing'],
    });
  });
});

const ALPHA: TeamRow = {
  division: 'Ligue 1',
  name: 'Alpha',
  tag: 'ALP',
  slug: 'alpha',
  city: 'Lyon',
  colors: ['#112233'],
};
const BRAVO: TeamRow = {
  division: 'Ligue 2',
  name: 'Bravo',
  tag: 'BRV',
  slug: 'bravo',
  city: null,
  colors: [],
};
const TEAMS: TeamRow[] = [ALPHA, BRAVO];

describe('seedLfr', () => {
  it('creates LFR, Season 3, both divisions, and a team with an active slot per row', () => {
    const db = openTestDatabase();
    const summary = seedLfr(db, TEAMS, 1000);

    expect(summary).toEqual({
      created: { orgs: 1, competitions: 1, seasons: 1, divisions: 2, teams: 2, slots: 2 },
      updated: { teams: 0, slots: 0 },
    });
    expect(db.select().from(org).all()).toMatchObject([{ name: 'LFR', slug: 'lfr', locale: 'fr' }]);
    expect(db.select().from(competition).all()).toMatchObject([
      {
        title: 'r6',
        participantMode: 'team',
        rulesetJson: { result_validation: 'staff' },
        pointsJson: { outcomes: { win: 1, loss: 0 }, forfeit: { winner: 1, loser: 0 } },
        tiebreakJson: { criteria: ['points', 'diff'], unresolved_tie: 'shared' },
        schedulingJson: { rounds_per_week: 1 },
      },
    ]);
    expect(db.select().from(season).all()).toMatchObject([
      {
        name: 'Saison 3',
        startsOn: '2026-10-19',
        endsOn: '2026-12-20',
        status: 'active',
        settingsJson: { forfeit_score: [0, 0], map_pool: [] },
      },
    ]);
    expect(db.select().from(division).all()).toMatchObject([
      { name: 'Ligue 1', kind: 'league', level: 1 },
      { name: 'Ligue 2', kind: 'league', level: 2 },
    ]);
    expect(db.select().from(team).all()).toMatchObject([
      {
        name: 'Alpha',
        tag: 'ALP',
        slug: 'alpha',
        city: 'Lyon',
        colorsJson: ['#112233'],
        title: 'r6',
      },
      { name: 'Bravo', tag: 'BRV', slug: 'bravo', city: null, colorsJson: [] },
    ]);
    expect(db.select().from(slot).all()).toMatchObject([
      { divisionId: 1, teamId: 1, status: 'active', forfeits: 0 },
      { divisionId: 2, teamId: 2, status: 'active', forfeits: 0 },
    ]);
  });

  it('records one system audit entry for the run', () => {
    const db = openTestDatabase();
    seedLfr(db, TEAMS, 1000);
    expect(db.select().from(auditLog).all()).toMatchObject([
      {
        actorKind: 'system',
        actorPlayerId: null,
        action: 'seed.lfr',
        entity: 'season',
        entityId: '1',
        at: 1000,
      },
    ]);
  });

  it('changes nothing when run again with the same teams', () => {
    const db = openTestDatabase();
    seedLfr(db, TEAMS, 1000);
    const dump = () => db.$client.serialize().toString('base64');
    const before = dump();

    const summary = seedLfr(db, TEAMS, 2000);

    expect(summary).toEqual({
      created: { orgs: 0, competitions: 0, seasons: 0, divisions: 0, teams: 0, slots: 0 },
      updated: { teams: 0, slots: 0 },
    });
    expect(dump()).toBe(before);
  });

  it('updates a team matched by its tag and moves its slot, without duplicating anything', () => {
    const db = openTestDatabase();
    seedLfr(db, TEAMS, 1000);
    const edited: TeamRow[] = [
      {
        division: 'Ligue 2',
        name: 'Alpha Esport',
        tag: 'ALP',
        slug: 'alpha-esport',
        city: 'Lyon',
        colors: [],
      },
    ];

    const summary = seedLfr(db, edited, 2000);

    expect(summary.created.teams).toBe(0);
    expect(summary.updated).toEqual({ teams: 1, slots: 1 });
    expect(db.select().from(team).all()).toMatchObject([
      { tag: 'ALP', name: 'Alpha Esport', slug: 'alpha-esport', colorsJson: [] },
      { tag: 'BRV', name: 'Bravo' },
    ]);
    expect(db.select().from(slot).all()).toMatchObject([
      { teamId: 1, divisionId: 2 },
      { teamId: 2, divisionId: 2 },
    ]);
    expect(db.select().from(auditLog).all()).toHaveLength(2);
  });

  it('rolls everything back when a team cannot be stored', () => {
    const db = openTestDatabase();
    const broken: TeamRow[] = [ALPHA, BRAVO, { ...ALPHA, tag: 'ZZZ' }]; // same slug as Alpha
    expect(() => seedLfr(db, broken, 1000)).toThrow(/UNIQUE/);
    expect(db.select().from(org).all()).toEqual([]);
    expect(db.select().from(team).all()).toEqual([]);
  });
});
