import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { registrationDatabase } from '../testing.ts';
import { createCompetition } from './admin-competitions.ts';
import { advanceSeason, createSeason, seasonAdmin, updateSeason } from './admin-seasons.ts';
import { ensurePlayer } from './players.ts';

// Seasons in the admin panel (phase 3h; design doc section 7, M-40): the organisation's owner and
// the competition's staff create a season and change its dates, settings and status, which only
// moves forward. Once a result counts in a season, its scoring settings change only through the
// organisation's owner, with a reason.

const NOW = 1_800_000_000_000;
const OWNER_ID = '994597181476569170';
/** Season 3 has counted results (seeded); Season 4 takes registrations, with none. */
const SEASON_3 = 1;
const SEASON_4 = 2;

function league() {
  const db = registrationDatabase();
  const owner = {
    discordUserId: OWNER_ID,
    playerId: ensurePlayer(db, { orgId: 1, discordUserId: OWNER_ID, displayName: 'Owner' }, 1).id,
  };
  const STAFFER_ID = '222222222222222222';
  const staffer = {
    discordUserId: STAFFER_ID,
    playerId: ensurePlayer(db, { orgId: 1, discordUserId: STAFFER_ID, displayName: 'Staff' }, 1).id,
  };
  const competitionId = db.select().from(schema.competition).get()?.id ?? 0;
  const key = (seasonId: number, asStaff = false) => ({
    orgSlug: 'mlb-group',
    compSlug: 'lfr',
    seasonId,
    staffIds: asStaff ? [competitionId] : [],
  });
  const seasonRow = (id: number) =>
    db.select().from(schema.season).where(eq(schema.season.id, id)).get();
  const view = (id: number) => {
    const found = seasonAdmin(db, owner, 'mlb-group', 'lfr', id, []);
    if (!found.ok) throw new Error(found.error);
    return found;
  };
  /** The season's form as its page fills it, with some changes. */
  const form = (id: number, changes: Record<string, string> = {}) => ({
    ...view(id).values,
    reason: '',
    ...changes,
  });
  const lastAudit = () => db.select().from(schema.auditLog).all().at(-1);
  return { db, owner, staffer, competitionId, key, seasonRow, view, form, lastAudit };
}

const DATES = { starts_on: '2027-04-05', ends_on: '2027-06-13' };

describe('creating a season', () => {
  it('opens it for registration, with the competition’s points and the last season’s settings', () => {
    const { db, owner, key, seasonRow, competitionId, lastAudit } = league();
    // The competition's points changed since Season 4 was opened: the new season takes them.
    const competition = db.select().from(schema.competition).get();
    if (!competition) throw new Error('LFR is seeded');
    db.update(schema.competition)
      .set({ pointsJson: { ...competition.pointsJson, outcomes: { win: 2, loss: 0 } } })
      .where(eq(schema.competition.id, competitionId))
      .run();
    const reply = createSeason(db, owner, key(0), { name: ' Saison 5 ', ...DATES }, NOW);
    if (!reply.ok) throw new Error(JSON.stringify(reply));
    const created = seasonRow(reply.id);
    const previous = seasonRow(SEASON_4);
    expect(created).toMatchObject({
      competitionId,
      name: 'Saison 5',
      startsOn: '2027-04-05',
      endsOn: '2027-06-13',
      status: 'registration',
    });
    expect(created?.settingsJson.points.outcomes.win).toBe(2);
    expect(created?.settingsJson.tiebreak).toEqual(competition.tiebreakJson);
    expect(created?.settingsJson.map_pool).toEqual(previous?.settingsJson.map_pool);
    expect(created?.settingsJson.forfeit_score).toEqual(previous?.settingsJson.forfeit_score);
    expect(created?.settingsJson.forfeits).toEqual(previous?.settingsJson.forfeits);
    expect(lastAudit()).toMatchObject({
      action: 'season.create',
      entity: 'season',
      entityId: String(reply.id),
      actorPlayerId: owner.playerId,
    });
  });

  it('gives a competition’s first season a forfeit won by a map’s rounds, and no maps yet', () => {
    const { db, owner, seasonRow } = league();
    expect(
      createCompetition(
        db,
        owner,
        'mlb-group',
        { title: 'r6', name: 'Benelux', slug: 'bsl', participantMode: 'team' },
        NOW,
      ),
    ).toMatchObject({ ok: true });
    const reply = createSeason(
      db,
      owner,
      { orgSlug: 'mlb-group', compSlug: 'bsl', staffIds: [] },
      { name: 'Season 1', ...DATES },
      NOW,
    );
    if (!reply.ok) throw new Error(JSON.stringify(reply));
    expect(seasonRow(reply.id)?.settingsJson).toMatchObject({
      forfeit_score: { winner: [7, 0], loser: [0, 7] },
      exclusion_forfeit_score: null,
      map_pool: [],
    });
  });

  it('refuses a name already used, one its address would share, a reserved word and bad dates', () => {
    const { db, owner, key } = league();
    const create = (values: Record<string, string>) =>
      createSeason(db, owner, key(0), { ...DATES, ...values }, NOW);
    expect(create({ name: 'Saison 3' })).toEqual({
      ok: false,
      error: 'invalid',
      errors: { name: 'taken' },
    });
    // Its address would be `/mlb-group/lfr/saison-4`, Season 4's.
    expect(create({ name: 'SAISON-4' })).toMatchObject({ errors: { name: 'taken' } });
    expect(create({ name: 'Rules' })).toMatchObject({ errors: { name: 'reserved' } });
    expect(create({ name: '', starts_on: 'demain', ends_on: '2027-01-01' })).toEqual({
      ok: false,
      error: 'invalid',
      errors: { name: 'invalid', starts_on: 'invalid' },
    });
    expect(create({ name: 'Saison 5', ends_on: '2027-04-04' })).toEqual({
      ok: false,
      error: 'invalid',
      errors: { ends_on: 'invalid' },
    });
  });

  it('is for the organisation’s owner and the competition’s staff', () => {
    const { db, staffer, key } = league();
    expect(createSeason(db, staffer, key(0, true), { name: 'Saison 5', ...DATES }, NOW)).toEqual({
      ok: true,
      id: 3,
    });
    expect(createSeason(db, staffer, key(0), { name: 'Saison 6', ...DATES }, NOW)).toEqual({
      ok: false,
      error: 'not_allowed',
    });
  });
});

describe('a season’s page', () => {
  it('shows its settings as inputs, whether its scoring is locked, and the statuses ahead', () => {
    const { view } = league();
    const open = view(SEASON_4);
    expect(open).toMatchObject({
      season: { id: SEASON_4, name: 'Saison 4', status: 'registration' },
      locked: false,
      nextStatuses: ['active', 'cup', 'closed'],
    });
    expect(open.values).toMatchObject({
      name: 'Saison 4',
      'settings.points.outcomes.win': '3',
      // The test league scores a forfeit 0-0.
      'settings.forfeit_score.winner.0': '0',
      'settings.forfeit_score.loser.1': '0',
      'settings.exclusion_forfeit_score.winner.0': '',
      'settings.forfeits.exclusion_at': '3',
    });
    expect(open.values['settings.map_pool']?.split('\n')).toContain('Nighthaven Labs');
    expect(open.divisions.map((division) => division.categoryPrefix)).toEqual(['L1', 'L2']);
    expect(view(SEASON_3)).toMatchObject({ locked: true, nextStatuses: ['cup', 'closed'] });
  });

  it('is not found for a season of another competition', () => {
    const { db, owner } = league();
    expect(
      createCompetition(
        db,
        owner,
        'mlb-group',
        { title: 'r6', name: 'Benelux', slug: 'bsl', participantMode: 'team' },
        NOW,
      ),
    ).toMatchObject({ ok: true });
    expect(seasonAdmin(db, owner, 'mlb-group', 'bsl', SEASON_4, [])).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});

describe('saving a season', () => {
  it('stores its name, dates and settings before any result, and audits it', () => {
    const { db, owner, key, form, seasonRow, lastAudit } = league();
    const before = seasonRow(SEASON_4);
    expect(
      updateSeason(
        db,
        owner,
        key(SEASON_4),
        form(SEASON_4, {
          name: 'Saison 4 (2027)',
          ends_on: '2027-03-21',
          'settings.points.outcomes.win': '2',
          'settings.forfeit_score.winner.0': '7',
          'settings.forfeit_score.loser.1': '7',
          'settings.exclusion_forfeit_score.winner.0': '3',
          'settings.exclusion_forfeit_score.winner.1': '0',
          'settings.exclusion_forfeit_score.loser.0': '0',
          'settings.exclusion_forfeit_score.loser.1': '3',
          'settings.forfeits.warning_at': '',
          'settings.map_pool': 'Bank\nClubhouse\n\n Oregon ',
        }),
        NOW,
      ),
    ).toEqual({ ok: true });
    const after = seasonRow(SEASON_4);
    expect(after).toMatchObject({ name: 'Saison 4 (2027)', endsOn: '2027-03-21' });
    expect(after?.settingsJson).toMatchObject({
      points: { outcomes: { win: 2 } },
      forfeit_score: { winner: [7, 0], loser: [0, 7] },
      exclusion_forfeit_score: { winner: [3, 0], loser: [0, 3] },
      forfeits: { warning_at: null, exclusion_at: 3 },
      map_pool: ['Bank', 'Clubhouse', 'Oregon'],
    });
    expect(lastAudit()).toMatchObject({
      action: 'season.settings',
      entity: 'season',
      entityId: String(SEASON_4),
      beforeJson: { name: before?.name, settings: before?.settingsJson },
    });
  });

  it('takes an empty forfeit score for the 50% rule as the usual forfeit score', () => {
    const { db, owner, key, form, seasonRow } = league();
    const filled = {
      'settings.exclusion_forfeit_score.winner.0': '3',
      'settings.exclusion_forfeit_score.winner.1': '0',
      'settings.exclusion_forfeit_score.loser.0': '0',
      'settings.exclusion_forfeit_score.loser.1': '3',
    };
    expect(updateSeason(db, owner, key(SEASON_4), form(SEASON_4, filled), NOW)).toEqual({
      ok: true,
    });
    const emptied = Object.fromEntries(Object.keys(filled).map((path) => [path, '']));
    expect(updateSeason(db, owner, key(SEASON_4), form(SEASON_4, emptied), NOW)).toEqual({
      ok: true,
    });
    expect(seasonRow(SEASON_4)?.settingsJson.exclusion_forfeit_score).toBeNull();
    // Half a score is a mistake, not "none".
    expect(
      updateSeason(
        db,
        owner,
        key(SEASON_4),
        form(SEASON_4, { 'settings.exclusion_forfeit_score.winner.0': '3' }),
        NOW,
      ),
    ).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('refuses dates the wrong way round, a name taken and a criterion the standings lack', () => {
    const { db, owner, key, form } = league();
    expect(
      updateSeason(
        db,
        owner,
        key(SEASON_4),
        form(SEASON_4, {
          name: 'Saison 3',
          ends_on: '2026-12-31',
          'settings.tiebreak.criteria.2': 'h2h_points',
        }),
        NOW,
      ),
    ).toEqual({
      ok: false,
      error: 'invalid',
      errors: { name: 'taken', ends_on: 'invalid', 'settings.tiebreak.criteria': 'invalid' },
    });
  });

  it('keeps the scoring of a season with a counted result from staff', () => {
    const { db, staffer, key, form, seasonRow } = league();
    const before = seasonRow(SEASON_3);
    expect(
      updateSeason(
        db,
        staffer,
        key(SEASON_3, true),
        form(SEASON_3, {
          'settings.points.outcomes.win': '2',
          'settings.forfeits.exclusion_at': '4',
        }),
        NOW,
      ),
    ).toEqual({
      ok: false,
      error: 'invalid',
      errors: { 'settings.points': 'locked', 'settings.forfeits': 'locked' },
    });
    expect(seasonRow(SEASON_3)).toEqual(before);
    // Everything else still changes: a map rotated out, say.
    expect(
      updateSeason(
        db,
        staffer,
        key(SEASON_3, true),
        form(SEASON_3, { 'settings.map_pool': 'Bank\nChalet' }),
        NOW,
      ),
    ).toEqual({ ok: true });
    expect(seasonRow(SEASON_3)?.settingsJson.map_pool).toEqual(['Bank', 'Chalet']);
  });

  it('lets the organisation’s owner change it, with a reason kept in the audit log', () => {
    const { db, owner, key, form, seasonRow, lastAudit } = league();
    const change = { 'settings.points.outcomes.win': '2' };
    expect(updateSeason(db, owner, key(SEASON_3), form(SEASON_3, change), NOW)).toEqual({
      ok: false,
      error: 'invalid',
      errors: { reason: 'required' },
    });
    expect(
      updateSeason(
        db,
        owner,
        key(SEASON_3),
        form(SEASON_3, { ...change, reason: ' Vote des équipes ' }),
        NOW,
      ),
    ).toEqual({ ok: true });
    expect(seasonRow(SEASON_3)?.settingsJson.points.outcomes.win).toBe(2);
    expect(lastAudit()).toMatchObject({
      action: 'season.settings',
      afterJson: { reason: 'Vote des équipes', scoringChanges: ['points'] },
    });
  });
});

describe('a season’s status', () => {
  it('only moves forward, audited', () => {
    const { db, owner, key, seasonRow, lastAudit } = league();
    expect(advanceSeason(db, owner, key(SEASON_4), 'active', NOW)).toEqual({ ok: true });
    expect(seasonRow(SEASON_4)?.status).toBe('active');
    expect(lastAudit()).toMatchObject({
      action: 'season.status',
      beforeJson: { status: 'registration' },
      afterJson: { status: 'active' },
    });
    expect(advanceSeason(db, owner, key(SEASON_4), 'registration', NOW)).toEqual({
      ok: false,
      error: 'backward',
    });
    expect(advanceSeason(db, owner, key(SEASON_4), 'active', NOW)).toEqual({
      ok: false,
      error: 'backward',
    });
    // A league without a cup goes straight to the end.
    expect(advanceSeason(db, owner, key(SEASON_4), 'closed', NOW)).toEqual({ ok: true });
  });

  it('is for the organisation’s owner and the competition’s staff', () => {
    const { db, staffer, key } = league();
    expect(advanceSeason(db, staffer, key(SEASON_4), 'active', NOW)).toEqual({
      ok: false,
      error: 'not_allowed',
    });
    expect(advanceSeason(db, staffer, key(SEASON_4, true), 'active', NOW)).toEqual({ ok: true });
  });
});
