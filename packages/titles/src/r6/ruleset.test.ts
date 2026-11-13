import { gameScoreSchema, isPossibleGameScore } from '@ligo/core';
import { describe, expect, it } from 'vitest';
import { R6_GAME_SCORE } from './ruleset.ts';

describe('R6 game score default', () => {
  it('is a valid game_score setting', () => {
    expect(gameScoreSchema.parse(R6_GAME_SCORE)).toEqual(R6_GAME_SCORE);
  });

  it.each([
    [7, 0],
    [7, 5],
    [8, 6],
    [7, 8],
  ])('allows a map to end %i-%i', (a, b) => {
    expect(isPossibleGameScore(R6_GAME_SCORE, a, b)).toBe(true);
  });

  it.each([
    [7, 6],
    [6, 7],
    [9, 7],
    [6, 6],
  ])('does not allow a map to end %i-%i', (a, b) => {
    expect(isPossibleGameScore(R6_GAME_SCORE, a, b)).toBe(false);
  });
});
