import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import type { Actor } from './permissions.ts';
import { publishRules, rulesPage } from './rules.ts';

// The rulebook page (design doc section 7): the version in force, and every earlier one. Staff
// publish a version from the website; it is never edited afterwards, since teams accept a given
// version when they register.

const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const MEMBER: Actor = { ...STAFF, memberRoleIds: [] };
// Midnight in Paris on 1 November and 1 December 2026, in winter time.
const NOV_1 = Date.parse('2026-10-31T23:00:00Z');
const DEC_1 = Date.parse('2026-11-30T23:00:00Z');
const NOW = Date.parse('2026-11-14T12:00:00Z');

const request = (overrides: Partial<Parameters<typeof publishRules>[2]> = {}) => ({
  competitionId: 1,
  version: 'Saison 3',
  markdown: '# Règlement\n\nTrois points par victoire.',
  effectiveOn: '2026-11-01',
  votedOn: null,
  ...overrides,
});

describe('publishRules', () => {
  it('stores the version, from midnight in the league’s time zone, and audits it', () => {
    const db = leagueDatabase();
    const reply = publishRules(db, STAFF, request({ votedOn: '2026-10-20' }), NOW);
    expect(reply).toEqual({ ok: true, id: 1 });
    const staffPlayer = db.select().from(schema.player).get();
    expect(db.select().from(schema.rulesVersion).all()).toEqual([
      {
        id: 1,
        competitionId: 1,
        version: 'Saison 3',
        markdown: '# Règlement\n\nTrois points par victoire.',
        votedAt: Date.parse('2026-10-19T22:00:00Z'),
        effectiveFrom: NOV_1,
        publishedBy: staffPlayer?.id,
        publishedAt: NOW,
      },
    ]);
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      actorKind: 'user',
      action: 'rules.publish',
      entity: 'rules_version',
      entityId: '1',
      afterJson: {
        version: 'Saison 3',
        effectiveFrom: NOV_1,
        votedAt: Date.parse('2026-10-19T22:00:00Z'),
      },
    });
  });

  it('is for the competition’s own staff only', () => {
    const db = leagueDatabase();
    expect(publishRules(db, MEMBER, request(), NOW)).toEqual({ ok: false, error: 'not_staff' });
    expect(publishRules(db, { ...STAFF, guildId: '1' }, request(), NOW)).toEqual({
      ok: false,
      error: 'not_linked',
    });
    expect(publishRules(db, STAFF, request({ competitionId: 2 }), NOW)).toEqual({
      ok: false,
      error: 'not_staff',
    });
    expect(db.select().from(schema.rulesVersion).all()).toEqual([]);
  });

  it.each([
    [{ version: '  ' }, 'version_invalid'],
    [{ version: 'x'.repeat(61) }, 'version_invalid'],
    [{ markdown: ' \n ' }, 'markdown_empty'],
    [{ markdown: 'x'.repeat(200_001) }, 'markdown_too_long'],
    [{ effectiveOn: '2026-13-01' }, 'invalid_date'],
    [{ effectiveOn: '' }, 'invalid_date'],
    [{ votedOn: '1 novembre' }, 'invalid_date'],
  ] as const)('refuses %o: %s', (overrides, error) => {
    const db = leagueDatabase();
    expect(publishRules(db, STAFF, request(overrides), NOW)).toEqual({ ok: false, error });
  });

  it('refuses a name the competition already used: a version is never replaced', () => {
    const db = leagueDatabase();
    publishRules(db, STAFF, request(), NOW);
    expect(publishRules(db, STAFF, request({ version: ' Saison 3 ' }), NOW)).toEqual({
      ok: false,
      error: 'version_taken',
    });
  });
});

describe('rulesPage', () => {
  const twoVersions = () => {
    const db = leagueDatabase();
    publishRules(db, STAFF, request(), NOW);
    publishRules(
      db,
      STAFF,
      request({ version: 'Saison 3, v2', markdown: 'Sept-zéro.', effectiveOn: '2026-12-01' }),
      NOW,
    );
    return db;
  };

  it('shows the version in force, and lists every version, the latest first', () => {
    const page = rulesPage(twoVersions(), 'lfr', NOW);
    if (!page.ok) throw new Error(page.error);
    expect(page.competition).toMatchObject({ name: 'LFR', slug: 'lfr', timeZone: 'Europe/Paris' });
    expect(page.currentId).toBe(1);
    expect(page.shown).toMatchObject({ id: 1, version: 'Saison 3', effectiveFrom: NOV_1 });
    expect(page.versions.map((version) => [version.version, version.effectiveFrom])).toEqual([
      ['Saison 3, v2', DEC_1],
      ['Saison 3', NOV_1],
    ]);
  });

  it('moves to a new version on the day it comes into force', () => {
    const page = rulesPage(twoVersions(), 'lfr', DEC_1);
    expect(page.ok && page.shown?.version).toBe('Saison 3, v2');
  });

  it('shows any version of the competition asked for, and no other', () => {
    const db = twoVersions();
    const page = rulesPage(db, 'lfr', NOW, 2);
    expect(page.ok && [page.shown?.markdown, page.currentId]).toEqual(['Sept-zéro.', 1]);
    expect(rulesPage(db, 'lfr', NOW, 99)).toEqual({ ok: false, error: 'not_found' });
    expect(rulesPage(db, 'lfv', NOW)).toEqual({ ok: false, error: 'not_found' });
  });

  it('shows nothing in force before the first version comes into force', () => {
    const page = rulesPage(twoVersions(), 'lfr', NOV_1 - 1);
    expect(page.ok && [page.shown, page.currentId, page.versions.length]).toEqual([null, null, 2]);
  });
});
