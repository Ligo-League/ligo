import {
  findGuildLeague,
  latestScoreEvidence,
  listLeagueMatches,
  schema,
  type Db,
  type LeagueMatch,
} from '@ligo/db';
import { and, eq } from 'drizzle-orm';
import { resultsChannelFor } from './league-channels.ts';
import { queuePostsOf, type PostRef } from './queue-posts.ts';
import { validationBlockers } from './validation-gates.ts';

// A confirmed result that waited for MOSS files (M-47, maintainer 24 November 2026): where the
// opponent's confirmation validates, Ligo validates it by itself once nothing is missing. The
// clock checks every minute, so it also catches a lobby staff ignored or a file sent late.

const { auditLog, competition, game, leagueGuild, match, season, stage } = schema;

export interface CompletedValidation {
  match: LeagueMatch;
  /** The report's posts in the staff queue, which no longer wait for anything. */
  posts: PostRef[];
  resultsChannelId: string | null;
}

/** The confirmed matches of leagues where the opponent's confirmation validates. */
function waitingMatches(db: Pick<Db, 'select'>): number[] {
  return db
    .select({ id: match.id, ruleset: competition.rulesetJson })
    .from(match)
    .innerJoin(stage, eq(match.stageId, stage.id))
    .innerJoin(season, eq(stage.seasonId, season.id))
    .innerJoin(competition, eq(season.competitionId, competition.id))
    .where(eq(match.status, 'confirmed'))
    .all()
    .filter((row) => row.ruleset.result_validation === 'opponent')
    .map((row) => row.id);
}

/** Validates each confirmed result that no longer waits for anything; returns what it did. */
export function validateCompleted(db: Db, now: number): CompletedValidation[] {
  const done: CompletedValidation[] = [];
  for (const matchId of waitingMatches(db)) {
    const result = db.transaction((tx): CompletedValidation | null => {
      const [found] = listLeagueMatches(tx, { matchId });
      if (found?.status !== 'confirmed' || validationBlockers(tx, found).length > 0) return null;
      tx.update(match)
        .set({ status: 'validated', validatedAt: now })
        .where(and(eq(match.id, found.id), eq(match.status, 'confirmed')))
        .run();
      if (found.game)
        tx.update(game).set({ status: 'final' }).where(eq(game.id, found.game.id)).run();
      tx.insert(auditLog)
        .values({
          actorKind: 'system',
          action: 'match.validate',
          entity: 'match',
          entityId: String(found.id),
          beforeJson: { status: found.status },
          afterJson: { status: 'validated', when: 'moss_complete' },
          at: now,
        })
        .run();
      const guild = tx
        .select({ guildId: leagueGuild.guildId })
        .from(leagueGuild)
        .where(eq(leagueGuild.competitionId, found.competitionId))
        .get();
      const league = guild ? findGuildLeague(tx, guild.guildId) : undefined;
      const report = latestScoreEvidence(tx, found.id);
      return {
        match: found,
        posts: queuePostsOf(tx, { entity: 'match', entityId: found.id }, report?.at ?? 0),
        resultsChannelId: league ? resultsChannelFor(league, found) : null,
      };
    });
    if (result) done.push(result);
  }
  return done;
}
