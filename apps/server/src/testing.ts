import {
  linkGuild,
  openTestDatabase,
  seedLfr,
  seedMatches,
  type MatchRow,
  type TeamRow,
} from '@ligo/db/testing';
import { schema } from '@ligo/db';

export const TEST_GUILD = '876543210987654321';
export const TEST_STAFF_ROLE = '111111111111111111';

const teamRow = (division: string, tag: string, name: string): TeamRow => ({
  division,
  name,
  tag,
  slug: name.toLowerCase().replaceAll(' ', '-'),
  city: null,
  colors: ['#112233', '#FFFFFF'],
});
const TEAMS = [
  teamRow('Ligue 1', 'ALP', 'Alpha Esport'),
  teamRow('Ligue 1', 'BRV', 'Bravo'),
  teamRow('Ligue 1', 'CHA', 'Charlie'),
  teamRow('Ligue 2', 'XRA', 'Xray'),
  teamRow('Ligue 2', 'YAN', 'Yankee'),
];

const fixture = (
  division: string,
  week: number,
  teamA: string,
  teamB: string,
  result: MatchRow['result'] = { kind: 'none' },
): MatchRow => ({ division, week, teamA, teamB, result });

/**
 * A small league in an in-memory database, linked to `TEST_GUILD`: LFR Season 3 rules, except
 * that a forfeit scores 0-0, so CHA's forfeit leaves it ahead of BRV on difference (the veto
 * tests rely on it); three teams in Ligue 1 (matches 1 to 3) and two in Ligue 2 (match 4).
 *
 * Ligue 1: ALP beat BRV 7-4, CHA forfeited against ALP, BRV v CHA is still to play.
 * Ligue 2: XRA beat YAN 8-6.
 */
export function leagueDatabase() {
  const db = openTestDatabase();
  seedLfr(db, TEAMS, 1000);
  const seasonRow = db.select().from(schema.season).get();
  if (!seasonRow) throw new Error('seedLfr created no season');
  db.update(schema.season)
    .set({ settingsJson: { ...seasonRow.settingsJson, forfeit_score: [0, 0] } })
    .run();
  seedMatches(
    db,
    [
      fixture('Ligue 1', 1, 'ALP', 'BRV', { kind: 'played', scoreA: 7, scoreB: 4 }),
      fixture('Ligue 1', 2, 'CHA', 'ALP', { kind: 'forfeit', forfeitBy: 'a' }),
      fixture('Ligue 1', 3, 'BRV', 'CHA'),
      fixture('Ligue 2', 1, 'XRA', 'YAN', { kind: 'played', scoreA: 8, scoreB: 6 }),
    ],
    2000,
  );
  linkGuild(db, { guildId: TEST_GUILD, staffRoleId: TEST_STAFF_ROLE }, 3000);
  return db;
}

/**
 * Who makes a result count in the test league: LFR's opponent (the default since 14 November
 * 2026), or league staff, as another league may choose.
 */
export function setResultValidation(
  db: ReturnType<typeof leagueDatabase>,
  mode: 'staff' | 'opponent',
): void {
  const row = db.select().from(schema.competition).get();
  if (!row) throw new Error('seedLfr created no competition');
  db.update(schema.competition)
    .set({ rulesetJson: { ...row.rulesetJson, result_validation: mode } })
    .run();
}
