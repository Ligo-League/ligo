import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fakeGateway } from '../discord/testing.ts';
import { registrationDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { divisionAdmin, saveDivision } from './admin-divisions.ts';
import { ensurePlayer } from './players.ts';

// Divisions in the admin panel (phase 3h; design doc section 7): the organisation's owner and the
// competition's staff add a division to a season and change its name, kind, level, region,
// Discord category prefix and results channel, a text channel of the league's server where the
// bot posts a notice first. Season 4 (ID 2) holds Ligue 1 and Ligue 2.

const NOW = 1_800_000_000_000;
const OWNER_ID = '994597181476569170';
const SEASON_4 = 2;
const RESULTS_L1 = '800000000000000003';
const ELSEWHERE = '800000000000000009';
const STAFF_L1 = '800000000000000020';
const TEAM_ROLE = '800000000000000021';

function league() {
  const db = registrationDatabase();
  const gateway = fakeGateway();
  gateway.guilds.set(TEST_GUILD, {
    name: 'LFR Staging',
    roles: [
      { id: STAFF_L1, name: 'Staff L1' },
      { id: TEST_STAFF_ROLE, name: 'Staff' },
      { id: TEAM_ROLE, name: 'Alpha Esport' },
    ],
    managers: [],
    channels: [{ id: RESULTS_L1, name: 'résultats-l1', category: 'Ligue 1' }],
  });
  const owner = {
    discordUserId: OWNER_ID,
    playerId: ensurePlayer(db, { orgId: 1, discordUserId: OWNER_ID, displayName: 'Owner' }, 1).id,
  };
  const divisions = () =>
    db.select().from(schema.division).where(eq(schema.division.seasonId, SEASON_4)).all();
  const ligue1 = () => divisions().find((row) => row.name === 'Ligue 1');
  const key = (divisionId: number | null) => ({
    orgSlug: 'mlb-group',
    compSlug: 'lfr',
    seasonId: SEASON_4,
    divisionId,
    staffIds: [] as number[],
  });
  const notice = (name: string) => `Résultats de ${name}`;
  const save = (divisionId: number | null, form: Record<string, string>) =>
    saveDivision(db, gateway, owner, key(divisionId), form, notice, NOW);
  const formOf = (divisionId: number) => {
    const view = divisionAdmin(db, owner, key(divisionId));
    if (!view.ok) throw new Error(view.error);
    return view.values;
  };
  const lastAudit = () => db.select().from(schema.auditLog).all().at(-1);
  return { db, gateway, owner, divisions, ligue1, key, save, formOf, lastAudit };
}

const NEW = {
  name: 'Ligue 3',
  kind: 'league',
  level: '3',
  region: '',
  category_prefix: 'L3',
  results_channel_id: '',
};

describe('adding a division', () => {
  it('adds it to the season, audited, without a channel of its own', async () => {
    const { save, divisions, lastAudit } = league();
    expect(await save(null, NEW)).toMatchObject({ ok: true });
    expect(divisions().find((row) => row.name === 'Ligue 3')).toMatchObject({
      kind: 'league',
      level: 3,
      region: null,
      categoryPrefix: 'L3',
      resultsChannelId: null,
    });
    expect(lastAudit()).toMatchObject({ action: 'division.create', entity: 'division' });
  });

  it('takes a regional division with its region', async () => {
    const { save, divisions } = league();
    expect(
      await save(null, {
        ...NEW,
        name: 'Ligue Sud',
        kind: 'regional',
        region: 'Sud',
        category_prefix: 'SUD',
      }),
    ).toMatchObject({ ok: true });
    expect(divisions().find((row) => row.name === 'Ligue Sud')).toMatchObject({
      kind: 'regional',
      region: 'Sud',
    });
  });

  it('refuses a name or a prefix the season already has, and values out of range', async () => {
    const { save, divisions } = league();
    expect(await save(null, { ...NEW, name: 'ligue 1', category_prefix: 'l2' })).toEqual({
      ok: false,
      error: 'invalid',
      errors: { name: 'taken', category_prefix: 'taken' },
    });
    expect(await save(null, { ...NEW, kind: 'cup', level: '0', category_prefix: 'L 3' })).toEqual({
      ok: false,
      error: 'invalid',
      errors: { kind: 'invalid', level: 'invalid', category_prefix: 'invalid' },
    });
    expect(divisions()).toHaveLength(2);
  });

  it('is for the organisation’s owner and the competition’s staff', async () => {
    const { db, gateway, key } = league();
    const stranger = { discordUserId: '700000000000000031', playerId: 1 };
    expect(await saveDivision(db, gateway, stranger, key(null), NEW, String, NOW)).toEqual({
      ok: false,
      error: 'not_allowed',
    });
  });
});

describe('changing a division', () => {
  it('shows its values, and saves a change, audited before and after', async () => {
    const { ligue1, save, formOf, lastAudit } = league();
    const id = ligue1()?.id ?? 0;
    const values = formOf(id);
    expect(values).toEqual({
      name: 'Ligue 1',
      kind: 'league',
      level: '1',
      region: '',
      category_prefix: 'L1',
      results_channel_id: '',
      staff_role_id: '',
    });
    expect(await save(id, { ...values, name: 'Ligue 1 Elite' })).toEqual({ ok: true, id });
    expect(ligue1()).toBeUndefined();
    expect(lastAudit()).toMatchObject({
      action: 'division.settings',
      entityId: String(id),
      beforeJson: { name: 'Ligue 1' },
      afterJson: { name: 'Ligue 1 Elite' },
    });
  });

  it('takes a results channel of the league’s server, after posting a notice there', async () => {
    const { gateway, ligue1, save, formOf } = league();
    const id = ligue1()?.id ?? 0;
    const values = formOf(id);
    expect(await save(id, { ...values, results_channel_id: ELSEWHERE })).toEqual({
      ok: false,
      error: 'invalid',
      errors: { results_channel_id: 'not_in_server' },
    });
    gateway.failing = true;
    expect(await save(id, { ...values, results_channel_id: RESULTS_L1 })).toMatchObject({
      errors: { results_channel_id: 'cannot_post' },
    });
    gateway.failing = false;
    expect(await save(id, { ...values, results_channel_id: RESULTS_L1 })).toMatchObject({
      ok: true,
    });
    expect(ligue1()?.resultsChannelId).toBe(RESULTS_L1);
    expect(gateway.posted.at(-1)).toMatchObject({
      channelId: RESULTS_L1,
      message: { content: 'Résultats de Ligue 1' },
    });
    // Saving again without changing the channel posts nothing; emptying it falls back.
    const posts = gateway.posted.length;
    expect(await save(id, { ...formOf(id), level: '1' })).toMatchObject({ ok: true });
    expect(gateway.posted).toHaveLength(posts);
    expect(await save(id, { ...formOf(id), results_channel_id: '' })).toMatchObject({ ok: true });
    expect(ligue1()?.resultsChannelId).toBeNull();
  });

  it('takes a staff role of the league’s server, never @everyone, the league’s or a team’s', async () => {
    const { db, gateway, ligue1, save, formOf } = league();
    const id = ligue1()?.id ?? 0;
    db.insert(schema.discordObject)
      .values({
        guildId: TEST_GUILD,
        kind: 'team_role',
        key: 'team:1',
        discordId: TEAM_ROLE,
        createdByLigo: true,
        createdAt: 1,
      })
      .run();
    const role = (staff_role_id: string) => save(id, { ...formOf(id), staff_role_id });
    expect(await role(ELSEWHERE)).toMatchObject({
      errors: { staff_role_id: 'role_not_in_server' },
    });
    for (const reserved of [TEST_GUILD, TEST_STAFF_ROLE, TEAM_ROLE])
      expect(await role(reserved)).toMatchObject({ errors: { staff_role_id: 'role_reserved' } });
    gateway.failing = true;
    expect(await role(STAFF_L1)).toMatchObject({ errors: { staff_role_id: 'role_not_in_server' } });
    gateway.failing = false;
    expect(await role(STAFF_L1)).toMatchObject({ ok: true });
    expect(ligue1()?.staffRoleId).toBe(STAFF_L1);
    // Unchanged, it is not asked of Discord again; emptied, the division has none.
    gateway.failing = true;
    expect(await save(id, { ...formOf(id), level: '1' })).toMatchObject({ ok: true });
    expect(await role('')).toMatchObject({ ok: true });
    expect(ligue1()?.staffRoleId).toBeNull();
  });

  it('is not found in another season', async () => {
    const { db, owner, save } = league();
    const season3Division = db
      .select()
      .from(schema.division)
      .where(eq(schema.division.seasonId, 1))
      .get();
    expect(await save(season3Division?.id ?? 0, NEW)).toEqual({ ok: false, error: 'not_found' });
    expect(
      divisionAdmin(db, owner, {
        orgSlug: 'mlb-group',
        compSlug: 'lfr',
        seasonId: SEASON_4,
        divisionId: season3Division?.id ?? 0,
        staffIds: [],
      }),
    ).toEqual({ ok: false, error: 'not_found' });
  });
});
