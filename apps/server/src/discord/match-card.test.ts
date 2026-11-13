import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { matchCardFacts } from '../services/match-card.ts';
import { leagueDatabase } from '../testing.ts';
import { matchCardFile, matchCardInput } from './match-card.ts';
import { fakeContext } from './testing.ts';

const facts = (db: ReturnType<typeof leagueDatabase>, matchId: number) => {
  const found = matchCardFacts(db, matchId);
  if (!found) throw new Error(`No match ${matchId}`);
  return found;
};

describe('matchCardInput', () => {
  it("shows an agreed time in the league's time zone, named in a standard way", () => {
    const db = leagueDatabase();
    // 20:00 UTC on Thursday 5 November 2026 is 21:00 in Paris, in winter time.
    db.update(schema.match)
      .set({ scheduledAt: Date.parse('2026-11-05T20:00:00Z') })
      .where(eq(schema.match.id, 3))
      .run();
    expect(matchCardInput('fr', facts(db, 3), 'time')).toMatchObject({
      eyebrow: 'LFR · Saison 3',
      title: 'Ligue 1 · Semaine 3',
      label: 'Match programmé',
      center: 'VS',
      winner: null,
      lines: ['jeudi 5 novembre · 21:00 CET'],
    });
    db.update(schema.match)
      .set({ scheduledAt: Date.parse('2026-04-02T19:00:00Z') })
      .where(eq(schema.match.id, 3))
      .run();
    expect(matchCardInput('en', facts(db, 3), 'time').lines).toEqual([
      'Thursday 2 April · 21:00 CEST',
    ]);
  });

  it('shows the score, the winner and the map of a result', () => {
    const db = leagueDatabase();
    db.update(schema.game).set({ map: 'Villa' }).where(eq(schema.game.matchId, 1)).run();
    expect(matchCardInput('fr', facts(db, 1), 'result')).toMatchObject({
      label: 'Résultat',
      center: '7 – 4',
      winner: 0,
      lines: ['Victoire de Alpha Esport', 'Villa'],
    });
  });

  it('names the team that forfeited, and the other as winner', () => {
    // Match 2: Charlie forfeited against Alpha.
    expect(matchCardInput('fr', facts(leagueDatabase(), 2), 'result')).toMatchObject({
      center: 'Forfait',
      winner: 1,
      lines: ['Forfait de Charlie'],
    });
  });
});

describe('matchCardFile', () => {
  it('renders a PNG named after the match, and nothing for an unknown match', async () => {
    const context = fakeContext({ db: leagueDatabase() });
    const file = await matchCardFile(context, 1, 'result');
    expect(file?.name).toBe('match-1-result.png');
    expect([...(file?.data.slice(1, 4) ?? [])]).toEqual([0x50, 0x4e, 0x47]);
    expect(await matchCardFile(context, 999, 'result')).toBeNull();
  });
});
