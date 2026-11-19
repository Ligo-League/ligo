import { listLeagueMatches, schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { matchCaptains, nameMatchCaptain } from './match-captain.ts';
import { actsFor, matchRolesOf, type Actor } from './permissions.ts';
import { ensurePlayer } from './players.ts';
import { proposeTime } from './scheduling.ts';
import { setTeamOwner, teamMentions } from './team-staff.ts';

// The captain for one match (O-30, O-30b, maintainer, 14 and 15 November 2026): when a side's
// captain cannot play, its officials or its usual captain name a starter or substitute of the
// season's lineup for that match, until the result is reported. The stand-in acts in that match
// only, like a captain; the usual captain keeps acting.

const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const member = (n: number): Actor => ({
  guildId: TEST_GUILD,
  user: { id: `70000000000000001${String(n)}`, displayName: `Member ${String(n)}` },
  memberRoleIds: [],
});
// Match 3 is Bravo (team 2, side A) v Charlie (team 3, side B); match 1 is Alpha v Bravo.
const BRAVO_MANAGER = member(1);
const CAPTAIN = member(2);
const SUB = member(3);
const STARTER = member(4);
const OUTSIDER = member(5);
const NOW = Date.parse('2026-11-03T12:00:00Z');

function league() {
  const db = leagueDatabase();
  setTeamOwner(db, STAFF, { teamId: 2, member: BRAVO_MANAGER.user }, 100);
  const [found] = listLeagueMatches(db, { matchId: 3 });
  if (!found) throw new Error('no match 3');
  const inLineup = (actor: Actor, role: 'player' | 'sub', captain = false) => {
    const id = ensurePlayer(
      db,
      { orgId: 1, discordUserId: actor.user.id, displayName: actor.user.displayName },
      100,
    ).id;
    db.insert(schema.rosterEntry)
      .values({ seasonId: found.seasonId, teamId: 2, playerId: id, role, captain, validFrom: 100 })
      .run();
    return id;
  };
  const captainId = inLineup(CAPTAIN, 'player', true);
  const subId = inLineup(SUB, 'sub');
  const starterId = inLineup(STARTER, 'player');
  const outsiderId = ensurePlayer(
    db,
    { orgId: 1, discordUserId: OUTSIDER.user.id, displayName: OUTSIDER.user.displayName },
    100,
  ).id;
  const name = (actor: Actor, playerId: number | null, matchId = 3, side: 'a' | 'b' = 'a') =>
    nameMatchCaptain(db, actor, { matchId, side, playerId }, NOW);
  return { db, found, captainId, subId, starterId, outsiderId, name };
}

describe('nameMatchCaptain', () => {
  it('lets the officials name a substitute captain for one match, audited', () => {
    const { db, subId, name } = league();
    expect(name(BRAVO_MANAGER, subId)).toMatchObject({ ok: true, standIn: { playerId: subId } });
    expect(db.select().from(schema.matchCaptain).all()).toMatchObject([
      { matchId: 3, side: 'a', playerId: subId, namedAt: NOW },
    ]);
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      action: 'match.captain',
      entityId: '3',
      afterJson: { side: 'a', playerId: subId },
    });
  });

  it('lets the usual captain name one too, replacing the one before, or nobody', () => {
    const { db, subId, starterId, name } = league();
    name(BRAVO_MANAGER, subId);
    expect(name(CAPTAIN, starterId)).toMatchObject({ ok: true });
    expect(db.select().from(schema.matchCaptain).all()).toMatchObject([{ playerId: starterId }]);
    expect(name(CAPTAIN, null)).toMatchObject({ ok: true, side: 'a', standIn: null });
    expect(db.select().from(schema.matchCaptain).all()).toEqual([]);
  });

  it('refuses a stand-in, the other side, a player outside the lineup and the usual captain', () => {
    const { subId, starterId, outsiderId, captainId, name } = league();
    name(BRAVO_MANAGER, subId);
    expect(name(SUB, starterId)).toEqual({ ok: false, error: 'not_allowed' });
    expect(name(BRAVO_MANAGER, subId, 3, 'b')).toEqual({ ok: false, error: 'not_allowed' });
    expect(name(OUTSIDER, subId)).toEqual({ ok: false, error: 'not_allowed' });
    expect(name(BRAVO_MANAGER, outsiderId)).toEqual({ ok: false, error: 'not_in_lineup' });
    expect(name(BRAVO_MANAGER, captainId)).toEqual({ ok: false, error: 'usual_captain' });
    expect(name(BRAVO_MANAGER, subId, 999)).toEqual({ ok: false, error: 'match_not_found' });
  });

  it('refuses a player still blocked after their mercato move (O-35)', () => {
    const { db, subId, name } = league();
    db.update(schema.rosterEntry)
      .set({ validFrom: NOW + 1 })
      .where(eq(schema.rosterEntry.playerId, subId))
      .run();
    expect(name(BRAVO_MANAGER, subId)).toEqual({ ok: false, error: 'not_in_lineup' });
  });

  it('closes once the result is reported', () => {
    const { db, subId, name } = league();
    db.update(schema.match).set({ status: 'reported' }).run();
    expect(name(BRAVO_MANAGER, subId)).toEqual({ ok: false, error: 'match_closed' });
  });
});

describe('the captain for one match, in that match', () => {
  it('acts for the side in that match only, and is mentioned there', () => {
    const { db, found, subId, name } = league();
    name(BRAVO_MANAGER, subId);
    const held = matchRolesOf(db, subId, found.seasonId);
    expect(actsFor(held, found, 'a')).toBe(true);
    const [other] = listLeagueMatches(db, { matchId: 1 });
    if (!other) throw new Error('no match 1');
    expect(actsFor(held, other, 'b')).toBe(false);
    expect(teamMentions(db, 2, found.seasonId, 3)).toContain(SUB.user.id);
    expect(teamMentions(db, 2, found.seasonId, 1)).not.toContain(SUB.user.id);
    expect(teamMentions(db, 2, found.seasonId)).not.toContain(SUB.user.id);
  });

  it('may propose a time for that match through the same services', () => {
    const { subId, name, db } = league();
    name(BRAVO_MANAGER, subId);
    const reply = proposeTime(db, SUB, { matchId: 3, at: Date.parse('2026-11-05T20:00:00Z') }, NOW);
    expect(reply).toMatchObject({ ok: true, side: 'a' });
  });

  it('is listed with the usual captain of each side', () => {
    const { db, found, subId, captainId, name } = league();
    name(BRAVO_MANAGER, subId);
    expect(matchCaptains(db, found)).toEqual({
      a: {
        usual: { playerId: captainId, name: 'Member 2' },
        standIn: { playerId: subId, name: 'Member 3' },
      },
      b: { usual: null, standIn: null },
    });
  });
});
