import { discordSettingsSchema, matchChannelKey, type GuildSnapshot } from '@ligo/core';
import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { FAKE_BOT_ID, fakeGateway } from '../discord/testing.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { desiredMatchChannels } from './match-channels.ts';
import type { Actor } from './permissions.ts';
import { syncLeague } from './reconciler.ts';
import { voidMatch } from './reports.ts';
import { openLeagueWeek } from './week-open.ts';

// Match channels from the database (phase 4; design doc section 6): in leagueDatabase(), match 3
// (Bravo v Charlie, Ligue 1 week 3, from Monday 2 November 2026) is still to play; matches 1, 2
// and 4 counted long ago and get no channel.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Monday 2 November 2026, 00:00 in Paris. */
const WEEK_3 = Date.UTC(2026, 10, 1, 23);
const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const settings = discordSettingsSchema.parse({ manage: true });

function setUp() {
  const db = leagueDatabase();
  const plan = (now: number, teamRoleKeys = ['team:2', 'team:3']) =>
    desiredMatchChannels(db, {
      competitionId: 1,
      guildId: TEST_GUILD,
      staffRoleId: TEST_STAFF_ROLE,
      settings,
      teamRoleKeys: new Set(teamRoleKeys),
      botUserId: FAKE_BOT_ID,
      now,
    });
  return { db, plan };
}

describe('desiredMatchChannels', () => {
  it('opens match 3’s channel two days before its week, in its week’s category', () => {
    const { plan } = setUp();
    expect(plan(WEEK_3 - 2 * DAY - 1)).toEqual({ categories: [], channels: [] });
    const open = plan(WEEK_3 - 2 * DAY);
    expect(open.categories.map((category) => category.name)).toEqual(['L1 · Semaine 3']);
    expect(open.channels).toMatchObject([
      { key: matchChannelKey(3), name: 'w3-brv-cha', parent: { kind: 'week_category' } },
    ]);
    expect(open.channels[0]?.overwrites.map((overwrite) => overwrite.target)).toEqual([
      { role: { id: TEST_GUILD } },
      { role: { key: 'team:2' } },
      { role: { key: 'team:3' } },
      { role: { id: TEST_STAFF_ROLE } },
      { member: FAKE_BOT_ID },
    ]);
  });

  it('gives no overwrite to a team without a role, and lets the division’s staff in', () => {
    const { db, plan } = setUp();
    db.update(schema.division)
      .set({ staffRoleId: '800000000000000020' })
      .where(eq(schema.division.name, 'Ligue 1'))
      .run();
    const targets = plan(WEEK_3, ['team:2']).channels[0]?.overwrites.map(
      (overwrite) => overwrite.target,
    );
    expect(targets).toContainEqual({ role: { id: '800000000000000020' } });
    expect(targets).not.toContainEqual({ role: { key: 'team:3' } });
  });

  it('opens a week staff opened early, at once', () => {
    const { db, plan } = setUp();
    const early = WEEK_3 - 20 * DAY;
    expect(plan(early).channels).toEqual([]);
    expect(openLeagueWeek(db, STAFF, 3, early)).toMatchObject({ ok: true, alreadyOpen: false });
    expect(plan(early).channels).toHaveLength(1);
  });

  it('archives the channel 48 hours after the match is annulled', () => {
    const { db, plan } = setUp();
    db.insert(schema.discordObject)
      .values({
        guildId: TEST_GUILD,
        kind: 'match_channel',
        key: matchChannelKey(3),
        discordId: '800000000000000700',
        createdByLigo: true,
        createdAt: 1,
      })
      .run();
    const annulled = WEEK_3 + 3 * DAY;
    expect(voidMatch(db, STAFF, { matchId: 3, reason: 'Erreur' }, annulled)).toMatchObject({
      ok: true,
    });
    expect(plan(annulled + 47 * HOUR).channels[0]?.parent.kind).toBe('week_category');
    expect(plan(annulled + 48 * HOUR).channels[0]?.parent.kind).toBe('archive_category');
  });
});

describe('syncLeague with match channels', () => {
  it('creates the category and the channel, letting the bot in', async () => {
    const { db } = setUp();
    const row = db.select().from(schema.competition).get();
    if (!row) throw new Error('set up');
    db.update(schema.competition)
      .set({ rulesetJson: { ...row.rulesetJson, discord: settings } })
      .run();
    const gateway = fakeGateway();
    const server: GuildSnapshot = {
      everyoneId: TEST_GUILD,
      roles: [{ id: TEST_GUILD, name: '@everyone', color: null, mentionable: false }],
      categories: [],
      channels: [],
      members: [],
    };
    gateway.snapshots.set(TEST_GUILD, server);
    const reply = await syncLeague(db, gateway, 1, {
      dryRun: false,
      now: WEEK_3,
      actorPlayerId: null,
    });
    expect(reply).toMatchObject({ ok: true, failures: [] });
    expect(server.categories.map((category) => category.name)).toEqual(['L1 · Semaine 3']);
    expect(server.channels.map((channel) => channel.name)).toEqual(['w3-brv-cha']);
    expect(server.channels[0]?.overwrites.map((overwrite) => overwrite.id)).toContain(FAKE_BOT_ID);
  });
});
