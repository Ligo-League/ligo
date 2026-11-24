import type { R6Unit } from '@ligo/titles';
import type { KnownAccount } from './config.ts';

// What the player checks before sending (design doc section 8, upload flow 3): each lobby found,
// its map, its rounds and who won them, and the players of each side, known to Ligo or not. The
// server reads the files again and decides; this only shows what it will most likely find.

type Side = 'a' | 'b';

export interface PreviewPlayer {
  name: string;
  /** The Ligo player this account belongs to, and their side, when Ligo knows it. */
  known: { name: string; side: Side } | null;
}

export interface PreviewSide {
  /** The match's team on this side of the files, when enough known players say so. */
  team: Side | null;
  players: PreviewPlayer[];
}

export interface LobbyPreview {
  lobbyId: string;
  map: string;
  /** The first round's start, Unix milliseconds, or null when unreadable. */
  startedAt: number | null;
  /** A league match is a custom game; another kind is sent with a warning. */
  customGame: boolean;
  rounds: { number: number; winner: Side | null; complete: boolean }[];
  sides: [PreviewSide, PreviewSide];
}

/**
 * The lobbies of the rounds read, in time order. `knownOf` gives what Ligo knows of an account,
 * found by its hash; `minKnown` is the league's `replays.min_known_players`.
 */
export function previewLobbies(
  units: readonly R6Unit[],
  knownOf: (account: string) => KnownAccount | undefined,
  minKnown: number,
): LobbyPreview[] {
  const lobbies = new Map<string, R6Unit[]>();
  for (const unit of units)
    lobbies.set(unit.lobby_id, [...(lobbies.get(unit.lobby_id) ?? []), unit]);

  return [...lobbies.entries()]
    .map(([lobbyId, list]): LobbyPreview => {
      const byNumber = new Map<number, R6Unit>();
      for (const unit of [...list].sort((x, y) => x.unit.number - y.unit.number)) {
        // Two recordings of a round: a complete one is shown.
        const shown = byNumber.get(unit.unit.number);
        if (!shown || (!shown.complete && unit.complete)) byNumber.set(unit.unit.number, unit);
      }
      const first = [...byNumber.values()][0] ?? list[0];
      if (!first) throw new Error('A lobby has no round');

      const players = new Map<string, { side: 0 | 1; player: PreviewPlayer }>();
      for (const unit of byNumber.values()) {
        for (const player of unit.players) {
          const key = player.account ?? `name:${player.name}`;
          if (players.has(key)) continue;
          const found = player.account ? knownOf(player.account) : undefined;
          players.set(key, {
            side: player.side,
            player: {
              name: player.name,
              known: found ? { name: found.name, side: found.side } : null,
            },
          });
        }
      }
      const sideOf = (idx: 0 | 1): PreviewSide => {
        const list = [...players.values()].filter((p) => p.side === idx).map((p) => p.player);
        const count = { a: 0, b: 0 };
        for (const player of list) if (player.known) count[player.known.side] += 1;
        const team =
          count.a >= minKnown && count.b < minKnown
            ? 'a'
            : count.b >= minKnown && count.a < minKnown
              ? 'b'
              : null;
        return { team, players: list.sort((x, y) => x.name.localeCompare(y.name)) };
      };
      const sides: [PreviewSide, PreviewSide] = [sideOf(0), sideOf(1)];
      const startedAt = Date.parse(first.started_at);
      return {
        lobbyId,
        map: first.map,
        startedAt: Number.isNaN(startedAt) ? null : startedAt,
        customGame: first.match_type.startsWith('CustomGame'),
        rounds: [...byNumber.values()].map((unit) => {
          const won = unit.sides.find((s) => s.won)?.idx;
          return {
            number: unit.unit.number,
            winner: won === undefined ? null : (sides[won].team ?? null),
            complete: unit.complete,
          };
        }),
        sides,
      };
    })
    .sort((x, y) => (x.startedAt ?? 0) - (y.startedAt ?? 0));
}
