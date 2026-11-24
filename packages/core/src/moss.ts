// MOSS files before validation (design doc section 4; M-47, maintainer 20 and 24 November 2026).
// Who owes one is a league setting (`moss.players_from`): by default the players each team
// announced for the match, its roster's starters until it announces any; or, where replays are
// required, the players the match's recordings show, by game account. Each of them sends one
// MOSS file, and only they may: nobody else of the team can upload a stand-in. A side with fewer
// players than a team cannot be checked yet, and a player of the replays Ligo does not know
// cannot send a file, which leaves the decision to staff.

type Side = 'a' | 'b';

export interface MossPlayer {
  /** The game account the replays show (Ubisoft profile ID for R6); null from a lineup. */
  account: string | null;
  /** The name in the replays, or the Ligo player's. */
  name: string;
  /** The Ligo player of the account; null when Ligo knows no one with it. */
  playerId: number | null;
  hasFile: boolean;
}

export type MossSides = Record<Side, readonly MossPlayer[]>;

export type MossGap =
  /** The side shows fewer players than a team: its files cannot be checked yet. */
  | { kind: 'too_few_players'; side: Side; seen: number }
  | { kind: 'missing'; side: Side; account: string | null; name: string; playerId: number }
  /** Nobody on Ligo has this account, so nobody can send the file: staff decide. */
  | { kind: 'unknown_player'; side: Side; account: string | null; name: string };

/** What keeps the match's MOSS files from being complete; none when every file is there. */
export function mossGaps(input: { sides: MossSides; teamSize: number }): MossGap[] {
  const gaps: MossGap[] = [];
  for (const side of ['a', 'b'] as const) {
    const players = input.sides[side];
    if (players.length < input.teamSize) {
      gaps.push({ kind: 'too_few_players', side, seen: players.length });
      continue;
    }
    for (const { account, name, playerId, hasFile } of players) {
      if (hasFile) continue;
      gaps.push(
        playerId === null
          ? { kind: 'unknown_player', side, account, name }
          : { kind: 'missing', side, account, name, playerId },
      );
    }
  }
  return gaps;
}

/** The side a player's MOSS file is for, when the replays show them; null for anyone else. */
export function mossSideOf(sides: MossSides, playerId: number): Side | null {
  if (sides.a.some((p) => p.playerId === playerId)) return 'a';
  if (sides.b.some((p) => p.playerId === playerId)) return 'b';
  return null;
}
