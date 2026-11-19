import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase } from '../testing.ts';
import { competitionRules, updateCompetitionRules } from './admin-rules.ts';
import { ensurePlayer } from './players.ts';

// A competition's rules in the admin panel (phase 3h; design doc section 7): the points and
// tie-breakers new seasons copy, how a map is won, the veto, promotion, registration, the
// mercato, stats and dispute reasons. The organisation's owner and the competition's staff.

const NOW = 1_800_000_000_000;
const OWNER = { discordUserId: '994597181476569170', playerId: 0 };
const KEY = { orgSlug: 'mlb-group', compSlug: 'lfr', staffIds: [] as number[] };

function league() {
  const db = leagueDatabase();
  const owner = {
    ...OWNER,
    playerId: ensurePlayer(
      db,
      { orgId: 1, discordUserId: OWNER.discordUserId, displayName: 'Owner' },
      1,
    ).id,
  };
  const lfr = () =>
    db.select().from(schema.competition).where(eq(schema.competition.slug, 'lfr')).get();
  const view = competitionRules(db, owner, 'mlb-group', 'lfr', []);
  if (!view.ok) throw new Error(view.error);
  /** The rules form as the page fills it, with some changes. */
  const form = (changes: Record<string, string> = {}) => ({ ...view.values, ...changes });
  const save = (changes: Record<string, string>) =>
    updateCompetitionRules(db, owner, KEY, form(changes), NOW);
  return { db, owner, lfr, view, save };
}

describe('a competition’s rules form', () => {
  it('shows every rule as its inputs, with blank rows to add dispute reasons', () => {
    const { view } = league();
    expect(view.values).toMatchObject({
      'points.outcomes.win': '3',
      'points.forfeit.counts_as_played': 'true',
      'tiebreak.criteria.0': 'points',
      'tiebreak.criteria.1': 'diff',
      'tiebreak.criteria.2': '',
      'ruleset.game_score.win_at': '7',
      'ruleset.veto.formats.bo1.sequence': 'A_ban B_ban A_ban B_ban A_ban B_ban A_ban B_ban',
      'ruleset.veto.formats.bo3.decider_side': 'coin',
      'ruleset.registration.min_age': '16',
      'ruleset.mercato.mode': 'windows',
      'ruleset.stats.entry_days': '',
      'ruleset.dispute_reasons.0.key': 'wrong_score',
      'ruleset.dispute_reasons.5.key': '',
    });
    // Five reasons and three blank rows.
    expect(view.reasonRows).toBe(8);
    expect(view.vetoFormats).toEqual(['bo1', 'bo3', 'bo5']);
  });
});

describe('saving the rules', () => {
  it('stores each change where it belongs, leaves the rest, and audits it', () => {
    const { db, lfr, save } = league();
    const before = lfr();
    expect(
      save({
        'points.outcomes.win': '1',
        'tiebreak.criteria.1': 'wins',
        'tiebreak.criteria.2': 'diff',
        'ruleset.mercato.max_moves_per_team': '',
        'ruleset.registration.min_age': '',
        'ruleset.dispute_reasons.1.key': '',
        'ruleset.dispute_reasons.1.label.fr': '',
        'ruleset.dispute_reasons.1.label.en': '',
        'ruleset.dispute_reasons.5.key': 'late',
        'ruleset.dispute_reasons.5.label.fr': 'Retard',
      }),
    ).toEqual({ ok: true });
    const after = lfr();
    expect(after?.pointsJson.outcomes.win).toBe(1);
    expect(after?.tiebreakJson.criteria).toEqual(['points', 'wins', 'diff']);
    expect(after?.rulesetJson.mercato.max_moves_per_team).toBeNull();
    expect(after?.rulesetJson.registration.min_age).toBeNull();
    expect(after?.rulesetJson.dispute_reasons.map((reason) => reason.key)).toEqual([
      'wrong_score',
      'ineligible_player',
      'not_played',
      'technical',
      'late',
    ]);
    // Not on the form: unchanged.
    expect(after?.rulesetJson.result_validation).toBe(before?.rulesetJson.result_validation);
    expect(after?.schedulingJson).toEqual(before?.schedulingJson);
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      action: 'competition.rules',
      entity: 'competition',
    });
  });

  it('lets a league accept any score with a winner', () => {
    const { lfr, save } = league();
    expect(
      save({ 'ruleset.game_score.win_at': '', 'ruleset.game_score.overtime_rounds': '' }),
    ).toEqual({ ok: true });
    expect(lfr()?.rulesetJson.game_score).toBeNull();
  });

  it('refuses rules the schemas refuse, field by field, and saves nothing', () => {
    const { lfr, save } = league();
    const before = lfr();
    expect(
      save({
        'tiebreak.criteria.0': 'diff',
        'tiebreak.criteria.1': 'diff',
        'ruleset.veto.formats.bo3.sequence': 'A_ban B_ban A_pick',
        'ruleset.registration.division_max': '1',
        'ruleset.dispute_reasons.0.key': 'Wrong Score',
      }),
    ).toEqual({
      ok: false,
      error: 'invalid',
      errors: {
        'tiebreak.criteria': 'invalid',
        // A best-of-N picks N − 1 maps: a rule over the formats.
        'ruleset.veto.formats': 'invalid',
        'ruleset.registration.division_max': 'invalid',
        'ruleset.dispute_reasons': 'invalid',
      },
    });
    expect(lfr()).toEqual(before);
  });

  it('offers only the tie-breakers the standings compute', () => {
    const { save } = league();
    expect(save({ 'tiebreak.criteria.2': 'h2h_points' })).toMatchObject({
      ok: false,
      errors: { 'tiebreak.criteria': 'invalid' },
    });
  });

  it('is for the organisation’s owner and the competition’s staff', () => {
    const { db } = league();
    const stranger = { discordUserId: '700000000000000031', playerId: 1 };
    expect(updateCompetitionRules(db, stranger, KEY, {}, NOW)).toEqual({
      ok: false,
      error: 'not_allowed',
    });
  });
});
