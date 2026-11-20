import { matchChannelKey } from '@ligo/core';
import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { fakeAssetStore } from '../assets/store.ts';
import { matchChannelOf, matchPostChannel } from '../services/match-channels.ts';
import type { Actor } from '../services/permissions.ts';
import { setMatchTime } from '../services/scheduling.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { announceWithCard } from './match-card.ts';
import { fakeGateway } from './testing.ts';

// A match's notifications in its own channel (design doc section 6; maintainer, 13 November
// 2026): once Ligo made match 3's channel, its time and result go there; until then, to the
// league's schedule channel.

const SCHEDULE = '800000000000000004';
const RESULTS = '800000000000000002';
const CHANNEL = '800000000000000700';
const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};

function setUp() {
  const db = leagueDatabase();
  db.update(schema.leagueGuild).set({ scheduleChannelId: SCHEDULE }).run();
  const guild = { guildId: TEST_GUILD, scheduleChannelId: SCHEDULE };
  const openChannel = () =>
    db
      .insert(schema.discordObject)
      .values({
        guildId: TEST_GUILD,
        kind: 'match_channel',
        key: matchChannelKey(3),
        discordId: CHANNEL,
        createdByLigo: true,
        createdAt: 1,
      })
      .run();
  return { db, guild, openChannel };
}

describe('where a match’s notifications go', () => {
  it('to the schedule channel until the match has its own, then there', () => {
    const { db, guild, openChannel } = setUp();
    expect(matchPostChannel(db, guild, 3)).toBe(SCHEDULE);
    expect(matchChannelOf(db, 3)).toBeNull();
    openChannel();
    expect(matchPostChannel(db, guild, 3)).toBe(CHANNEL);
    expect(matchChannelOf(db, 3)).toBe(CHANNEL);
    expect(matchPostChannel(db, guild, 4)).toBe(SCHEDULE);
  });

  it('a time set by staff is announced in the match’s channel', () => {
    const { db, openChannel } = setUp();
    openChannel();
    expect(setMatchTime(db, STAFF, { matchId: 3, at: Date.UTC(2026, 10, 4, 19) }, 1)).toMatchObject(
      { ok: true, scheduleChannelId: CHANNEL },
    );
  });

  it('a result goes to the results channel and to the match’s channel', async () => {
    const { db, openChannel } = setUp();
    const gateway = fakeGateway();
    const context = { db, gateway, assets: fakeAssetStore(), locale: 'fr' as const };
    await announceWithCard(context, RESULTS, { content: 'Résultat' }, 3, 'result');
    expect(gateway.posted.map((post) => post.channelId)).toEqual([RESULTS]);
    openChannel();
    await announceWithCard(context, RESULTS, { content: 'Résultat' }, 3, 'result');
    expect(gateway.posted.slice(1).map((post) => post.channelId)).toEqual([RESULTS, CHANNEL]);
  });
});
