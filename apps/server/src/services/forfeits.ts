import {
  countForfeits,
  forfeitConsequence,
  nextMatchStatus,
  type ForfeitConsequence,
} from '@ligo/core';
import { listLeagueMatches, loadStandingsInput, schema, type Db, type LeagueMatch } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { matchQuery } from './match-search.ts';
import { requireStaff, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';

const { auditLog, game, match, sanction } = schema;

export type ForfeitError =
  'not_linked' | 'not_staff' | 'match_not_found' | 'wrong_status' | 'unsupported_series';

export type ForfeitReply =
  | {
      ok: true;
      match: LeagueMatch;
      /** The side that forfeited, and how many forfeits its team now has in this stage. */
      side: 'a' | 'b';
      count: number;
      consequence: ForfeitConsequence;
      /** Where staff are alerted when the count reaches the exclusion threshold. */
      queueChannelId: string | null;
    }
  | { ok: false; error: ForfeitError };

/**
 * League staff record that one team forfeited a match: only staff can, a team never claims a
 * forfeit win itself. The opponent's win counts at once. Reaching the season's warning threshold
 * adds a warning sanction in the same transaction; `warningReason` words it. Reaching the
 * exclusion threshold is reported to the caller and decides nothing: excluding a team is a
 * staff decision of its own.
 */
export function recordForfeit(
  db: Db,
  actor: Actor,
  request: { matchId: number; side: 'a' | 'b'; warningReason: (count: number) => string },
  now: number,
): ForfeitReply {
  const staff = requireStaff(db, actor);
  if (!staff.ok) return staff;
  const { league } = staff;
  if (!league.season) return { ok: false, error: 'match_not_found' };
  const { season } = league;

  return db.transaction((tx): ForfeitReply => {
    const [found] = listLeagueMatches(tx, { matchId: request.matchId });
    if (found?.competitionId !== league.competition.id) {
      return { ok: false, error: 'match_not_found' };
    }
    const step = nextMatchStatus({
      status: found.status,
      action: 'forfeit',
      actor: 'staff',
      validation: league.competition.rulesetJson.result_validation,
    });
    if (!step.ok) return { ok: false, error: 'wrong_status' };
    if (found.bestOf !== 1) return { ok: false, error: 'unsupported_series' };

    const staffPlayer = ensurePlayer(
      tx,
      { orgId: league.org.id, discordUserId: actor.user.id, displayName: actor.user.displayName },
      now,
    );
    // A forfeit stores no rounds: the season's forfeit score is applied when standings are
    // computed.
    const forfeited = { scoreA: 0, scoreB: 0, forfeitSide: request.side, status: 'final' as const };
    if (found.game) {
      tx.update(game).set(forfeited).where(eq(game.id, found.game.id)).run();
    } else {
      tx.insert(game)
        .values({ matchId: found.id, n: 1, bansJson: [], ...forfeited })
        .run();
    }
    tx.update(match)
      .set({ status: 'forfeit', validatedBy: staffPlayer.id, validatedAt: now })
      .where(eq(match.id, found.id))
      .run();

    // Counted after the change, over the stage, from the same data standings use.
    const stage = loadStandingsInput(tx, found.stageId);
    const team = stage?.teams.find((entry) => entry.teamId === found[request.side].teamId);
    if (!stage || !team) throw new Error(`Match ${found.id} has a team outside its stage`);
    const count = countForfeits(stage.input.matches, team.entry);
    const consequence = forfeitConsequence(count, season.settingsJson.forfeits);

    if (consequence === 'warning') {
      tx.insert(sanction)
        .values({
          seasonId: season.id,
          targetKind: 'slot',
          targetId: team.slotId,
          kind: 'warning',
          matchId: found.id,
          startsAt: now,
          reason: request.warningReason(count),
          decidedBy: staffPlayer.id,
        })
        .run();
    }
    tx.insert(auditLog)
      .values({
        actorPlayerId: staffPlayer.id,
        actorKind: 'user',
        action: 'match.forfeit',
        entity: 'match',
        entityId: String(found.id),
        beforeJson: {
          status: found.status,
          ...(found.game ? { scoreA: found.game.scoreA, scoreB: found.game.scoreB } : {}),
        },
        afterJson: { status: 'forfeit', forfeitedBy: team.teamId, forfeits: count, consequence },
        at: now,
      })
      .run();

    return {
      ok: true,
      match: found,
      side: request.side,
      count,
      consequence,
      queueChannelId: league.guild.alertsChannelId,
    };
  });
}

/** The matches staff can record a forfeit on, narrowed by `query`; those to play come first. */
export function searchForfeitableMatches(
  db: Pick<Db, 'select'>,
  actor: Pick<Actor, 'guildId' | 'memberRoleIds'>,
  query: string,
  limit: number,
): LeagueMatch[] {
  const staff = requireStaff(db, actor);
  if (!staff.ok || !staff.league.season) return [];
  const validation = staff.league.competition.rulesetJson.result_validation;
  const played = (found: LeagueMatch) => (found.status === 'validated' ? 1 : 0);
  return listLeagueMatches(db, { seasonId: staff.league.season.id })
    .filter(
      (found) =>
        found.bestOf === 1 &&
        nextMatchStatus({ status: found.status, action: 'forfeit', actor: 'staff', validation }).ok,
    )
    .filter(matchQuery(query))
    .sort((x, y) => played(x) - played(y))
    .slice(0, limit);
}
