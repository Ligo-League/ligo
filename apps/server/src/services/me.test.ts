import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { countryChoices, loginPlayer, profileOf, setNationality, setStatsConsent } from './me.ts';
import { setTeamOwner } from './team-staff.ts';

// A player's own account on the website (design doc section 7, `/me`).

const ANA = { id: '700000000000000001', displayName: 'Ana' };
const NOW = 1_800_000_000_000;

describe('loginPlayer', () => {
  it('creates the player of a Discord account on first login, and finds it afterwards', () => {
    const db = leagueDatabase();
    const first = loginPlayer(db, ANA, NOW);
    expect(first).toMatchObject({
      ok: true,
      player: { discordUserId: ANA.id, displayName: 'Ana' },
    });
    const again = loginPlayer(db, { ...ANA, displayName: 'Ana B.' }, NOW + 1);
    expect(again.ok && again.player.id).toBe(first.ok && first.player.id);
  });

  it('finds the player the bot already knows', () => {
    const db = leagueDatabase();
    const staff = {
      guildId: TEST_GUILD,
      user: { id: '222222222222222222', displayName: 'Léa Staff' },
      memberRoleIds: [TEST_STAFF_ROLE],
    };
    setTeamOwner(db, staff, { teamId: 1, member: ANA }, 100);
    const login = loginPlayer(db, ANA, NOW);
    expect(login.ok && profileOf(db, login.player.id)?.teams).toEqual([
      { name: 'Alpha Esport', slug: 'alpha-esport', role: 'owner' },
    ]);
  });

  it('refuses a login while no organisation exists to hold the player', () => {
    const db = leagueDatabase();
    db.$client.pragma('foreign_keys = OFF');
    db.delete(schema.org).run();
    expect(loginPlayer(db, ANA, NOW)).toEqual({ ok: false, error: 'no_org' });
  });
});

describe('setNationality', () => {
  it('stores a country code, audited, and clears it', () => {
    const db = leagueDatabase();
    const login = loginPlayer(db, ANA, NOW);
    if (!login.ok) throw new Error(login.error);
    const id = login.player.id;
    expect(setNationality(db, id, 'be', NOW)).toEqual({ ok: true });
    expect(profileOf(db, id)?.player.nationality).toBe('BE');
    expect(setNationality(db, id, '', NOW)).toEqual({ ok: true });
    expect(profileOf(db, id)?.player.nationality).toBeNull();
    const audit = db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'player.nationality'))
      .all();
    expect(audit.map((row) => [row.beforeJson, row.afterJson])).toEqual([
      [{ nationality: null }, { nationality: 'BE' }],
      [{ nationality: 'BE' }, { nationality: null }],
    ]);
  });

  it.each(['XX', 'ZZ', 'EU', 'FRA', 'F1'])('refuses %s', (code) => {
    const db = leagueDatabase();
    const login = loginPlayer(db, ANA, NOW);
    if (!login.ok) throw new Error(login.error);
    expect(setNationality(db, login.player.id, code, NOW)).toEqual({
      ok: false,
      error: 'invalid_nationality',
    });
  });
});

describe('setStatsConsent', () => {
  it('records the consent with its time, and its withdrawal, both audited', () => {
    const db = leagueDatabase();
    const login = loginPlayer(db, ANA, NOW);
    if (!login.ok) throw new Error(login.error);
    const id = login.player.id;
    setStatsConsent(db, id, true, NOW);
    expect(profileOf(db, id)?.player.statsConsentAt).toBe(NOW);
    // Giving it again keeps the first time.
    setStatsConsent(db, id, true, NOW + 5);
    expect(profileOf(db, id)?.player.statsConsentAt).toBe(NOW);
    setStatsConsent(db, id, false, NOW + 10);
    expect(profileOf(db, id)?.player.statsConsentAt).toBeNull();
    const actions = db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entity, 'player'))
      .all();
    expect(actions.map((row) => row.action)).toEqual([
      'player.stats_consent.give',
      'player.stats_consent.withdraw',
    ]);
  });
});

describe('countryChoices', () => {
  it('lists real countries by name in the locale, without pseudo-regions', () => {
    const choices = countryChoices('fr');
    expect(choices.find((choice) => choice.code === 'FR')?.name).toBe('France');
    expect(choices.some((choice) => ['ZZ', 'EU', 'UN'].includes(choice.code))).toBe(false);
    expect(choices.length).toBeGreaterThan(200);
    const names = choices.map((choice) => choice.name);
    expect(names).toEqual([...names].sort((x, y) => x.localeCompare(y, 'fr')));
  });
});
