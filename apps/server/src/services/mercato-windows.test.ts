import { mercatoSchema } from '@ligo/core';
import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import {
  closeMercatoWindow,
  mercatoOverview,
  openMercatoWindow,
  type OpenWindowRequest,
} from './mercato-windows.ts';
import type { Actor } from './permissions.ts';

// Mercato windows (design doc section 7; O-35): league staff open one for the season under way
// and may close it early. In leagueDatabase(), LFR's mercato has windows, 3 moves and 24 hours.

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const WINDOW: OpenWindowRequest = {
  opensAt: NOW + HOUR,
  closesAt: NOW + 72 * HOUR,
  maxMovesPerTeam: 3,
  lockHours: 24,
};

describe('opening a mercato window', () => {
  it('stores it for the season under way, audited, and says where to announce it', () => {
    const db = leagueDatabase();
    db.update(schema.leagueGuild).set({ mercatoChannelId: '800000000000000004' }).run();
    const reply = openMercatoWindow(db, STAFF, WINDOW, NOW);
    expect(reply).toMatchObject({
      ok: true,
      window: { opensAt: NOW + HOUR, maxMovesPerTeam: 3, lockHours: 24, closedEarlyAt: null },
      season: { name: 'Saison 3' },
      competition: { name: 'LFR' },
      timeZone: 'Europe/Paris',
      mercatoChannelId: '800000000000000004',
    });
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      action: 'mercato.window.open',
      entity: 'mercato_window',
    });
    const overview = mercatoOverview(db, STAFF, NOW);
    expect(overview.ok && overview.windows.map((row) => row.state)).toEqual(['upcoming']);
    const later = mercatoOverview(db, STAFF, NOW + 2 * HOUR);
    expect(later.ok && later.windows.map((row) => row.state)).toEqual(['open']);
    expect(later.ok && later.settings).toEqual({
      mode: 'windows',
      max_moves_per_team: 3,
      lock_hours: 24,
      intra_club_moves: 'counted',
    });
  });

  it('takes no limit, and refuses wrong dates, limits and hours', () => {
    const db = leagueDatabase();
    expect(openMercatoWindow(db, STAFF, { ...WINDOW, maxMovesPerTeam: null }, NOW)).toMatchObject({
      ok: true,
      window: { maxMovesPerTeam: null },
    });
    const refused = (request: Partial<OpenWindowRequest>) =>
      openMercatoWindow(leagueDatabase(), STAFF, { ...WINDOW, ...request }, NOW);
    expect(refused({ closesAt: WINDOW.opensAt })).toEqual({
      ok: false,
      error: 'closes_before_opening',
    });
    expect(refused({ opensAt: NOW - 9 * HOUR, closesAt: NOW })).toEqual({
      ok: false,
      error: 'closes_in_past',
    });
    expect(refused({ maxMovesPerTeam: 0 })).toEqual({ ok: false, error: 'invalid_limit' });
    expect(refused({ lockHours: -1 })).toEqual({ ok: false, error: 'invalid_lock' });
    expect(refused({ lockHours: 1.5 })).toEqual({ ok: false, error: 'invalid_lock' });
  });

  it('refuses a window overlapping another, but not one closed before it opened', () => {
    const db = leagueDatabase();
    const first = openMercatoWindow(db, STAFF, WINDOW, NOW);
    const overlapping = { ...WINDOW, opensAt: NOW + 70 * HOUR, closesAt: NOW + 100 * HOUR };
    expect(openMercatoWindow(db, STAFF, overlapping, NOW)).toEqual({
      ok: false,
      error: 'overlaps',
    });
    const after = { ...WINDOW, opensAt: NOW + 72 * HOUR, closesAt: NOW + 100 * HOUR };
    expect(openMercatoWindow(db, STAFF, after, NOW)).toMatchObject({ ok: true });
    if (!first.ok) throw new Error('the first window opens');
    closeMercatoWindow(db, STAFF, first.window.id, NOW);
    expect(openMercatoWindow(db, STAFF, WINDOW, NOW)).toMatchObject({ ok: true });
  });

  it('has no windows when the league’s mercato is always open', () => {
    const db = leagueDatabase();
    const row = db.select().from(schema.competition).get();
    if (!row) throw new Error('LFR is seeded');
    db.update(schema.competition)
      .set({ rulesetJson: { ...row.rulesetJson, mercato: mercatoSchema.parse({}) } })
      .run();
    expect(openMercatoWindow(db, STAFF, WINDOW, NOW)).toEqual({
      ok: false,
      error: 'always_open',
    });
  });

  it('is for league staff only', () => {
    const db = leagueDatabase();
    expect(openMercatoWindow(db, { ...STAFF, memberRoleIds: [] }, WINDOW, NOW)).toEqual({
      ok: false,
      error: 'not_staff',
    });
    expect(mercatoOverview(db, { ...STAFF, memberRoleIds: [] }, NOW)).toEqual({
      ok: false,
      error: 'not_staff',
    });
    expect(db.select().from(schema.mercatoWindow).all()).toEqual([]);
  });
});

describe('closing a mercato window early', () => {
  it('closes an open window now, audited, once', () => {
    const db = leagueDatabase();
    const opened = openMercatoWindow(db, STAFF, WINDOW, NOW);
    if (!opened.ok) throw new Error('the window opens');
    const at = NOW + 5 * HOUR;
    expect(closeMercatoWindow(db, STAFF, opened.window.id, at)).toMatchObject({
      ok: true,
      wasOpen: true,
      window: { closedEarlyAt: at },
    });
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      action: 'mercato.window.close',
    });
    expect(closeMercatoWindow(db, STAFF, opened.window.id, at + 1)).toEqual({
      ok: false,
      error: 'already_closed',
    });
    const overview = mercatoOverview(db, STAFF, at + 1);
    expect(overview.ok && overview.windows.map((row) => row.state)).toEqual(['closed']);
  });

  it('cancels a window still to come, and finds no window of another league', () => {
    const db = leagueDatabase();
    const opened = openMercatoWindow(db, STAFF, WINDOW, NOW);
    if (!opened.ok) throw new Error('the window opens');
    expect(closeMercatoWindow(db, STAFF, opened.window.id, NOW)).toMatchObject({
      ok: true,
      wasOpen: false,
    });
    expect(closeMercatoWindow(db, STAFF, 999, NOW)).toEqual({
      ok: false,
      error: 'window_not_found',
    });
  });
});
