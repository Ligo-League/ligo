import { cachedPng, digest } from './cache.ts';
import { renderPng } from './png.ts';
import {
  matchCardImage,
  MATCH_CARD_SIZE,
  MATCH_CARD_TEMPLATE_VERSION,
  type MatchCardInput,
} from './templates/match-card.ts';

/** One match as a square PNG, 1080 × 1080: its agreed time, or its result. */
export async function renderMatchCardPng(input: MatchCardInput): Promise<Uint8Array> {
  const teams = input.teams.map((team) => ({ ...team, logo: team.logo && digest(team.logo.data) }));
  return cachedPng('match-card', MATCH_CARD_TEMPLATE_VERSION, { ...input, teams }, () =>
    renderPng(matchCardImage(input), MATCH_CARD_SIZE),
  );
}
