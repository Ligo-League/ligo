import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../services/permissions.ts';
import { ensurePlayer } from '../services/players.ts';
import { setTeamOwner } from '../services/team-staff.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, TEST_NOW, testSite } from './testing.ts';

// Match times on the match page (phase 3e): each side proposes and answers, as with
// `/match propose-time` and its buttons; a proposal made here is posted in the league's schedule
// channel (M-32). Match 3 is Bravo (side A, Ana's) v Charlie (side B, Ben's), Ligue 1 week 3:
// Monday 2 to Sunday 8 November 2026, extension until Sunday 15 November.

const SCHEDULE = '800000000000000004';
const LEA = { id: '222222222222222222', displayName: 'Léa Staff' };
const BEN = { id: '700000000000000002', displayName: 'Ben' };
const CAPTAIN = { id: '700000000000000003', displayName: 'Cap' };
const STRANGER = { id: '700000000000000004', displayName: 'Stranger' };
const STAFF: Actor = { guildId: TEST_GUILD, user: LEA, memberRoleIds: [TEST_STAFF_ROLE] };
const NOW = Date.parse('2026-11-03T12:00:00Z');
const THURSDAY_21H = Date.parse('2026-11-05T20:00:00Z');

function site({ scheduleChannel = true } = {}) {
  const db = leagueDatabase();
  setTeamOwner(db, STAFF, { teamId: 2, member: ANA }, 100);
  setTeamOwner(db, STAFF, { teamId: 3, member: BEN }, 100);
  if (scheduleChannel) db.update(schema.leagueGuild).set({ scheduleChannelId: SCHEDULE }).run();
  const browser = testSite({
    db,
    users: { 'code-ben': BEN, 'code-cap': CAPTAIN, 'code-stranger': STRANGER },
  });
  browser.advance(NOW - TEST_NOW);
  const stored = () => db.select().from(schema.match).where(eq(schema.match.id, 3)).get();
  const proposals = () => db.select().from(schema.matchProposal).all();
  const propose = (date = '2026-11-05', time = '21:00') =>
    browser.post('/matches/3/time/propose', { date, time });
  return { ...browser, stored, proposals, propose };
}
const where = (response: Response) => response.headers.get('location');

describe('match times on the match page', () => {
  it('shows the time panel to the two sides only', async () => {
    const { request, logIn, jar } = site();
    expect(await (await request('/matches/3')).text()).not.toContain('Horaire du match');
    await logIn('/matches/3', 'code-stranger');
    expect(await (await request('/matches/3')).text()).not.toContain('Horaire du match');
    jar.clear();
    await logIn('/matches/3');
    const response = await request('/matches/3');
    const page = await response.text();
    expect(page).toContain('Horaire du match');
    expect(page).toContain('<option value="2026-11-05">jeudi 5 novembre</option>');
    expect(page).toContain('<option value="2026-11-15">dimanche 15 novembre</option>');
    expect(page).not.toContain('value="2026-11-16"');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('posts a proposal in the schedule channel, which the other side accepts on the page', async () => {
    const { request, logIn, jar, gateway, stored, proposals, propose, post } = site();
    await logIn('/matches/3');
    expect(where(await propose())).toBe('/matches/3?time=proposed#time');
    expect(proposals()).toMatchObject([{ side: 'a', at: THURSDAY_21H, status: 'pending' }]);
    expect(gateway.posted).toMatchObject([
      {
        channelId: SCHEDULE,
        message: {
          buttons: [{ customId: 'time-accept:3:1' }, { customId: 'time-decline:3:1' }],
          mentionUserIds: [BEN.id],
        },
      },
    ]);
    // Ana waits; she cannot answer her own side's proposal.
    expect(await (await request('/matches/3')).text()).toContain('en attente de l’autre équipe');
    expect(where(await post('/matches/3/time/1/accept', {}))).toBe(
      '/matches/3?time_error=not_opponent#time',
    );

    jar.clear();
    await logIn('/matches/3', 'code-ben');
    const page = await (await request('/matches/3')).text();
    expect(page).toContain('action="/matches/3/time/1/accept"');
    expect(where(await post('/matches/3/time/1/accept', {}))).toBe('/matches/3?time=accepted#time');
    expect(stored()?.scheduledAt).toBe(THURSDAY_21H);
    // The proposal's post shows the answer without buttons, and the time is announced.
    expect(gateway.posted[0]?.message.content).toContain(`accepté par <@${BEN.id}>`);
    expect(gateway.posted[0]?.message.buttons).toBeUndefined();
    expect(gateway.posted[1]).toMatchObject({ channelId: SCHEDULE });
    expect(gateway.posted[1]?.message.content).toContain('Horaire fixé');
  });

  it('lets the other side decline', async () => {
    const { logIn, jar, stored, propose, post, proposals } = site();
    await logIn('/matches/3');
    await propose();
    jar.clear();
    await logIn('/matches/3', 'code-ben');
    expect(where(await post('/matches/3/time/1/decline', {}))).toBe(
      '/matches/3?time=declined#time',
    );
    expect(proposals()).toMatchObject([{ status: 'declined' }]);
    expect(stored()?.scheduledAt).toBeNull();
  });

  it.each([
    ['2026-11-05', '21h', 'invalid_time'],
    ['2026-11-20', '21:00', 'outside_period'],
    ['2026-11-02', '21:00', 'in_past'],
  ])('refuses %s %s: %s', async (date, time, error) => {
    const { logIn, propose, proposals } = site();
    await logIn('/matches/3');
    expect(where(await propose(date, time))).toBe(`/matches/3?time_error=${error}#time`);
    expect(proposals()).toEqual([]);
  });

  it('refuses someone who acts for neither side', async () => {
    const { logIn, propose, proposals } = site();
    await logIn('/matches/3', 'code-stranger');
    expect(where(await propose())).toBe('/matches/3?time_error=no_team#time');
    expect(proposals()).toEqual([]);
  });

  it('keeps the proposal on the page when the league has no schedule channel', async () => {
    const { logIn, propose, gateway, request } = site({ scheduleChannel: false });
    await logIn('/matches/3');
    expect(await (await request('/matches/3')).text()).toContain('pas de salon des horaires');
    expect(where(await propose())).toBe('/matches/3?time=proposed_unposted#time');
    expect(gateway.posted).toEqual([]);
  });

  it('lets the captain propose for their roster (M-19)', async () => {
    const { db, logIn, propose, proposals } = site();
    const id = ensurePlayer(db, { orgId: 1, discordUserId: CAPTAIN.id, displayName: 'Cap' }, 1).id;
    const seasonId = db.select().from(schema.season).get()?.id ?? 0;
    db.insert(schema.rosterEntry)
      .values({ seasonId, teamId: 3, playerId: id, role: 'player', captain: true, validFrom: 0 })
      .run();
    await logIn('/matches/3', 'code-cap');
    expect(where(await propose())).toBe('/matches/3?time=proposed#time');
    expect(proposals()).toMatchObject([{ side: 'b', proposedBy: id }]);
  });
});
