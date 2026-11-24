import { schema, type Db } from '@ligo/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { validateCompleted } from '../services/complete-validation.ts';
import { leagueDatabase, playedMatch, requireMoss, setResultValidation } from '../testing.ts';
import { tick } from './clock.ts';
import { fakeGateway } from './testing.ts';

// A confirmed result that waited for MOSS files (M-47, maintainer 24 November 2026): the clock
// validates it once the last file is there, and announces it as a confirmation would.

const RESULTS = '800000000000000002';

/** Match 3 confirmed by both teams, with its replays, waiting for MOSS files. */
function confirmed(mode: 'opponent' | 'staff' = 'opponent') {
  const db = leagueDatabase();
  requireMoss(db);
  setResultValidation(db, mode);
  db.update(schema.leagueGuild).set({ resultsChannelId: RESULTS }).run();
  const players = playedMatch(db, 3, false);
  db.update(schema.match).set({ status: 'confirmed' }).where(eq(schema.match.id, 3)).run();
  db.update(schema.game).set({ scoreA: 7, scoreB: 5 }).where(eq(schema.game.matchId, 3)).run();
  const sendAll = () => {
    for (const playerId of [...players.a, ...players.b]) {
      db.insert(schema.evidence)
        .values({
          matchId: 3,
          kind: 'moss',
          objectKey: `evidence/3/moss/${String(playerId)}.zip`,
          uploadedBy: playerId,
          playerId,
          at: 0,
        })
        .run();
    }
  };
  return { db, sendAll };
}

const statusOf = (db: Db) =>
  db.select().from(schema.match).where(eq(schema.match.id, 3)).get()?.status;

describe('validateCompleted', () => {
  it('waits while a file is missing, then validates as Ligo, in the audit log', () => {
    const { db, sendAll } = confirmed();
    expect(validateCompleted(db, 100)).toEqual([]);
    expect(statusOf(db)).toBe('confirmed');
    sendAll();
    expect(validateCompleted(db, 200)).toEqual([
      expect.objectContaining({ resultsChannelId: RESULTS }),
    ]);
    expect(db.select().from(schema.match).where(eq(schema.match.id, 3)).get()).toMatchObject({
      status: 'validated',
      validatedAt: 200,
    });
    const audit = db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'match.validate'))
      .get();
    expect(audit).toMatchObject({ actorKind: 'system', afterJson: { when: 'moss_complete' } });
    expect(validateCompleted(db, 300)).toEqual([]);
  });

  it('leaves a confirmed result to staff where staff validate every result', () => {
    const { db, sendAll } = confirmed('staff');
    sendAll();
    expect(validateCompleted(db, 200)).toEqual([]);
    expect(statusOf(db)).toBe('confirmed');
  });
});

describe('the clock', () => {
  it('announces a result it validated in the results channel', async () => {
    const { db, sendAll } = confirmed();
    sendAll();
    const gateway = fakeGateway();
    await tick({
      db,
      gateway,
      logger: { error: vi.fn() },
      locale: 'fr',
      publicUrl: new URL('https://ligoleague.eu'),
      now: () => 500,
    });
    expect(statusOf(db)).toBe('validated');
    expect(gateway.posted.some((post) => post.channelId === RESULTS)).toBe(true);
  });
});
