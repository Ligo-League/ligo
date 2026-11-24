import {
  groupReplays,
  stitchGame,
  type ReplayRound,
  type ReplaySide,
  type Segment,
  type StitchSegment,
} from '@ligo/core';
import { listLeagueMatches, matchAccounts, schema, type Db, type Tx } from '@ligo/db';
import { R6_GAME_SCORE, r6ReplayRound, type R6Unit } from '@ligo/titles';
import { asc, eq } from 'drizzle-orm';

// `stitch_game` (design doc section 8, "From files to a game" and "Stitching re-hosted games"),
// for a whole match, since its lobbies are sorted into its games together:
// - each lobby becomes a segment in the game of its map, or is put aside for staff with why;
// - each segment's rounds get their facts from one recording each (`segment_round`,
//   `round_player`, `kill_event`), rewritten on every run;
// - each game's official rounds (`game_round`) come from the stitch plan. The plan applies by
//   itself (`auto`) only when every check passes against the reported score; a failed check, or
//   two recordings of a round that disagree, leave it to staff (`needs_review`); without a
//   reported score yet, it waits (`none`) and the next stitch decides.
// Staff decisions stay: a game stitched by hand and a lobby staff ignored are never touched.

const {
  competition,
  game,
  gameRound,
  killEvent,
  replayFile,
  replaySegment,
  roundPlayer,
  season,
  segmentRound,
} = schema;

export interface StitchDeps {
  db: Db;
  now: () => number;
}

const lower = (side: ReplaySide) => (side === 'A' ? 'a' : 'b');
const upper = (side: 'a' | 'b'): ReplaySide => (side === 'a' ? 'A' : 'B');
/** Results whose score is the one replays are checked against. */
const REPORTED = new Set(['reported', 'confirmed', 'validated']);

export async function stitchMatch(
  deps: StitchDeps,
  payload: Record<string, unknown>,
): Promise<void> {
  const { db } = deps;
  if (typeof payload.matchId !== 'number') throw new Error('stitch_game needs a matchId');
  const [found] = listLeagueMatches(db, { matchId: payload.matchId });
  // A match gone, forfeited or annulled has no map to rebuild.
  if (!found || found.status === 'forfeit' || found.status === 'void') return;

  const rules = db
    .select({ ruleset: competition.rulesetJson, settings: season.settingsJson })
    .from(season)
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .where(eq(season.id, found.seasonId))
    .get();
  if (!rules) throw new Error(`Season ${String(found.seasonId)} has no competition`);
  const games = db.select().from(game).where(eq(game.matchId, found.id)).orderBy(asc(game.n)).all();

  const units = new Map<number, R6Unit>();
  const rounds: ReplayRound[] = [];
  for (const file of db.select().from(replayFile).where(eq(replayFile.matchId, found.id)).all()) {
    if (file.title !== 'r6') continue;
    // Stored by the server after its normaliser read it (5-8), or replaced by its own (verify).
    const unit = file.parsedJson as unknown as R6Unit;
    const read = r6ReplayRound(unit, file.id, rules.settings.map_pool);
    if (!read.ok) continue;
    units.set(file.id, unit);
    rounds.push(read.round);
  }

  // A best-of-one game without a map (no veto on Ligo) takes the one map its lobbies played.
  const played = new Set(rounds.flatMap((round) => (round.map === null ? [] : [round.map])));
  const [onlyMap] = played;
  const gameMaps = games.map((row) => ({
    n: row.n,
    map: row.map ?? (games.length === 1 && played.size === 1 ? (onlyMap ?? null) : null),
  }));
  const { teamOf, playerOf } = matchAccounts(db, found);
  const grouped = groupReplays({
    files: rounds,
    games: gameMaps,
    teamOf,
    minKnown: rules.ruleset.replays.min_known_players,
  });
  const recordings = new Map<string, number>();
  for (const round of rounds) {
    const key = `${round.lobbyId}:${String(round.number)}`;
    recordings.set(key, (recordings.get(key) ?? 0) + 1);
  }
  const startOf = (lobbyId: string) =>
    Math.min(...rounds.filter((round) => round.lobbyId === lobbyId).map((r) => r.startedAt));

  db.transaction((tx) => {
    const existing = new Map(
      tx
        .select()
        .from(replaySegment)
        .where(eq(replaySegment.matchId, found.id))
        .all()
        .map((row) => [row.lobbyId, row]),
    );
    const save = (
      lobbyId: string,
      values: Pick<
        typeof replaySegment.$inferInsert,
        'status' | 'issue' | 'gameId' | 'teamMapJson'
      >,
    ): number => {
      const before = existing.get(lobbyId);
      if (before) {
        tx.update(replaySegment)
          .set({ ...values, startedAt: startOf(lobbyId) })
          .where(eq(replaySegment.id, before.id))
          .run();
        return before.id;
      }
      return tx
        .insert(replaySegment)
        .values({ matchId: found.id, lobbyId, startedAt: startOf(lobbyId), ...values })
        .returning({ id: replaySegment.id })
        .get().id;
    };

    for (const aside of grouped.unassigned) {
      if (existing.get(aside.lobbyId)?.status === 'ignored') continue;
      const id = save(aside.lobbyId, {
        status: 'unassigned',
        issue: aside.kind,
        gameId: null,
        teamMapJson: null,
      });
      clearFacts(tx, id);
    }

    for (const grouping of grouped.games) {
      const row = games.find((candidate) => candidate.n === grouping.n);
      if (!row) continue;
      const usable: StitchSegment[] = [];
      const ids = new Map<string, number>();
      for (const segment of grouping.segments) {
        const before = existing.get(segment.lobbyId);
        if (before?.status === 'ignored') continue;
        const id = save(segment.lobbyId, {
          status: 'ok',
          issue: null,
          gameId: row.id,
          teamMapJson: [lower(segment.teams[0]), lower(segment.teams[1])],
        });
        ids.set(segment.lobbyId, id);
        writeFacts(tx, id, segment, units, playerOf, recordings);
        usable.push({
          ...segment,
          calledBy: before?.rehostCalledBy ? upper(before.rehostCalledBy) : null,
        });
      }
      if (row.stitchStatus === 'staff' || usable.length === 0) continue;

      const plan = stitchGame({
        segments: usable,
        rule: rules.ruleset.game_score ?? R6_GAME_SCORE,
        rehostsPerTeam: rules.ruleset.replays.rehosts_per_team,
        reported: REPORTED.has(found.status) ? { A: row.scoreA, B: row.scoreB } : null,
      });
      const agree = !grouping.issues.some((issue) => issue.kind === 'recordings_differ');
      const checks = [...plan.checks, { code: 'recordings_agree', ok: agree }];
      const status = checks.some((check) => check.ok === false)
        ? 'needs_review'
        : plan.ok
          ? 'auto'
          : 'none';

      tx.delete(gameRound).where(eq(gameRound.gameId, row.id)).run();
      let n = 0;
      for (const round of plan.rounds) {
        const counted = round.void_reason === null;
        if (counted) n += 1;
        tx.insert(gameRound)
          .values({
            gameId: row.id,
            n: counted ? n : null,
            kind: counted ? 'replay' : 'void',
            segmentId: ids.get(round.lobbyId) ?? null,
            localN: round.number,
            winnerSide: round.winner === null ? null : lower(round.winner),
            reason: round.void_reason,
          })
          .run();
      }
      tx.update(game)
        .set({ stitchStatus: status, stitchChecksJson: checks })
        .where(eq(game.id, row.id))
        .run();
    }
  });
  return Promise.resolve();
}

function clearFacts(tx: Tx, segmentId: number) {
  tx.delete(killEvent).where(eq(killEvent.segmentId, segmentId)).run();
  tx.delete(roundPlayer).where(eq(roundPlayer.segmentId, segmentId)).run();
  tx.delete(segmentRound).where(eq(segmentRound.segmentId, segmentId)).run();
}

/** The segment's round facts, from each round's canonical recording. */
function writeFacts(
  tx: Tx,
  segmentId: number,
  segment: Segment,
  units: Map<number, R6Unit>,
  playerOf: Map<string, number>,
  recordings: Map<string, number>,
) {
  clearFacts(tx, segmentId);
  for (const round of segment.rounds) {
    const unit = units.get(round.fileId);
    if (!unit) continue;
    const winner = unit.sides.find((side) => side.won);
    tx.insert(segmentRound)
      .values({
        segmentId,
        localN: round.number,
        canonicalFileId: round.fileId,
        complete: unit.complete,
        winnerIdx: winner?.idx ?? null,
        winCondition: winner?.win_condition ?? null,
        attackerIdx: unit.sides.find((side) => side.role === 'Attack')?.idx ?? 0,
        site: unit.site,
        planted: unit.planted,
        povCount: recordings.get(`${segment.lobbyId}:${String(round.number)}`) ?? 1,
      })
      .run();
    unit.players.forEach((player, idx) => {
      const swaps = unit.events.flatMap((event) =>
        event.type === 'swap' && event.actor === idx ? [event.operator] : [],
      );
      const s = player.stats;
      tx.insert(roundPlayer)
        .values({
          segmentId,
          localN: round.number,
          idx,
          account: player.account,
          playerId: player.account === null ? null : (playerOf.get(player.account) ?? null),
          name: player.name,
          sideIdx: player.side,
          operator: player.operator,
          operatorSwapsJson: swaps.length > 0 ? swaps : null,
          kills: s.kills,
          died: s.deaths === 1,
          assists: s.assists,
          headshots: s.headshots,
          openingKill: s.opening_kills === 1,
          openingDeath: s.opening_deaths === 1,
          tradeKills: s.trade_kills,
          traded: s.traded_deaths === 1,
          survived: s.rounds_survived === 1,
          left: player.detail.left,
          kost: s.rounds_kost === 1,
          clutchVs: player.detail.clutch_vs,
          clutchWon: s.clutch_wins === 1,
        })
        .run();
    });
    for (const event of unit.events) {
      if (event.type === 'swap') continue;
      tx.insert(killEvent)
        .values({
          segmentId,
          localN: round.number,
          seq: event.seq,
          kind: event.type,
          elapsedS: event.elapsed_s,
          actorIdx: event.type === 'kill' ? event.actor : null,
          targetIdx: event.target,
          headshot: event.type === 'kill' && event.headshot,
          teamKill: event.type === 'kill' && event.team_kill,
          trade: event.type === 'kill' && event.trade,
        })
        .run();
    }
  }
}
