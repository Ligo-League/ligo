import { describe, expect, it } from 'vitest';
import { fakeGateway } from '../discord/testing.ts';
import { requireStaff } from '../services/permissions.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { createRoleReader, ROLE_CACHE_MS, staffCompetitions, webActor } from './roles.ts';

const USER = { playerId: 1, name: 'Léa', discordUserId: '222222222222222222' };
const KEY = `${TEST_GUILD}:${USER.discordUserId}`;
const NOW = 1_800_000_000_000;

describe('createRoleReader', () => {
  it('asks Discord once a minute at most, so a removed role stops counting within it', async () => {
    const gateway = fakeGateway();
    gateway.members.set(KEY, [TEST_STAFF_ROLE]);
    const roles = createRoleReader(gateway);
    expect(await roles(TEST_GUILD, USER.discordUserId, NOW)).toEqual([TEST_STAFF_ROLE]);
    gateway.members.set(KEY, []);
    expect(await roles(TEST_GUILD, USER.discordUserId, NOW + ROLE_CACHE_MS - 1)).toEqual([
      TEST_STAFF_ROLE,
    ]);
    expect(gateway.roleReads).toBe(1);
    expect(await roles(TEST_GUILD, USER.discordUserId, NOW + ROLE_CACHE_MS)).toEqual([]);
    expect(gateway.roleReads).toBe(2);
  });

  it('gives no role to a non-member, or while Discord cannot be asked, and keeps no failure', async () => {
    const gateway = fakeGateway();
    const roles = createRoleReader(gateway);
    expect(await roles(TEST_GUILD, USER.discordUserId, NOW)).toEqual([]);
    gateway.failing = true;
    gateway.members.set(KEY, [TEST_STAFF_ROLE]);
    expect(await roles(TEST_GUILD, USER.discordUserId, NOW + ROLE_CACHE_MS)).toEqual([]);
    gateway.failing = false;
    expect(await roles(TEST_GUILD, USER.discordUserId, NOW + ROLE_CACHE_MS + 1)).toEqual([
      TEST_STAFF_ROLE,
    ]);
  });
});

describe('the website user as an actor', () => {
  it('names the competitions whose staff role the user holds', async () => {
    const db = leagueDatabase();
    const gateway = fakeGateway();
    const roles = createRoleReader(gateway);
    expect(await staffCompetitions(db, roles, USER, NOW)).toEqual([]);
    gateway.members.set(KEY, [TEST_STAFF_ROLE]);
    expect(await staffCompetitions(db, roles, USER, NOW + ROLE_CACHE_MS)).toEqual([
      { id: 1, name: 'LFR' },
    ]);
    expect(await staffCompetitions(db, roles, { ...USER, discordUserId: null }, NOW)).toEqual([]);
  });

  it('carries the Discord roles, so the bot’s permission checks apply unchanged', async () => {
    const db = leagueDatabase();
    const gateway = fakeGateway();
    gateway.members.set(KEY, [TEST_STAFF_ROLE]);
    const actor = await webActor(db, createRoleReader(gateway), USER, 1, NOW);
    expect(actor).toEqual({
      guildId: TEST_GUILD,
      user: { id: USER.discordUserId, displayName: 'Léa' },
      memberRoleIds: [TEST_STAFF_ROLE],
    });
    expect(actor && requireStaff(db, actor).ok).toBe(true);
    expect(await webActor(db, createRoleReader(gateway), USER, 99, NOW)).toBeNull();
  });
});
