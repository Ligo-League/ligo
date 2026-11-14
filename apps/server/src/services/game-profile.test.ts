import { schema } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { leagueDatabase } from '../testing.ts';
import { gameProfileOf, saveGameProfile } from './game-profile.ts';
import { ensurePlayer } from './players.ts';

// A player's R6 account, as they declare it on their own page (maintainer, 14 November 2026):
// their Ubisoft name, their profileID when they have it, and their rank, which they keep up to
// date themselves. Nothing is looked up elsewhere; a replay confirms the account later (M-23).

const ID = 'a1b2c3d4-0000-4000-8000-00000000000f';
const setup = () => {
  const db = leagueDatabase();
  const make = (n: number) =>
    ensurePlayer(
      db,
      { orgId: 1, discordUserId: `70000000000000000${String(n)}`, displayName: `P${String(n)}` },
      1,
    ).id;
  return { db, ana: make(1), ben: make(2) };
};

describe('saveGameProfile', () => {
  it('creates the account, tidied, then changes it, with the time the rank changed', () => {
    const { db, ana } = setup();
    expect(gameProfileOf(db, ana)).toBeNull();
    expect(
      saveGameProfile(
        db,
        ana,
        { ubisoftName: ' Nivalem ', profileId: ID.toUpperCase(), rank: 'gold' },
        100,
      ),
    ).toEqual({ ok: true });
    expect(gameProfileOf(db, ana)).toEqual({
      ubisoftName: 'Nivalem',
      profileId: ID,
      rank: 'gold',
      rankUpdatedAt: 100,
      verified: false,
    });

    // A new name, the same rank: the rank's time does not move.
    saveGameProfile(db, ana, { ubisoftName: 'Nivalem.RCK', profileId: ID, rank: 'gold' }, 200);
    expect(gameProfileOf(db, ana)).toMatchObject({
      ubisoftName: 'Nivalem.RCK',
      rankUpdatedAt: 100,
    });
    saveGameProfile(db, ana, { ubisoftName: 'Nivalem.RCK', profileId: null, rank: 'emerald' }, 300);
    expect(gameProfileOf(db, ana)).toMatchObject({
      profileId: null,
      rank: 'emerald',
      rankUpdatedAt: 300,
    });
    expect(db.select().from(schema.gameAccount).all()).toHaveLength(1);
    expect(db.select().from(schema.auditLog).all().at(-1)).toMatchObject({
      actorPlayerId: ana,
      action: 'player.game_profile',
      entity: 'player',
      entityId: String(ana),
      beforeJson: { ubisoftName: 'Nivalem.RCK', profileId: ID, rank: 'gold' },
      afterJson: { ubisoftName: 'Nivalem.RCK', profileId: null, rank: 'emerald' },
    });
  });

  it('refuses what the rules refuse, every field at once', () => {
    const { db, ana } = setup();
    expect(
      saveGameProfile(db, ana, { ubisoftName: 'a b', profileId: 'x', rank: 'wood' }, 1),
    ).toEqual({
      ok: false,
      errors: [
        { field: 'ubisoftName', error: 'invalid_name' },
        { field: 'profileId', error: 'invalid_profile_id' },
        { field: 'rank', error: 'invalid_rank' },
      ],
    });
    expect(gameProfileOf(db, ana)).toBeNull();
  });

  it('refuses a profileID another player declared', () => {
    const { db, ana, ben } = setup();
    saveGameProfile(db, ana, { ubisoftName: 'Nivalem', profileId: ID, rank: 'gold' }, 1);
    expect(
      saveGameProfile(db, ben, { ubisoftName: 'Ben', profileId: ID, rank: 'gold' }, 2),
    ).toEqual({
      ok: false,
      errors: [{ field: 'profileId', error: 'profile_id_taken' }],
    });
  });

  it('keeps a profileID a replay confirmed: only the name and the rank change', () => {
    const { db, ana } = setup();
    saveGameProfile(db, ana, { ubisoftName: 'Nivalem', profileId: ID, rank: 'gold' }, 1);
    db.update(schema.gameAccount)
      .set({ verified: true })
      .where(eq(schema.gameAccount.playerId, ana))
      .run();
    expect(
      saveGameProfile(db, ana, { ubisoftName: 'Nivalem', profileId: null, rank: 'gold' }, 2),
    ).toEqual({
      ok: false,
      errors: [{ field: 'profileId', error: 'profile_id_verified' }],
    });
    expect(
      saveGameProfile(db, ana, { ubisoftName: 'Niva', profileId: ID, rank: 'diamond' }, 3),
    ).toEqual({
      ok: true,
    });
    expect(gameProfileOf(db, ana)).toMatchObject({ ubisoftName: 'Niva', verified: true });
  });
});
