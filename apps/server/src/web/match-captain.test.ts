import { listLeagueMatches, schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../services/permissions.ts';
import { ensurePlayer } from '../services/players.ts';
import { setTeamOwner } from '../services/team-staff.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, testSite } from './testing.ts';

// The captain for one match on the match page (O-30b): the side's officials or its usual captain
// name a starter or substitute of the lineup, until the result is reported. Match 3 is Bravo
// (side A, Ana's) v Charlie (side B, Ben's).

const LEA = { id: '222222222222222222', displayName: 'Léa Staff' };
const BEN = { id: '700000000000000002', displayName: 'Ben' };
const CAP = { id: '700000000000000021', displayName: 'Cap' };
const SUB = { id: '700000000000000022', displayName: 'Sub' };
const STAFF: Actor = { guildId: TEST_GUILD, user: LEA, memberRoleIds: [TEST_STAFF_ROLE] };

function site() {
  const db = leagueDatabase();
  setTeamOwner(db, STAFF, { teamId: 2, member: ANA }, 100);
  setTeamOwner(db, STAFF, { teamId: 3, member: BEN }, 100);
  const [found] = listLeagueMatches(db, { matchId: 3 });
  if (!found) throw new Error('no match 3');
  const inLineup = (user: typeof CAP, role: 'player' | 'sub', captain: boolean) => {
    const id = ensurePlayer(
      db,
      { orgId: 1, discordUserId: user.id, displayName: user.displayName },
      100,
    ).id;
    db.insert(schema.rosterEntry)
      .values({ seasonId: found.seasonId, teamId: 2, playerId: id, role, captain, validFrom: 100 })
      .run();
    return id;
  };
  inLineup(CAP, 'player', true);
  const subId = inLineup(SUB, 'sub', false);
  const browser = testSite({ db, users: { 'code-ben': BEN, 'code-cap': CAP, 'code-sub': SUB } });
  const name = (player: string, side = 'a') => browser.post('/matches/3/captain', { side, player });
  const standIns = () => db.select().from(schema.matchCaptain).all();
  return { ...browser, subId, name, standIns };
}
const where = (response: Response) => response.headers.get('location');

describe('the captain for one match on the match page', () => {
  it('lets Bravo’s officials and its usual captain name one, among the lineup', async () => {
    const { request, logIn, jar, subId, name, standIns } = site();
    await logIn('/matches/3');
    const page = await (await request('/matches/3')).text();
    expect(page).toContain('Capitaine du match');
    expect(page).toContain('Capitaine habituel : Cap');
    expect(page).toMatch(new RegExp(`<option\\s+value="${String(subId)}"`));
    // The usual captain is not offered: they act anyway.
    expect(page).not.toMatch(/<option\s+value="\d+"[^>]*>\s*Cap\b/);
    expect(where(await name(String(subId)))).toBe('/matches/3?captain=named#captain');
    expect(standIns()).toMatchObject([{ matchId: 3, side: 'a', playerId: subId }]);
    expect(await (await request('/matches/3')).text()).toContain('Capitaine pour ce match : Sub');

    jar.clear();
    await logIn('/matches/3', 'code-cap');
    expect(where(await name(''))).toBe('/matches/3?captain=cleared#captain');
    expect(standIns()).toEqual([]);
  });

  it('lets the stand-in act in the match, but not name anyone', async () => {
    const { request, logIn, jar, subId, name } = site();
    await logIn('/matches/3');
    await name(String(subId));
    jar.clear();
    await logIn('/matches/3', 'code-sub');
    const page = await (await request('/matches/3')).text();
    // The stand-in reports and proposes times like a captain...
    expect(page).toContain('Résultat du match');
    expect(page).toContain('Horaire du match');
    // ...but names nobody.
    expect(page).not.toContain('action="/matches/3/captain"');
    expect(where(await name(''))).toBe('/matches/3?captain_error=not_allowed#captain');
  });

  it('is not for the other side, and closes once the result is reported', async () => {
    const { db, request, logIn, jar, subId, name } = site();
    await logIn('/matches/3', 'code-ben');
    expect(await (await request('/matches/3')).text()).not.toContain('Capitaine habituel : Cap');
    expect(where(await name(String(subId)))).toBe('/matches/3?captain_error=not_allowed#captain');
    jar.clear();
    await logIn('/matches/3');
    db.update(schema.match).set({ status: 'reported' }).run();
    expect(await (await request('/matches/3')).text()).not.toContain('Capitaine du match');
    expect(where(await name(String(subId)))).toBe('/matches/3?captain_error=match_closed#captain');
  });
});
