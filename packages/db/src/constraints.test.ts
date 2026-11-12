import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLog, gameAccount, org, player, team } from './schema/index.ts';
import { openTestDatabase } from './testing.ts';

function seededDatabase() {
  const db = openTestDatabase();
  const lfr = db
    .insert(org)
    .values({ name: 'LFR', slug: 'lfr', settingsJson: {} })
    .returning()
    .get();
  const alice = db
    .insert(player)
    .values({ orgId: lfr.id, slug: 'alice', displayName: 'Alice', createdAt: 1 })
    .returning()
    .get();
  return { db, lfr, alice };
}

describe('*_json columns', () => {
  it('return the stored value as an object', () => {
    const { db, lfr } = seededDatabase();
    const colors = ['#112233', '#AABBCC'];
    const socials = [{ label: 'X', url: 'https://x.com/example' }];
    db.insert(team)
      .values({
        orgId: lfr.id,
        title: 'r6',
        name: 'Example',
        tag: 'EX',
        slug: 'example',
        colorsJson: colors,
        socialsJson: socials,
      })
      .run();
    const stored = db.select().from(team).get();
    expect(stored?.colorsJson).toEqual(colors);
    expect(stored?.socialsJson).toEqual(socials);
  });

  it.each([
    ['a value that is not a colour', { colorsJson: ['red'], socialsJson: [] }],
    [
      'an unknown key',
      { colorsJson: [], socialsJson: [{ label: 'X', url: 'https://x.com', x: 1 }] },
    ],
    [
      'a link that is not http(s)',
      { colorsJson: [], socialsJson: [{ label: 'X', url: 'javascript:alert(1)' }] },
    ],
  ])('refuse to write %s', (_label, json) => {
    const { db, lfr } = seededDatabase();
    const row = {
      orgId: lfr.id,
      title: 'r6' as const,
      name: 'Example',
      tag: 'EX',
      slug: 'example',
    };
    expect(() =>
      db
        .insert(team)
        .values({ ...row, ...json })
        .run(),
    ).toThrow();
    expect(db.select().from(team).all()).toEqual([]);
  });

  it.each([
    ['text that is not JSON', 'not json'],
    ['JSON of the wrong shape', '{"primary":"#112233"}'],
  ])('refuse to read %s written behind their back', (_label, raw) => {
    const { db, lfr } = seededDatabase();
    db.$client
      .prepare(
        `insert into team (org_id, title, name, tag, slug, colors_json, socials_json)
         values (?, 'r6', 'Example', 'EX', 'example', ?, '[]')`,
      )
      .run(lfr.id, raw);
    expect(() => db.select().from(team).all()).toThrow();
  });

  it('keep NULL as NULL when the column is optional', () => {
    const { db, lfr } = seededDatabase();
    db.insert(auditLog)
      .values({
        actorKind: 'system',
        action: 'org.create',
        entity: 'org',
        entityId: String(lfr.id),
        afterJson: { name: 'LFR' },
        at: 1,
      })
      .run();
    const row = db.select().from(auditLog).get();
    expect(row?.beforeJson).toBeNull();
    expect(row?.afterJson).toEqual({ name: 'LFR' });
  });
});

describe('database constraints', () => {
  it('refuse a second account with the same title and external id', () => {
    const { db, alice } = seededDatabase();
    const account = {
      playerId: alice.id,
      title: 'r6' as const,
      externalId: 'uuid-1',
      displayName: 'A',
    };
    db.insert(gameAccount).values(account).run();
    expect(() => db.insert(gameAccount).values(account).run()).toThrow(/UNIQUE/);
    // The same external id under another title is a different account.
    db.insert(gameAccount)
      .values({ ...account, title: 'valorant' })
      .run();
    expect(
      db.select().from(gameAccount).where(eq(gameAccount.playerId, alice.id)).all(),
    ).toHaveLength(2);
  });

  it('refuse a row pointing at a missing parent', () => {
    const { db } = seededDatabase();
    const orphan = { orgId: 999, slug: 'bob', displayName: 'Bob', createdAt: 1 };
    expect(() => db.insert(player).values(orphan).run()).toThrow(/FOREIGN KEY/);
  });

  it('refuse deleting a parent that still has children', () => {
    const { db, lfr } = seededDatabase();
    expect(() => db.delete(org).where(eq(org.id, lfr.id)).run()).toThrow(/FOREIGN KEY/);
  });

  it.each([
    [
      'an unknown title',
      `insert into game_account (player_id, title, external_id, display_name) values (1, 'chess', 'x', 'x')`,
    ],
    [
      'an unknown locale',
      `insert into org (name, slug, locale, settings_json) values ('X', 'x', 'de', '{}')`,
    ],
    [
      'an unknown match status',
      `insert into match (stage_id, best_of, status, window_start, window_end) values (1, 1, 'played', 0, 1)`,
    ],
    [
      'a season date that is not YYYY-MM-DD',
      `insert into season (competition_id, name, starts_on, ends_on, settings_json, status)
       values (1, 'S', '19/10/2026', '2026-12-20', '{}', 'active')`,
    ],
    [
      'a stage entry with neither slot nor player',
      `insert into stage_entry (stage_id, seed) values (1, 1)`,
    ],
    [
      'a stage entry with both slot and player',
      `insert into stage_entry (stage_id, slot_id, player_id, seed) values (1, 1, 1, 1)`,
    ],
    [
      'evidence with neither a stored object nor a link',
      `insert into evidence (match_id, kind, uploaded_by, at) values (1, 'score_screenshot', 1, 1)`,
    ],
  ])('refuse %s', (_label, statement) => {
    const { db } = seededDatabase();
    // Foreign keys are switched off so that only the CHECK under test can refuse the row.
    db.$client.pragma('foreign_keys = OFF');
    expect(() => db.$client.exec(statement)).toThrow(/CHECK/);
  });
});
