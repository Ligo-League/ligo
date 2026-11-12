import { slugify } from '@ligo/core';
import { z } from 'zod';
import type { MatchRow, MatchRowResult } from './matches-csv.ts';

// Reading score7, where LFR's Season 3 lives until Ligo replaces it. Only the fixtures export
// (`pnpm fixtures:score7`) uses this; the server never calls score7.
// The schemas keep the fields the export needs and ignore the rest of each answer.

const participantSchema = z.object({ name: z.string().min(1) });

export const score7ComponentsSchema = z.array(
  z.object({ id: z.number().int(), type: z.string(), ordinal: z.number().int() }),
);
export const score7RoundMatchesSchema = z.object({
  values: z.array(z.object({ matchId: z.number().int() })),
});
export const score7MatchSchema = z.object({
  id: z.number().int(),
  homeParticipant: participantSchema.nullable(),
  awayParticipant: participantSchema.nullable(),
  homeScore: z.array(z.number()),
  awayScore: z.array(z.number()),
  outcome: z.string().nullable(),
});
export type Score7Match = z.infer<typeof score7MatchSchema>;
export const score7MatchListSchema = z.array(score7MatchSchema);

export const score7StandingSchema = z.object({
  entries: z.array(
    z.object({
      participant: participantSchema,
      ranking: z.number().int(),
      played: z.number().int(),
      wins: z.number().int(),
      draws: z.number().int(),
      losses: z.number().int(),
      scoreFor: z.number().int(),
      scoreAgainst: z.number().int(),
      scoreDifference: z.number().int(),
      points: z.number().int(),
    }),
  ),
});
export type Score7Standing = z.infer<typeof score7StandingSchema>;

/**
 * score7 names that differ from the teams CSV by more than case and the city in brackets,
 * keyed as `score7TeamKey` returns them, with the team's tag.
 */
export const SCORE7_NAME_OVERRIDES: Record<string, string> = {
  'devil-esport': 'DEVIL',
  'notscam-katsuki': 'NTS',
  'askium-esports': 'ASKIUM',
  'mix-n-chill': 'MIXNCHILL',
  'nova-esport-1': 'NOVA1',
  'nova-esport-2': 'NOVA2',
  'w-mates-spectrum': 'SPECTRUM',
};

/** "GREED ESPORT (Paris)" and "Greed Esport" both give "greed-esport". */
export function score7TeamKey(name: string): string {
  const slug = slugify(name.replace(/\s*\([^()]*\)\s*$/, ''));
  return slug.ok ? slug.slug : '';
}

export type TagResolver = (division: string, score7Name: string) => string | undefined;

/** Resolves a score7 name to a tag of that division: by name first, then by the override list. */
export function tagResolver(
  teams: readonly { division: string; name: string; tag: string }[],
  overrides: Record<string, string> = SCORE7_NAME_OVERRIDES,
): TagResolver {
  return (division, score7Name) => {
    const key = score7TeamKey(score7Name);
    const inDivision = teams.filter((team) => team.division === division);
    const byName = inDivision.find((team) => score7TeamKey(team.name) === key);
    if (byName) return byName.tag;
    const override = overrides[key];
    return inDivision.find((team) => team.tag === override)?.tag;
  };
}

export type RowResult<T> = { ok: true; row: T } | { ok: false; error: string };

/** One score7 match as a fixtures row. Home is side A. */
export function toMatchRow(
  division: string,
  week: number,
  match: Score7Match,
  resolve: TagResolver,
): RowResult<MatchRow> {
  const home = match.homeParticipant?.name;
  const away = match.awayParticipant?.name;
  const where = `${division}, week ${week}, match ${match.id}`;
  if (!home || !away) return { ok: false, error: `${where}: a side has no team yet` };

  const teamA = resolve(division, home);
  const teamB = resolve(division, away);
  if (!teamA) return { ok: false, error: `${where}: no team of ${division} matches "${home}"` };
  if (!teamB) return { ok: false, error: `${where}: no team of ${division} matches "${away}"` };

  const result = toResult(match);
  if (typeof result === 'string') {
    return { ok: false, error: `${where} (${teamA} v ${teamB}): ${result}` };
  }
  return { ok: true, row: { division, week, teamA, teamB, result } };
}

// score7 outcomes: "1"/"2" home or away won on the scoreboard, "W1"/"W2" home or away won by
// walkover (the other team forfeited), "X" a draw, null not decided yet.
function toResult(match: Score7Match): MatchRowResult | string {
  const { outcome, homeScore, awayScore } = match;
  const noScore = homeScore.length === 0 && awayScore.length === 0;
  const [scoreA, ...moreA] = homeScore;
  const [scoreB, ...moreB] = awayScore;
  const oneGame =
    scoreA !== undefined &&
    scoreB !== undefined &&
    moreA.length === 0 &&
    moreB.length === 0 &&
    Number.isInteger(scoreA) &&
    Number.isInteger(scoreB);

  switch (outcome) {
    case null:
      return noScore ? { kind: 'none' } : 'a score without an outcome';
    case 'W1':
    case 'W2':
      if (!noScore) return 'a walkover with a score';
      return { kind: 'forfeit', forfeitBy: outcome === 'W1' ? 'b' : 'a' };
    case '1':
    case '2':
    case 'X': {
      if (!oneGame) return 'expected one whole-number score per side';
      if (outcome === 'X') {
        return scoreA === scoreB
          ? { kind: 'draw', scoreA, scoreB }
          : `a draw scored ${scoreA}-${scoreB}`;
      }
      const homeWon = scoreA > scoreB;
      if (scoreA === scoreB || homeWon !== (outcome === '1')) {
        return `outcome "${outcome}" does not fit the score ${scoreA}-${scoreB}`;
      }
      return { kind: 'played', scoreA, scoreB };
    }
    default:
      return `unknown outcome "${outcome}"`;
  }
}

export const STANDINGS_CSV_COLUMNS = [
  'division',
  'rank',
  'team',
  'played',
  'wins',
  'draws',
  'losses',
  'score_for',
  'score_against',
  'diff',
  'points',
] as const;

/** score7's own table, one line per team in rank order, in `STANDINGS_CSV_COLUMNS` order. */
export function toStandingLines(
  division: string,
  standing: Score7Standing,
  resolve: TagResolver,
): RowResult<(string | number)[][]> {
  const lines: (string | number)[][] = [];
  const entries = [...standing.entries].sort((x, y) => x.ranking - y.ranking);
  for (const entry of entries) {
    const tag = resolve(division, entry.participant.name);
    if (!tag) {
      const error = `${division} standings: no team matches "${entry.participant.name}"`;
      return { ok: false, error };
    }
    lines.push([
      division,
      entry.ranking,
      tag,
      entry.played,
      entry.wins,
      entry.draws,
      entry.losses,
      entry.scoreFor,
      entry.scoreAgainst,
      entry.scoreDifference,
      entry.points,
    ]);
  }
  return { ok: true, row: lines };
}
