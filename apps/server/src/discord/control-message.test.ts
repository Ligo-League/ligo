import { matchChannelKey } from '@ligo/core';
import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { controlMessageData } from '../services/control-messages.ts';
import { leagueDatabase, TEST_GUILD } from '../testing.ts';
import { controlMessage, postControlMessages } from './control-message.ts';
import { fakeGateway } from './testing.ts';

// A match channel's control message (design doc section 6): in leagueDatabase(), match 3 is
// Bravo v Charlie, Ligue 1 week 3. Charlie is ahead of Bravo, so Charlie would host and Bravo
// choose the sides.

const SITE = new URL('https://ligoleague.eu');
const CHANNEL = '800000000000000700';
const ROLE_BRAVO = '800000000000000702';

function setUp() {
  const db = leagueDatabase();
  const store = (kind: 'match_channel' | 'team_role', key: string, discordId: string) =>
    db
      .insert(schema.discordObject)
      .values({ guildId: TEST_GUILD, kind, key, discordId, createdByLigo: true, createdAt: 1 })
      .run();
  store('match_channel', matchChannelKey(3), CHANNEL);
  store('team_role', 'team:2', ROLE_BRAVO);
  const gateway = fakeGateway();
  const warnings: string[] = [];
  const deps = {
    db,
    gateway,
    locale: 'fr' as const,
    publicUrl: SITE,
    logger: { warn: (_details: object, message: string) => warnings.push(message) },
  };
  const stored = () => db.select().from(schema.match).where(eq(schema.match.id, 3)).get();
  return { db, gateway, deps, warnings, store, stored };
}

describe('controlMessage', () => {
  it('says the fixture, the week, who would host, what to do, with links to the match’s pages', () => {
    const { db } = setUp();
    const data = controlMessageData(db, TEST_GUILD, 3);
    if (!data) throw new Error('set up');
    const message = controlMessage('fr', data, SITE);
    expect(message.content).toContain(`<@&${ROLE_BRAVO}>`);
    expect(message.content).toContain('**Ligue 1, semaine 3 : Bravo – Charlie**');
    expect(message.content).toContain('Semaine de jeu : du <t:');
    expect(message.content).toContain('hôte Charlie, choix des côtés Bravo');
    expect(message.content).toContain('1. Convenir d’un horaire');
    expect(message.mentionRoleIds).toEqual([ROLE_BRAVO]);
    expect(message.links).toEqual([
      { label: 'Horaire', url: 'https://ligoleague.eu/matches/3#time' },
      { label: 'Veto', url: 'https://ligoleague.eu/matches/3/veto' },
      { label: 'Résultat', url: 'https://ligoleague.eu/matches/3#result' },
      { label: 'Statistiques', url: 'https://ligoleague.eu/matches/3/stats' },
    ]);
  });
});

describe('postControlMessages', () => {
  it('posts and pins it once, and again in a channel made anew', async () => {
    const { db, gateway, deps, stored } = setUp();
    expect(await postControlMessages(deps, TEST_GUILD)).toBe(1);
    const [post] = gateway.posted;
    expect(post?.channelId).toBe(CHANNEL);
    expect(gateway.pinned).toEqual([`${CHANNEL}:${post?.messageId ?? ''}`]);
    expect(stored()).toMatchObject({ channelId: CHANNEL, controlMessageId: post?.messageId });
    expect(await postControlMessages(deps, TEST_GUILD)).toBe(0);
    db.update(schema.discordObject)
      .set({ discordId: '800000000000000701' })
      .where(eq(schema.discordObject.kind, 'match_channel'))
      .run();
    expect(await postControlMessages(deps, TEST_GUILD)).toBe(1);
    expect(gateway.posted.at(-1)?.channelId).toBe('800000000000000701');
  });

  it('tries again later when Discord refuses, and keeps a message it could not pin', async () => {
    const { gateway, deps, warnings, stored } = setUp();
    gateway.failing = true;
    expect(await postControlMessages(deps, TEST_GUILD)).toBe(0);
    expect(stored()?.controlMessageId).toBeNull();
    expect(warnings).toEqual(['Could not post a match channel’s control message']);
    gateway.failing = false;
    gateway.pinMessage = () => Promise.reject(new Error('Missing Permissions'));
    expect(await postControlMessages(deps, TEST_GUILD)).toBe(1);
    expect(stored()?.controlMessageId).not.toBeNull();
    expect(warnings.at(-1)).toBe('Could not pin a match channel’s control message');
  });
});
