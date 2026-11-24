import { listLeagueMatches, schema, type Db } from '@ligo/db';
import { addRosterPlayers } from '@ligo/db/testing';
import { normalizeR6 } from '@ligo/titles';
import { rawRound } from '@ligo/titles/testing';
import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { workerDatabase } from '../testing.ts';
import { stitchMatch } from './stitch-game.ts';

// `stitch_game` (design doc section 8, "From files to a game" and "Stitching re-hosted games"):
// the match's round files become lobbies in its games, each lobby's round facts are written
// from one recording per round, and each game's official rounds come from the stitch plan. The
// plan applies by itself only when every check passes against the reported score.

const MINUTE = 60_000;
let sha = 0;

function setup() {
  const { db, matchId, uploaderId } = workerDatabase();
  const [found] = listLeagueMatches(db, { matchId });
  if (!found) throw new Error('no match');
  const alpha = addRosterPlayers(db, found.seasonId, found.a.teamId, 'a');
  const bravo = addRosterPlayers(db, found.seasonId, found.b.teamId, 'b');
  const addGame = (map: string | null, score: [number, number] | null) => {
    db.insert(schema.game)
      .values({
        matchId,
        n: 1,
        map,
        bansJson: [],
        scoreA: score?.[0] ?? 0,
        scoreB: score?.[1] ?? 0,
      })
      .run();
    if (score) db.update(schema.match).set({ status: 'reported' }).run();
  };
  /**
   * A lobby's rounds: `A` or `B` the winner, `-` a round cut short. Alpha is on file side 0 and
   * attacks the first six rounds.
   */
  // Rounds counted across the lobbies: sides swap at half-time of the whole map.
  let counted = 0;
  const lobby = (id: string, winners: string, start: number, map?: string) => {
    Array.from(winners).forEach((char, i) => {
      const raw = rawRound({
        lobby: id,
        number: i,
        winner: char === '-' ? null : char === 'A' ? 0 : 1,
        attacker: counted < 6 ? 0 : 1,
        startedAt: start + i * 4 * MINUTE,
        accounts: [alpha, bravo],
        ...(map ? { map } : {}),
      });
      if (char !== '-') counted += 1;
      addFile(db, matchId, uploaderId, raw);
    });
  };
  const run = () => stitchMatch({ db, now: () => 9 }, { matchId });
  const game = () => db.select().from(schema.game).get();
  const rounds = () => db.select().from(schema.gameRound).orderBy(asc(schema.gameRound.id)).all();
  return { db, matchId, addGame, lobby, run, game, rounds, alpha };
}

function addFile(db: Db, matchId: number, uploaderId: number, raw: Record<string, unknown>) {
  const hash = (sha++).toString(16).padStart(64, '0');
  const unit = normalizeR6(raw, { parser: 'r6-test', fileSha256: hash, tradeWindowS: 10 });
  if (!unit.ok) throw new Error(unit.message);
  db.insert(schema.replayFile)
    .values({
      matchId,
      uploaderPlayerId: uploaderId,
      title: 'r6',
      fileName: 'Match-R01.rec',
      size: 1,
      sha256: hash,
      lobbyId: unit.unit.lobby_id,
      unitNumber: unit.unit.unit.number,
      parserVersion: 'r6-test',
      parsedJson: unit.unit as unknown as Record<string, unknown>,
      createdAt: 0,
    })
    .run();
}

describe('stitchMatch', () => {
  it('applies a single lobby’s plan when it gives the reported score', async () => {
    const { db, addGame, lobby, run, game, rounds } = setup();
    addGame('Clubhouse', [7, 3]);
    lobby('L1', 'AABABAAABA', 0);
    await run();
    expect(game()).toMatchObject({
      stitchStatus: 'auto',
      stitchChecksJson: expect.arrayContaining([{ code: 'reported_score', ok: true }]) as unknown,
    });
    expect(rounds().map((r) => [r.n, r.kind, r.winnerSide])).toEqual([
      [1, 'replay', 'a'],
      [2, 'replay', 'a'],
      [3, 'replay', 'b'],
      [4, 'replay', 'a'],
      [5, 'replay', 'b'],
      [6, 'replay', 'a'],
      [7, 'replay', 'a'],
      [8, 'replay', 'a'],
      [9, 'replay', 'b'],
      [10, 'replay', 'a'],
    ]);
    expect(db.select().from(schema.replaySegment).get()).toMatchObject({
      lobbyId: 'L1',
      status: 'ok',
      teamMapJson: ['a', 'b'],
      issue: null,
    });
  });

  it('writes each round’s facts, with the players found by their account', async () => {
    const { db, addGame, lobby, run, alpha } = setup();
    addGame('Clubhouse', [7, 0]);
    lobby('L1', 'AAAAAAA', 0);
    await run();
    expect(db.select().from(schema.segmentRound).all()).toHaveLength(7);
    const first = db
      .select()
      .from(schema.roundPlayer)
      .where(eq(schema.roundPlayer.account, alpha[0] ?? ''))
      .all();
    expect(first).toHaveLength(7);
    expect(first[0]).toMatchObject({ kills: 1, openingKill: true, survived: true, kost: true });
    expect(first[0]?.playerId).not.toBeNull();
    expect(db.select().from(schema.killEvent).all()).toHaveLength(7);
  });

  it('joins a re-hosted map, voiding the round cut short, and keeps who called the re-host', async () => {
    const { db, addGame, lobby, run, game, rounds } = setup();
    addGame('Clubhouse', [7, 5]);
    lobby('L1', 'AABABA-', 0);
    lobby('L2', 'BBABAA', 60 * MINUTE);
    await run();
    expect(game()?.stitchStatus).toBe('auto');
    expect(rounds().filter((r) => r.kind === 'void')).toEqual([
      expect.objectContaining({ n: null, reason: 'interrupted' }),
    ]);
    db.update(schema.replaySegment)
      .set({ rehostCalledBy: 'b' })
      .where(eq(schema.replaySegment.lobbyId, 'L2'))
      .run();
    await run();
    expect(
      db.select().from(schema.replaySegment).where(eq(schema.replaySegment.lobbyId, 'L2')).get(),
    ).toMatchObject({ rehostCalledBy: 'b' });
    expect(rounds()).toHaveLength(13);
  });

  it('leaves the plan for staff when a check fails, and waits for a score to compare with', async () => {
    const wrong = setup();
    wrong.addGame('Clubhouse', [7, 2]);
    wrong.lobby('L1', 'AABABAAABA', 0);
    await wrong.run();
    expect(wrong.game()?.stitchStatus).toBe('needs_review');

    const waiting = setup();
    waiting.addGame('Clubhouse', null);
    waiting.lobby('L1', 'AABABAAABA', 0);
    await waiting.run();
    expect(waiting.game()?.stitchStatus).toBe('none');
    expect(waiting.rounds()).toHaveLength(10);
  });

  it('puts a lobby on another map aside for staff', async () => {
    const { db, addGame, lobby, run, game } = setup();
    addGame('Clubhouse', [7, 0]);
    lobby('L1', 'AAAAAAA', 0, 'BankY10');
    await run();
    expect(db.select().from(schema.replaySegment).get()).toMatchObject({
      status: 'unassigned',
      issue: 'unknown_map',
      gameId: null,
    });
    expect(game()?.stitchStatus).toBe('none');
  });

  it('takes a best-of-one game without a map from the one map its lobbies played', async () => {
    const { addGame, lobby, run, game } = setup();
    addGame(null, [7, 0]);
    lobby('L1', 'AAAAAAA', 0);
    await run();
    expect(game()?.stitchStatus).toBe('auto');
  });

  it('never changes a game staff stitched by hand, nor a lobby staff ignored', async () => {
    const { db, addGame, lobby, run, rounds } = setup();
    addGame('Clubhouse', [7, 0]);
    lobby('L1', 'AAAAAAA', 0);
    await run();
    db.update(schema.game).set({ stitchStatus: 'staff' }).run();
    db.delete(schema.gameRound).run();
    db.update(schema.replaySegment)
      .set({ status: 'ignored', gameId: null, teamMapJson: null })
      .run();
    db.delete(schema.gameRound).run();
    await run();
    expect(rounds()).toEqual([]);
    expect(db.select().from(schema.replaySegment).get()?.status).toBe('ignored');
  });

  it('does nothing for a forfeit or a void match, or one that is gone', async () => {
    const { db, addGame, lobby, run, rounds } = setup();
    addGame('Clubhouse', [7, 0]);
    lobby('L1', 'AAAAAAA', 0);
    db.update(schema.match).set({ status: 'void' }).run();
    await run();
    expect(rounds()).toEqual([]);
    await expect(stitchMatch({ db, now: () => 9 }, { matchId: 999 })).resolves.toBeUndefined();
  });
});
