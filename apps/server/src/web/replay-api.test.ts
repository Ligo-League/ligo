import { listLeagueMatches, schema, type Db, type LeagueMatch } from '@ligo/db';
import { addRosterPlayers } from '@ligo/db/testing';
import { fakeObjectStore } from '@ligo/storage';
import { rawRound } from '@ligo/titles/testing';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { TEST_STAFF_ROLE } from '../testing.ts';
import { ANA, TEST_ORIGIN, testSite } from './testing.ts';

// The replay API (design doc section 8, upload flow 4 and 5) through HTTP: JSON from this site's
// pages, with the session's token, by a side's players or league staff.

const PARSER = 'r6-0123456789abcdef';
let hash = 0;

function scheduledMatch(db: Db): LeagueMatch {
  const row = db.select().from(schema.match).where(eq(schema.match.status, 'scheduled')).get();
  const [found] = row ? listLeagueMatches(db, { matchId: row.id }) : [];
  if (!found) throw new Error('no match to play');
  return found;
}

async function setup(options: { parserVersion?: string | null; onSide?: boolean } = {}) {
  const objects = fakeObjectStore();
  const site = testSite({
    replays: {
      objects,
      parserVersion: options.parserVersion === undefined ? PARSER : options.parserVersion,
      uploadOrigin: null,
    },
  });
  const { db } = site;
  const found = scheduledMatch(db);
  const a = addRosterPlayers(db, found.seasonId, found.a.teamId, 'b');
  const b = addRosterPlayers(db, found.seasonId, found.b.teamId, 'c');
  await site.logIn();
  const ana = db.select().from(schema.player).where(eq(schema.player.discordUserId, ANA.id)).get();
  if (!ana) throw new Error('Ana did not log in');
  if (options.onSide ?? true) {
    db.insert(schema.rosterEntry)
      .values({
        seasonId: found.seasonId,
        teamId: found.a.teamId,
        playerId: ana.id,
        role: 'sub',
        validFrom: 0,
      })
      .run();
  }
  const file = (number: number) => ({
    name: `Match-R${String(number + 1).padStart(2, '0')}.rec`,
    size: 100,
    sha256: (hash++).toString(16).padStart(64, '0'),
    round: rawRound({
      lobby: 'L1',
      number,
      winner: 0,
      attacker: 0,
      startedAt: 0,
      accounts: [a, b],
    }),
  });
  const submit = (files = [file(0)], parser = PARSER) =>
    site.postJson('/api/replays', { matchId: found.id, parser, files });
  return { ...site, objects, found, file, submit };
}

describe('POST /api/replays, /sign and /stored', () => {
  it('stores the rounds, signs their uploads, then queues each raw file’s verification', async () => {
    const { db, objects, found, submit, postJson } = await setup();
    const sent = await submit();
    expect(sent.status).toBe(200);
    expect(sent.headers.get('cache-control')).toBe('no-store');
    const { files } = (await sent.json()) as { files: { status: string; id: number }[] };
    expect(files).toEqual([expect.objectContaining({ status: 'stored' })]);
    const id = files[0]?.id ?? 0;

    const signed = await postJson('/api/replays/sign', { matchId: found.id, ids: [id] });
    expect(signed.status).toBe(200);
    expect(await signed.json()).toEqual({
      files: [
        expect.objectContaining({
          id,
          method: 'PUT',
          url: expect.stringContaining('replays/') as unknown,
        }),
      ],
    });

    const key = objects.signed[0]?.key ?? '';
    await objects.put(key, new Uint8Array(100), 'application/octet-stream');
    const stored = await postJson('/api/replays/stored', { matchId: found.id, ids: [id] });
    expect(await stored.json()).toEqual({ files: [{ id, status: 'stored' }] });
    expect(db.select({ kind: schema.job.kind }).from(schema.job).all()).toEqual([
      { kind: 'stitch_game' },
      { kind: 'verify_replay' },
    ]);
  });

  it('tells a browser on another parser build which one to load', async () => {
    const { submit } = await setup();
    const sent = await submit(undefined, 'r6-ffffffffffffffff');
    expect(sent.status).toBe(409);
    expect(await sent.json()).toEqual({ ok: false, error: 'parser_version', current: PARSER });
  });

  it('refuses a request without the session’s token, from elsewhere, or not as JSON', async () => {
    const { found, postJson, request, file, jar } = await setup();
    const body = { matchId: found.id, parser: PARSER, files: [file(0)] };
    expect((await postJson('/api/replays', body, { 'X-CSRF-Token': 'forged' })).status).toBe(403);
    expect(
      (await postJson('/api/replays', body, { Origin: 'https://elsewhere.example' })).status,
    ).toBe(403);
    const asForm = await postJson('/api/replays', body, {
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(asForm.status).toBe(415);
    jar.clear();
    const anonymous = await request('/api/replays', {
      method: 'POST',
      headers: { Origin: TEST_ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: 'login' });
  });

  it('refuses someone of neither team, unless they are league staff', async () => {
    const { submit, setRoles } = await setup({ onSide: false });
    const refused = await submit();
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: 'forbidden' });
    setRoles([TEST_STAFF_ROLE]);
    expect((await submit()).status).toBe(200);
  });

  it('answers a body it cannot read, a match gone or annulled, and one too large', async () => {
    const { db, found, postJson, submit, file } = await setup();
    expect((await postJson('/api/replays', { matchId: found.id })).status).toBe(400);
    expect((await postJson('/api/replays/sign', { matchId: 999_999, ids: [1] })).status).toBe(404);
    const big = { ...file(0), round: { padding: 'x'.repeat(3 * 1024 * 1024) } };
    const tooLarge = await postJson('/api/replays', {
      matchId: found.id,
      parser: PARSER,
      files: [big],
    });
    expect(tooLarge.status).toBe(413);
    db.update(schema.match).set({ status: 'void' }).where(eq(schema.match.id, found.id)).run();
    const closed = await submit();
    expect(closed.status).toBe(409);
    expect(await closed.json()).toEqual({ error: 'closed' });
  });

  it('stops uploads while the server has no parser build', async () => {
    const { submit } = await setup({ parserVersion: null });
    const sent = await submit();
    expect(sent.status).toBe(503);
    expect(await sent.json()).toEqual({ error: 'unavailable' });
  });

  it('limits the uploads signed per user, and says when to come back', async () => {
    const { found, postJson } = await setup();
    const ids = (from: number) => Array.from({ length: 64 }, (_, i) => from + i);
    for (const from of [1, 65, 129]) {
      const reply = await postJson('/api/replays/sign', { matchId: found.id, ids: ids(from) });
      expect(reply.status).toBe(200);
    }
    const refused = await postJson('/api/replays/sign', { matchId: found.id, ids: ids(193) });
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('logs the match only when signing fails, never a link', async () => {
    const { found, objects, postJson, submit, logger } = await setup();
    const { files } = (await (await submit()).json()) as { files: { id: number }[] };
    objects.failing = true;
    const reply = await postJson('/api/replays/sign', { matchId: found.id, ids: [files[0]?.id] });
    expect(reply.status).toBe(503);
    expect(logger.error).toHaveBeenCalledWith(
      { matchId: found.id },
      'Replay uploads could not be signed',
    );
  });
});
