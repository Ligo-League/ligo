import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase } from '../testing.ts';
import { matchCardFacts } from './match-card.ts';

describe('matchCardFacts', () => {
  it("reads a match's league, teams, time zone and first map", () => {
    const db = leagueDatabase();
    db.update(schema.game).set({ map: 'Villa' }).where(eq(schema.game.matchId, 1)).run();
    expect(matchCardFacts(db, 1)).toMatchObject({
      match: { id: 1, a: { name: 'Alpha Esport' }, b: { name: 'Bravo' } },
      competition: 'LFR',
      season: 'Saison 3',
      timeZone: 'Europe/Paris',
      teams: {
        a: { name: 'Alpha Esport', colors: ['#112233', '#FFFFFF'], logoKey: null },
        b: { name: 'Bravo' },
      },
      map: 'Villa',
    });
  });

  it('has no map before a veto or a report names one, and nothing for an unknown match', () => {
    const db = leagueDatabase();
    expect(matchCardFacts(db, 3)?.map).toBeNull();
    expect(matchCardFacts(db, 999)).toBeUndefined();
  });
});
