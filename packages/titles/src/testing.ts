// Test helpers for the apps' replay tests: an R6 round in the r6-dissect fork's JSON shape, as
// the browser's parser and the worker's produce it.

export interface RawRound {
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
