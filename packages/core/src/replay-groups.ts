// From round files to a match's games (design doc section 8, "From files to a game"), on the
// normalised JSON only, so it runs at upload. Title-neutral: the title's normaliser turns its
// unit into a `ReplayRound` (map already named as in the league's pool, accounts, a fingerprint).
//
// - A segment is one lobby. It goes to the game of its map; a map outside the match, or one two
//   games share, is left to staff.
// - Each side of a file is a team when at least `minKnown` of its players are in that team's
//   lineup, and the two sides must be the two teams. Every recording of a lobby must agree.
// - One recording per round is canonical: a complete one first, then the first stored.
//   Two complete recordings of a round must have the same winner and kill feed.

export type ReplaySide = 'A' | 'B';

export interface ReplayRound {
  /** The stored file (`replay_file.id`): a lower ID was stored first. */
  fileId: number;
  lobbyId: string;
  /** The round's number in its lobby; a re-hosted lobby goes on with the same numbers. */
  number: number;
  /** Unix milliseconds. */
  startedAt: number;
  /** The map as the league's pool names it, or null when it is not in the pool. */
  map: string | null;
  complete: boolean;
  /** The file side that won, or null. */
  winner: 0 | 1 | null;
  /** The file side that attacked. */
  attacker: 0 | 1;
  /** The known game accounts on each file side. */
  accounts: [string[], string[]];
  /** The round's kill feed, written the same way by every recording of it. */
  fingerprint: string;
}

/** A canonical round, its sides now the match's teams. */
export interface SegmentRound {
  fileId: number;
  number: number;
  startedAt: number;
  winner: ReplaySide | null;
  attacker: ReplaySide;
}

export interface Segment {
  lobbyId: string;
  /** In round-number order. */
  rounds: SegmentRound[];
}

/** What staff should know about a game's replays; none of it stops the stitching. */
export type GameReplayIssue =
  | { kind: 'recordings_differ'; lobbyId: string; round: number }
  /** A player in neither lineup: an irregularity under the rulebook (staff alerts). */
  | { kind: 'unlisted_player'; lobbyId: string; account: string; side: ReplaySide }
  /** A player of one lineup, playing on the other team's side. */
  | { kind: 'crossed_player'; lobbyId: string; account: string; side: ReplaySide };

export interface GroupedGame {
  n: number;
  segments: Segment[];
  issues: GameReplayIssue[];
}

/** A lobby no game can take without staff. */
export interface UnassignedLobby {
  kind: 'unknown_map' | 'ambiguous_map' | 'teams_unresolved' | 'teams_differ';
  lobbyId: string;
}

export interface GroupInput {
  files: readonly ReplayRound[];
  /** The match's games, with their map from the veto (null when none was set). */
  games: readonly { n: number; map: string | null }[];
  /** Each lineup player's game account, and their team. */
  teamOf: ReadonlyMap<string, ReplaySide>;
  /** Known players a side needs to be a team: 3 by default (`replays.min_known_players`). */
  minKnown: number;
}

export interface Grouped {
  games: GroupedGame[];
  unassigned: UnassignedLobby[];
}

/** Which team each file side is, or null when the players do not say. */
function fileTeams(
  accounts: [string[], string[]],
  teamOf: ReadonlyMap<string, ReplaySide>,
  minKnown: number,
): [ReplaySide, ReplaySide] | null {
  const teamOfSide = (side: string[]): ReplaySide | null => {
    const count = { A: 0, B: 0 };
    for (const account of side) {
      const team = teamOf.get(account);
      if (team) count[team] += 1;
    }
    if (count.A >= minKnown && count.B < minKnown) return 'A';
    if (count.B >= minKnown && count.A < minKnown) return 'B';
    return null;
  };
  const first = teamOfSide(accounts[0]);
  const second = teamOfSide(accounts[1]);
  return first !== null && second !== null && first !== second ? [first, second] : null;
}

export function groupReplays(input: GroupInput): Grouped {
  const lobbies = new Map<string, ReplayRound[]>();
  for (const file of [...input.files].sort((x, y) => x.fileId - y.fileId)) {
    const files = lobbies.get(file.lobbyId) ?? [];
    files.push(file);
    lobbies.set(file.lobbyId, files);
  }

  const games: GroupedGame[] = input.games.map((game) => ({
    n: game.n,
    segments: [],
    issues: [],
  }));
  const unassigned: UnassignedLobby[] = [];
  const firstStart = (files: ReplayRound[]) => Math.min(...files.map((f) => f.startedAt));
  const ordered = [...lobbies.entries()].sort(([, x], [, y]) => firstStart(x) - firstStart(y));

  for (const [lobbyId, files] of ordered) {
    const maps = new Set(files.map((f) => f.map));
    const [map] = maps;
    const candidates =
      maps.size === 1 && map !== null && map !== undefined
        ? games.filter((_, i) => input.games[i]?.map === map)
        : [];
    const game = candidates[0];
    if (!game || candidates.length > 1) {
      unassigned.push({ kind: candidates.length > 1 ? 'ambiguous_map' : 'unknown_map', lobbyId });
      continue;
    }

    const resolved = files.map((f) => fileTeams(f.accounts, input.teamOf, input.minKnown));
    const teams = resolved.find((r) => r !== null);
    if (!teams) {
      unassigned.push({ kind: 'teams_unresolved', lobbyId });
      continue;
    }
    if (resolved.some((r) => r !== null && (r[0] !== teams[0] || r[1] !== teams[1]))) {
      unassigned.push({ kind: 'teams_differ', lobbyId });
      continue;
    }

    game.segments.push({ lobbyId, rounds: canonicalRounds(lobbyId, files, teams, game.issues) });
    game.issues.push(...playerIssues(lobbyId, files, teams, input.teamOf));
  }
  return { games, unassigned };
}

/** One recording per round, in number order; two complete ones that disagree are flagged. */
function canonicalRounds(
  lobbyId: string,
  files: ReplayRound[],
  teams: [ReplaySide, ReplaySide],
  issues: GameReplayIssue[],
): SegmentRound[] {
  const byNumber = new Map<number, ReplayRound[]>();
  for (const file of files) byNumber.set(file.number, [...(byNumber.get(file.number) ?? []), file]);
  const rounds: SegmentRound[] = [];
  for (const [number, recordings] of [...byNumber.entries()].sort(([x], [y]) => x - y)) {
    // Files arrive in ID order, so the first complete one is the first stored.
    const complete = recordings.filter((f) => f.complete);
    const chosen = complete[0] ?? recordings[0];
    if (!chosen) continue;
    if (complete.some((f) => f.winner !== chosen.winner || f.fingerprint !== chosen.fingerprint)) {
      issues.push({ kind: 'recordings_differ', lobbyId, round: number });
    }
    rounds.push({
      fileId: chosen.fileId,
      number,
      startedAt: chosen.startedAt,
      winner: chosen.winner === null ? null : teams[chosen.winner],
      attacker: teams[chosen.attacker],
    });
  }
  return rounds;
}

/** Players outside both lineups, or on the other team's side, once per lobby. */
function playerIssues(
  lobbyId: string,
  files: ReplayRound[],
  teams: [ReplaySide, ReplaySide],
  teamOf: ReadonlyMap<string, ReplaySide>,
): GameReplayIssue[] {
  const issues: GameReplayIssue[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const index of [0, 1] as const) {
      const side = teams[index];
      for (const account of file.accounts[index]) {
        if (seen.has(account)) continue;
        seen.add(account);
        const team = teamOf.get(account);
        if (team === undefined) issues.push({ kind: 'unlisted_player', lobbyId, account, side });
        else if (team !== side) issues.push({ kind: 'crossed_player', lobbyId, account, side });
      }
    }
  }
  return issues;
}
