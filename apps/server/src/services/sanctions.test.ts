import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import { recordForfeit } from './forfeits.ts';
import type { Actor } from './permissions.ts';
import { addSanction, listSanctions } from './sanctions.ts';
import { getStandings } from './standings.ts';

const STAFF: Actor = {
  guildId: TEST_GUILD,
  user: { id: '222222222222222222', displayName: 'Léa Staff' },
  memberRoleIds: [TEST_STAFF_ROLE],
};
const MEMBER: Actor = { ...STAFF, memberRoleIds: [] };
// In leagueDatabase(): team 1 is Alpha Esport (ALP, slot 1), with 6 points; team 2 is Bravo.
const ALPHA = 1;
const points = (db: ReturnType<typeof leagueDatabase>) => {
  const standings = getStandings(db, { guildId: TEST_GUILD, division: 'L1' });
  if (!standings.ok) throw new Error(standings.error);
  return Object.fromEntries(
    (standings.tables[0]?.rows ?? []).map((row) => [row.team.tag, row.points]),
  );
};
const add = (
  db: ReturnType<typeof leagueDatabase>,
  request: Partial<Parameters<typeof addSanction>[2]>,
  actor: Actor = STAFF,
  now = 9000,
) =>
  addSanction(
    db,
    actor,
    { teamId: ALPHA, kind: 'points', points: -2, reason: 'Retard', ...request },
    now,
  );

describe('addSanction', () => {
  it('takes points away at once, and gives them back with the opposite sanction', () => {
    const db = leagueDatabase();
    expect(points(db)).toEqual({ ALP: 6, CHA: 0, BRV: 0 });

    expect(add(db, { points: -2, reason: '  Retard répété  ' })).toMatchObject({
      ok: true,
      team: { teamId: ALPHA, tag: 'ALP' },
      sanction: { kind: 'points', pointsDelta: -2, reason: 'Retard répété', at: 9000 },
    });
    expect(points(db)).toEqual({ ALP: 4, CHA: 0, BRV: 0 });

    add(db, { points: 2, reason: 'Erreur du staff' });
    expect(points(db)).toEqual({ ALP: 6, CHA: 0, BRV: 0 });
  });

  it('records a warning, which moves no points', () => {
    const db = leagueDatabase();
    expect(add(db, { kind: 'warning', points: null })).toMatchObject({
      ok: true,
      sanction: { kind: 'warning', pointsDelta: null },
    });
    expect(points(db)).toEqual({ ALP: 6, CHA: 0, BRV: 0 });
    expect(db.select().from(schema.sanction).all()).toMatchObject([
      { seasonId: 1, targetKind: 'slot', targetId: 1, kind: 'warning', matchId: null },
    ]);
  });

  it('audits the sanction with who decided it', () => {
    const db = leagueDatabase();
    add(db, {});
    const staffPlayer = db.select().from(schema.player).get();
    expect(db.select().from(schema.sanction).get()?.decidedBy).toBe(staffPlayer?.id);
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      actorPlayerId: staffPlayer?.id,
      actorKind: 'user',
      action: 'sanction.add',
      entity: 'sanction',
      entityId: '1',
      afterJson: { teamId: 1, slotId: 1, kind: 'points', pointsDelta: -2, reason: 'Retard' },
    });
  });

  it.each([
    ['a member who is not staff', MEMBER, {}, 'not_staff'],
    ['a server that is not linked', { ...STAFF, guildId: null }, {}, 'not_linked'],
    ['an unknown team', STAFF, { teamId: 99 }, 'team_not_found'],
    ['an empty reason', STAFF, { reason: '   ' }, 'reason_required'],
    ['points without a number', STAFF, { points: null }, 'points_required'],
    ['zero points', STAFF, { points: 0 }, 'points_required'],
    ['a fractional number of points', STAFF, { points: 1.5 }, 'points_required'],
    ['an absurd number of points', STAFF, { points: -1000 }, 'points_required'],
    ['a warning with points', STAFF, { kind: 'warning', points: -1 }, 'points_not_allowed'],
  ] as const)('refuses %s and changes nothing', (_name, actor, request, error) => {
    const db = leagueDatabase();
    const before = db.$client.serialize().toString('base64');
    expect(add(db, request, actor)).toEqual({ ok: false, error });
    expect(db.$client.serialize().toString('base64')).toBe(before);
  });

  it('refuses when no season has left registration', () => {
    const db = leagueDatabase();
    db.update(schema.season).set({ status: 'registration' }).run();
    expect(add(db, {})).toEqual({ ok: false, error: 'no_season' });
  });

  it('rolls back when the audit entry cannot be written', () => {
    const db = leagueDatabase();
    db.$client.exec(
      "CREATE TRIGGER audit_fails BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END",
    );
    expect(() => add(db, {})).toThrow(/audit down/);
    expect(db.select().from(schema.sanction).all()).toEqual([]);
  });
});

describe('listSanctions', () => {
  it("lists a team's sanctions of the season, oldest first, the automatic warning included", () => {
    const db = leagueDatabase();
    // Charlie (team 3) already has one forfeit: this second one adds the automatic warning.
    recordForfeit(db, STAFF, { matchId: 3, side: 'b', warningReason: () => 'auto' }, 8000);
    add(db, { teamId: 3, points: -1, reason: 'Retard' }, STAFF, 9000);
    add(db, { teamId: ALPHA, points: -3, reason: 'Autre équipe' }, STAFF, 9500);

    expect(listSanctions(db, STAFF, 3)).toMatchObject({
      ok: true,
      team: { tag: 'CHA' },
      sanctions: [
        { kind: 'warning', pointsDelta: null, reason: 'auto', at: 8000, matchId: 3 },
        { kind: 'points', pointsDelta: -1, reason: 'Retard', at: 9000, matchId: null },
      ],
    });
    expect(listSanctions(db, STAFF, 2)).toMatchObject({ ok: true, sanctions: [] });
  });

  it('is for league staff only', () => {
    const db = leagueDatabase();
    expect(listSanctions(db, MEMBER, ALPHA)).toEqual({ ok: false, error: 'not_staff' });
    expect(listSanctions(db, STAFF, 99)).toEqual({ ok: false, error: 'team_not_found' });
  });
});
