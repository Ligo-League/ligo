import type { GameScoreSettings } from '@ligo/core';

/**
 * How a map of Rainbow Six Siege is won in competitive play: 12 rounds, first to 7; at 6-6,
 * overtime is a best of 3 rounds, so a map ends 7-0 to 7-5, 8-6 or 8-7.
 * This is the default a new R6 competition starts from; a league may set its own.
 */
export const R6_GAME_SCORE: GameScoreSettings = { win_at: 7, overtime_rounds: 3 };
