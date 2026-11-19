import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkScoringEdit, scoringChanges, type ScoringSettings } from './scoring-lock.ts';

// The scoring lock (M-40, maintainer, 19 November 2026): the settings standings are computed
// from cannot change for a season once a result counts in it, except by the organisation's owner,
// with a reason.

const LFR: ScoringSettings = {
  points: {
    outcomes: { win: 3, loss: 0 },
    forfeit: { winner: 3, loser: 0, counts_as_played: true },
  },
  tiebreak: { criteria: ['points', 'diff'], unresolved_tie: 'shared' },
  forfeit_score: [7, 0],
  exclusion_forfeit_score: null,
  forfeits: { warning_at: 2, exclusion_at: 3 },
};

describe('which scoring settings an edit changes', () => {
  it('names each changed setting, however deep the change', () => {
    expect(scoringChanges(LFR, JSON.parse(JSON.stringify(LFR)) as ScoringSettings)).toEqual([]);
    expect(
      scoringChanges(LFR, {
        ...LFR,
        points: { ...LFR.points, outcomes: { win: 1, loss: 0 } },
        forfeits: { warning_at: 2, exclusion_at: null },
      }),
    ).toEqual(['points', 'forfeits']);
    expect(
      scoringChanges(LFR, {
        ...LFR,
        tiebreak: { criteria: ['diff', 'points'], unresolved_tie: 'shared' },
        exclusion_forfeit_score: [7, 0],
      }),
    ).toEqual(['tiebreak', 'exclusion_forfeit_score']);
  });

  it('finds no change between equal settings, whatever their key order', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5 }), fc.integer({ min: 0, max: 7 }), (win, rounds) => {
        const settings: ScoringSettings = {
          ...LFR,
          points: { ...LFR.points, outcomes: { win, loss: 0 } },
          forfeit_score: [rounds, 0],
        };
        const reordered = {
          forfeits: settings.forfeits,
          exclusion_forfeit_score: settings.exclusion_forfeit_score,
          forfeit_score: settings.forfeit_score,
          tiebreak: settings.tiebreak,
          points: { forfeit: settings.points.forfeit, outcomes: { loss: 0, win } },
        };
        return scoringChanges(settings, reordered).length === 0;
      }),
    );
  });
});

describe('the lock', () => {
  const changed = { ...LFR, points: { ...LFR.points, outcomes: { win: 1, loss: 0 } } };

  it('lets anyone allowed to edit change scoring while no result counts', () => {
    expect(
      checkScoringEdit({
        before: LFR,
        after: changed,
        resultCounts: false,
        owner: false,
        reason: null,
      }),
    ).toEqual({ ok: true, changes: ['points'] });
  });

  it('refuses a scoring change to staff once a result counts', () => {
    expect(
      checkScoringEdit({
        before: LFR,
        after: changed,
        resultCounts: true,
        owner: false,
        reason: 'x',
      }),
    ).toEqual({ ok: false, error: 'scoring_locked', changes: ['points'] });
  });

  it('lets the organisation’s owner change it then, with a reason', () => {
    const edit = { before: LFR, after: changed, resultCounts: true, owner: true };
    expect(checkScoringEdit({ ...edit, reason: '  ' })).toEqual({
      ok: false,
      error: 'reason_required',
      changes: ['points'],
    });
    expect(checkScoringEdit({ ...edit, reason: 'Erreur de saisie au lancement' })).toEqual({
      ok: true,
      changes: ['points'],
    });
  });

  it('never stops an edit that leaves scoring as it is', () => {
    expect(
      checkScoringEdit({ before: LFR, after: LFR, resultCounts: true, owner: false, reason: null }),
    ).toEqual({ ok: true, changes: [] });
  });
});
