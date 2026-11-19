import { schema } from '@ligo/db';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase } from '../testing.ts';
import {
  competitionAdmin,
  createCompetition,
  GENERAL_FIELDS,
  updateCompetitionGeneral,
} from './admin-competitions.ts';
import { createOrg } from './orgs.ts';
import { ensurePlayer } from './players.ts';

// Competitions in the admin panel (phase 3h; design doc section 7, M-20): the organisation's
// owner creates them; the owner and the competition's staff change its general settings.

const NOW = 1_800_000_000_000;
const OWNER = { discordUserId: '994597181476569170', playerId: 0 };
const STAFFER = { discordUserId: '222222222222222222', playerId: 0 };

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
  const lfr = db.select().from(schema.competition).get();
  if (!lfr) throw new Error('LFR is seeded');
  const create = (values: Partial<Parameters<typeof createCompetition>[3]> = {}) =>
    createCompetition(
      db,
      owner,
      'mlb-group',
      { title: 'valorant', name: 'LFV', slug: 'lfv', participantMode: 'team', ...values },
      NOW,
    );
  /** The general form as the page fills it from the current settings, with some changes. */
  const form = (changes: Record<string, string> = {}): Record<string, string> => ({
    name: 'LFR',
    'ruleset.result_validation': 'opponent',
    'scheduling.time_zone': 'Europe/Paris',
    'scheduling.rounds_per_week': '1',
    'scheduling.extension_weeks': '1',
    'scheduling.auto_slot.weekday': '7',
    'scheduling.auto_slot.time': '21:00',
    'ruleset.requests.approval.team_owner': 'staff',
    'ruleset.requests.approval.team_member_add': 'staff',
    'ruleset.requests.approval.team_member_remove': 'auto',
    'ruleset.requests.approval.roster_move': 'staff',
    'ruleset.requests.answer_within_hours': '24',
    'ruleset.requests.remind_before_hours': '6',
    'ruleset.team_roles.managers_max': '3',
    'ruleset.team_roles.coaches_max': '1',
    ...changes,
  });
  const reload = () =>
    db.select().from(schema.competition).where(eq(schema.competition.id, lfr.id)).get();
  return { db, owner, lfr, create, form, reload };
}

describe('creating a competition', () => {
  it('is for the organisation’s owner, with the game’s defaults, audited', () => {
    const { db, create } = league();
    expect(create()).toEqual({ ok: true, slug: 'lfv' });
    const row = db
      .select()
      .from(schema.competition)
      .where(and(eq(schema.competition.orgId, 1), eq(schema.competition.slug, 'lfv')))
      .get();
    expect(row).toMatchObject({
      title: 'valorant',
      name: 'LFV',
      participantMode: 'team',
      rulesetJson: { result_validation: 'staff', game_score: null },
      pointsJson: { outcomes: { win: 3, loss: 0 } },
      tiebreakJson: { criteria: ['points', 'diff'], unresolved_tie: 'shared' },
      schedulingJson: { rounds_per_week: 1, time_zone: 'Europe/Paris' },
    });
    expect(create({ title: 'r6', slug: 'lfr2' })).toEqual({ ok: true, slug: 'lfr2' });
    expect(
      db.select().from(schema.competition).where(eq(schema.competition.slug, 'lfr2')).get()
        ?.rulesetJson.game_score,
    ).toEqual({ win_at: 7, overtime_rounds: 3 });
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      action: 'competition.create',
      afterJson: { title: 'r6', name: 'LFV', slug: 'lfr2' },
    });
  });

  it('refuses another owner, a slug taken or reserved, and an unknown game or mode', () => {
    const { db, create } = league();
    const zoe = {
      discordUserId: '700000000000000031',
      playerId: ensurePlayer(
        db,
        { orgId: 1, discordUserId: '700000000000000031', displayName: 'Zoé' },
        1,
      ).id,
    };
    expect(
      createCompetition(
        db,
        zoe,
        'mlb-group',
        { title: 'r6', name: 'X', slug: 'x', participantMode: 'team' },
        NOW,
      ),
    ).toEqual({ ok: false, error: 'not_owner' });
    createOrg(
      db,
      zoe,
      { name: 'Zoé League', slug: '', locale: 'fr', description: '' },
      { managesAServer: true },
      NOW,
    );
    // Another organisation may use LFR's slug.
    expect(
      createCompetition(
        db,
        zoe,
        'zoe-league',
        { title: 'r6', name: 'LFR', slug: 'lfr', participantMode: 'team' },
        NOW,
      ),
    ).toEqual({ ok: true, slug: 'lfr' });
    expect(create({ slug: 'lfr' })).toEqual({ ok: false, errors: { slug: 'taken' } });
    expect(create({ slug: 'new' })).toEqual({ ok: false, errors: { slug: 'reserved' } });
    expect(create({ title: 'chess', participantMode: 'solo' })).toEqual({
      ok: false,
      errors: { title: 'invalid', participantMode: 'invalid' },
    });
  });
});

describe('a competition’s general settings', () => {
  it('open for the organisation’s owner and the competition’s staff only', () => {
    const { db, owner, lfr } = league();
    expect(competitionAdmin(db, owner, 'mlb-group', 'lfr', [])).toMatchObject({
      ok: true,
      owner: true,
      competition: { id: lfr.id, name: 'LFR', title: 'r6' },
      values: { 'ruleset.result_validation': 'opponent', 'scheduling.auto_slot.time': '21:00' },
    });
    expect(competitionAdmin(db, STAFFER, 'mlb-group', 'lfr', [lfr.id])).toMatchObject({
      ok: true,
      owner: false,
    });
    expect(competitionAdmin(db, STAFFER, 'mlb-group', 'lfr', [])).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    expect(competitionAdmin(db, owner, 'mlb-group', 'nope', [])).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(GENERAL_FIELDS.map((field) => field.path)).toContain('scheduling.time_zone');
  });

  it('saves the changes, keeps every other setting, and audits it', () => {
    const { db, owner, lfr, form, reload } = league();
    const before = reload();
    const reply = updateCompetitionGeneral(
      db,
      owner,
      { orgSlug: 'mlb-group', compSlug: 'lfr', staffIds: [] },
      form({
        name: 'Ligue Française R6',
        'ruleset.result_validation': 'staff',
        'scheduling.auto_slot.weekday': '',
        'ruleset.requests.remind_before_hours': '',
      }),
      NOW,
    );
    expect(reply).toEqual({ ok: true });
    const after = reload();
    expect(after).toMatchObject({
      name: 'Ligue Française R6',
      rulesetJson: {
        result_validation: 'staff',
        requests: { remind_before_hours: null },
        // Not on this form: unchanged.
        mercato: before?.rulesetJson.mercato,
      },
      schedulingJson: { auto_slot: null },
      pointsJson: before?.pointsJson,
    });
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      action: 'competition.settings',
      entity: 'competition',
      entityId: String(lfr.id),
      beforeJson: { name: 'LFR' },
      afterJson: { name: 'Ligue Française R6' },
    });
  });

  it('refuses what the settings cannot hold, field by field, and saves nothing', () => {
    const { db, owner, form, reload } = league();
    const before = reload();
    expect(
      updateCompetitionGeneral(
        db,
        owner,
        { orgSlug: 'mlb-group', compSlug: 'lfr', staffIds: [] },
        form({
          'scheduling.time_zone': 'Mars/Olympus',
          'scheduling.extension_weeks': '9',
          'ruleset.requests.answer_within_hours': '4',
          'ruleset.requests.remind_before_hours': '6',
          name: 'X',
        }),
        NOW,
      ),
    ).toEqual({
      ok: false,
      error: 'invalid',
      errors: {
        name: 'invalid',
        'scheduling.time_zone': 'invalid',
        'scheduling.extension_weeks': 'invalid',
        // The reminder must come before the deadline: a rule across two fields.
        'ruleset.requests': 'invalid',
      },
    });
    expect(reload()).toEqual(before);
  });
});
