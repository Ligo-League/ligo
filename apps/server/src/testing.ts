import {
  linkGuild,
  openLfrRegistration,
  openTestDatabase,
  seedLfr,
  seedMatches,
  type MatchRow,
  type TeamRow,
} from '@ligo/db/testing';
import { schema, type Db } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { fakeAssetStore } from './assets/store.ts';
import { createClub } from './services/clubs.ts';
import { saveGameProfile } from './services/game-profile.ts';
import { setNationality, setStatsConsent } from './services/me.ts';
import { ensurePlayer } from './services/players.ts';

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

/**
 * The test league with Season 4 open for registration, its rulebook in force from `rulesFrom`
 * (version 1, published by a staff player).
 */
export function registrationDatabase(rulesFrom = 0) {
  const db = leagueDatabase();
  openLfrRegistration(db, 4000);
  const staff = db
    .insert(schema.player)
    .values({ orgId: 1, slug: 'lea-staff', displayName: 'Léa Staff', createdAt: 0 })
    .returning()
    .get();
  db.insert(schema.rulesVersion)
    .values({
      competitionId: 1,
      version: 'Saison 4',
      markdown: '# Règlement',
      effectiveFrom: rulesFrom,
      publishedBy: staff.id,
      publishedAt: 0,
    })
    .run();
  return db;
}

/**
 * Ana's club Kairos Esport and its roster Kairos (KRS), in no competition, with `players`
 * players on the roster, each with a complete profile for LFR: R6 account, nationality, stats
 * consent, born in 2000. Discord IDs `71000000000000000n` for player n.
 */
export async function kairosRoster(db: Db, players = 5) {
  const owner = ensurePlayer(
    db,
    { orgId: 1, discordUserId: '700000000000000001', displayName: 'Ana' },
    1,
  ).id;
  await createClub(
    db,
    fakeAssetStore(),
    owner,
    {
      orgId: 1,
      title: 'r6',
      club: { name: 'Kairos Esport', city: '', legalStatus: '', socials: '', discordUrl: '' },
      roster: { name: 'Kairos', tag: 'KRS', colors: ['#112233', '#FFFFFF'], canStream: false },
      logo: null,
    },
    1,
  );
  const teamId = db.select().from(schema.team).where(eq(schema.team.slug, 'kairos')).get()?.id ?? 0;
  const playerIds: number[] = [];
  for (let n = 1; n <= players; n += 1) {
    playerIds.push(rosterPlayerForTests(db, teamId, n));
  }
  return { owner, teamId, playerIds };
}

/** Player n, with a complete profile for LFR, on the roster. */
export function rosterPlayerForTests(db: Db, teamId: number, n: number): number {
  const discordUserId = `71000000000000000${String(n)}`.slice(-18);
  const id = ensurePlayer(db, { orgId: 1, discordUserId, displayName: `P${String(n)}` }, 1).id;
  saveGameProfile(db, id, { ubisoftName: `Player${String(n)}`, profileId: null, rank: 'gold' }, 1);
  setNationality(db, id, 'FR', 1);
  setStatsConsent(db, id, true, 1);
  db.update(schema.player).set({ birthDate: '2000-01-01' }).where(eq(schema.player.id, id)).run();
  db.insert(schema.rosterPlayer).values({ teamId, playerId: id, joinedAt: n }).run();
  return id;
}

type Post = { channelId: string; messageId: string };

/** Where `disputedReport` says its posts are, unless told otherwise. */
export const OPEN_REPORT_POSTS: { queue: Post; report: Post; dispute: Post } = {
  queue: { channelId: '800000000000000001', messageId: '910000000000000101' },
  report: { channelId: '800000000000000004', messageId: '910000000000000102' },
  dispute: { channelId: '800000000000000001', messageId: '910000000000000103' },
};

/**
 * Match 3 (Bravo v Charlie) reported 7–5 by Bravo, then disputed by Charlie: its report's public
 * post, its staff queue post and the dispute's queue post are on record, as the bot made them.
 */
export function disputedReport(db: Db, posts = OPEN_REPORT_POSTS): void {
  const bravo = ensurePlayer(
    db,
    { orgId: 1, discordUserId: '700000000000000001', displayName: 'Ana' },
    1,
  );
  const charlie = ensurePlayer(
    db,
    { orgId: 1, discordUserId: '700000000000000002', displayName: 'Ben' },
    1,
  );
  db.insert(schema.game)
    .values({ matchId: 3, n: 1, bansJson: [], scoreA: 7, scoreB: 5, status: 'pending' })
    .run();
  db.update(schema.match).set({ status: 'disputed' }).where(eq(schema.match.id, 3)).run();
  const { queue, report, dispute } = posts;
  const evidenceId = db
    .insert(schema.evidence)
    .values({
      matchId: 3,
      kind: 'score_screenshot',
      url: 'https://discord.com/channels/1/2/3',
      uploadedBy: bravo.id,
      visibility: 'teams',
      at: 1,
      postChannelId: report.channelId,
      postMessageId: report.messageId,
    })
    .returning({ id: schema.evidence.id })
    .get().id;
  const disputeId = db
    .insert(schema.dispute)
    .values({
      matchId: 3,
      evidenceId,
      reason: 'wrong_score',
      details: 'Round 9 replayed',
      raisedBy: charlie.id,
      at: 2,
    })
    .returning({ id: schema.dispute.id })
    .get().id;
  db.insert(schema.queuePost)
    .values([
      { entity: 'match', entityId: 3, ...queue, postedAt: 1 },
      { entity: 'dispute', entityId: disputeId, ...dispute, postedAt: 2 },
    ])
    .run();
}
