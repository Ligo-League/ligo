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

/** Five roster players with Ubisoft accounts for a team of the season; their profileIDs. */
export function addRosterPlayers(
  db: Db,
  seasonId: number,
  teamId: number,
  prefix: string,
): string[] {
  const org = db.select().from(schema.org).get();
  if (!org) throw new Error('no organisation');
  return [1, 2, 3, 4, 5].map((n) => {
    const name = `${prefix}${String(n)}`;
    // The first part is unique, since rawRound names each player by it.
    const account = `${prefix}${String(n)}00000-0000-4000-8000-000000000000`;
    const player = db
      .insert(schema.player)
      .values({ orgId: org.id, slug: name, displayName: name, createdAt: 0 })
      .returning()
      .get();
    db.insert(schema.gameAccount)
      .values({ playerId: player.id, title: 'r6', externalId: account, displayName: name })
      .run();
    db.insert(schema.rosterEntry)
      .values({ seasonId, teamId, playerId: player.id, role: 'player', validFrom: 0 })
      .run();
    return account;
  });
}

interface RawRound {
  lobby: string;
  number: number;
  /** The winning file side, or null for a round cut short. */
  winner: 0 | 1 | null;
  /** The file side attacking. */
  attacker: 0 | 1;
  startedAt: number;
  map?: string;
  /** Profile IDs on each file side; the names are the IDs' first part. */
  accounts: [string[], string[]];
}

/** One round in the r6-dissect fork's JSON shape: a kill by the winner, nothing else. */
export function rawRound(round: RawRound): Record<string, unknown> {
  const name = (account: string) => account.split('-')[0] ?? account;
  const [first, second] = round.accounts;
  const killer = round.winner === null ? null : (round.accounts[round.winner][0] ?? null);
  const victim =
    round.winner === null ? null : (round.accounts[round.winner === 0 ? 1 : 0][0] ?? null);
  const feed =
    killer && victim
      ? [
          {
            type: { name: 'Kill', id: 0 },
            username: name(killer),
            target: name(victim),
            headshot: false,
            time: '1:00',
            timeInSeconds: 60,
            phase: 'Action',
            elapsedSeconds: 120,
          },
        ]
      : [];
  const players = [...first.map((a) => [a, 0] as const), ...second.map((a) => [a, 1] as const)];
  return {
    gameVersion: 'Y11S3_Alpha04',
    timestamp: new Date(round.startedAt).toISOString(),
    matchType: { name: 'CustomGameOnline', id: 2 },
    map: { name: round.map ?? 'ClubHouseY10', id: 1 },
    site: '2F Bar',
    recordingProfileID: first[0],
    gamemode: { name: 'Bomb', id: 1 },
    roundNumber: round.number,
    matchID: round.lobby,
    teams: [0, 1].map((idx) => ({
      startingScore: 0,
      won: round.winner === idx,
      ...(round.winner === idx ? { winCondition: 'KilledOpponents' } : {}),
      role: idx === round.attacker ? 'Attack' : 'Defense',
    })),
    players: players.map(([account, side]) => ({
      profileID: account,
      username: name(account),
      teamIndex: side,
      operator: { name: side === round.attacker ? 'Ash' : 'Mute', id: 1 },
    })),
    matchFeedback: feed,
    stats: players.map(([account]) => ({
      username: name(account),
      kills: account === killer ? 1 : 0,
      died: account === victim,
      assists: 0,
    })),
  };
}
