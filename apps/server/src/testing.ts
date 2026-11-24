import {
  addRosterPlayers,
  linkGuild,
  openLfrRegistration,
  openTestDatabase,
  seedLfr,
  seedMatches,
  type MatchRow,
  type TeamRow,
} from '@ligo/db/testing';
import { listLeagueMatches, schema, type Db } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { fakeAssetStore } from './assets/store.ts';
import { createClub } from './services/clubs.ts';
import { saveGameProfile } from './services/game-profile.ts';
import { setNationality, setStatsConsent } from './services/me.ts';
import { ensurePlayer } from './services/players.ts';

export const TEST_GUILD = '876543210987654321';
export const TEST_STAFF_ROLE = '111111111111111111';
/** The seeded LFR's address: MLB Group's competition `lfr`. */
export const LFR_KEY = { org: 'mlb-group', competition: 'lfr' } as const;

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
    .set({
      settingsJson: { ...seasonRow.settingsJson, forfeit_score: { winner: [0, 0], loser: [0, 0] } },
    })
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
  // MOSS files and replays before validation stay off here, as for a new league: the tests that
  // are about them turn them on (`requireMoss`).
  requireMoss(db, false);
  return db;
}

/** Turns the test league's MOSS requirement (M-47) on or off. */
export function requireMoss(db: Db, on = true): void {
  for (const row of db.select().from(schema.competition).all()) {
    db.update(schema.competition)
      .set({ rulesetJson: { ...row.rulesetJson, moss: { ...row.rulesetJson.moss, required: on } } })
      .where(eq(schema.competition.id, row.id))
      .run();
  }
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

/**
 * Lineups for the mercato, in leagueDatabase(): Alpha (team 1) has P1 to P5 starting, P1
 * captain, and P6 a substitute; P7 and P8 are on its own list. P9 plays for Bravo (team 2) and is
 * on Alpha's list too, ready for a transfer. Returns the players' IDs, P1 first.
 */
export function mercatoLineups(db: Db): number[] {
  const seasonId =
    db.select().from(schema.season).where(eq(schema.season.status, 'active')).get()?.id ?? 0;
  const ids: number[] = [];
  for (let n = 1; n <= 9; n += 1) ids.push(rosterPlayerForTests(db, n === 9 ? 2 : 1, n));
  const entry = (teamId: number, n: number, role: 'player' | 'sub', captain = false) =>
    db
      .insert(schema.rosterEntry)
      .values({ seasonId, teamId, playerId: ids[n - 1] ?? 0, role, captain, validFrom: 1 })
      .run();
  for (let n = 1; n <= 5; n += 1) entry(1, n, 'player', n === 1);
  entry(1, 6, 'sub');
  entry(2, 9, 'player', true);
  db.insert(schema.rosterPlayer)
    .values({ teamId: 1, playerId: ids[8] ?? 0, joinedAt: 2 })
    .run();
  return ids;
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

/**
 * A match whose replays show five players a side (M-47): their accounts, one stitched lobby, and
 * each player's MOSS file when `withFiles`. Returns the players by side.
 */
export function playedMatch(
  db: Db,
  matchId: number,
  withFiles: boolean,
): { a: number[]; b: number[] } {
  const [found] = listLeagueMatches(db, { matchId });
  if (!found) throw new Error(`No match ${String(matchId)}`);
  const prefix = `m${String(matchId)}`;
  const accounts = {
    a: addRosterPlayers(db, found.seasonId, found.a.teamId, `${prefix}a`),
    b: addRosterPlayers(db, found.seasonId, found.b.teamId, `${prefix}b`),
  };
  const idOf = (account: string) =>
    db
      .select({ id: schema.gameAccount.playerId })
      .from(schema.gameAccount)
      .where(eq(schema.gameAccount.externalId, account))
      .get()?.id ?? 0;
  const players = [
    ...accounts.a.map((account) => ({ account, name: account.slice(0, 4), side: 0 })),
    ...accounts.b.map((account) => ({ account, name: account.slice(0, 4), side: 1 })),
  ];
  const uploader = idOf(accounts.a[0] ?? '');
  db.insert(schema.replayFile)
    .values({
      matchId,
      uploaderPlayerId: uploader,
      title: 'r6',
      fileName: 'Match-R01.rec',
      size: 1,
      sha256: `${String(matchId).padStart(4, '0')}${'0'.repeat(60)}`,
      lobbyId: `lobby-${String(matchId)}`,
      unitNumber: 0,
      parserVersion: 'r6-test',
      parsedJson: { players },
      createdAt: 0,
    })
    .run();
  const gameId =
    found.game?.id ??
    db.insert(schema.game).values({ matchId, n: 1, bansJson: [] }).returning().get().id;
  db.insert(schema.replaySegment)
    .values({
      matchId,
      gameId,
      lobbyId: `lobby-${String(matchId)}`,
      startedAt: 0,
      status: 'ok',
      teamMapJson: ['a', 'b'],
    })
    .run();
  const ids = { a: accounts.a.map(idOf), b: accounts.b.map(idOf) };
  if (withFiles) {
    for (const playerId of [...ids.a, ...ids.b]) {
      db.insert(schema.evidence)
        .values({
          matchId,
          kind: 'moss',
          objectKey: `evidence/${String(matchId)}/moss/${String(playerId)}-${'0'.repeat(32)}.zip`,
          uploadedBy: playerId,
          playerId,
          at: 0,
        })
        .run();
    }
  }
  return ids;
}
