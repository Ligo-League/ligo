import { schema } from '@ligo/db';
import { describe, expect, it } from 'vitest';
import { fakeEvidenceStore } from '../assets/evidence-store.ts';
import { PNG_HEADER_FOR_TESTS } from '../assets/store.ts';
import { fakeGateway } from '../discord/testing.ts';
import { leagueDatabase, TEST_GUILD, TEST_STAFF_ROLE } from '../testing.ts';
import {
  evidenceCompetition,
  evidenceKeyOf,
  fetchAndKeepEvidence,
  imageTypeOf,
  keepEvidence,
  openEvidence,
} from './evidence.ts';
import { ensurePlayer } from './players.ts';

const STAFF = { guildId: TEST_GUILD, memberRoleIds: [TEST_STAFF_ROLE] };
const PNG = new Uint8Array([...PNG_HEADER_FOR_TESTS, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBPVP8 ')]);
const ascii = (text: string) => new Uint8Array(Buffer.from(text));

/** Match 3 of leagueDatabase() with a screenshot row that has only Discord's address. */
function withEvidence() {
  const db = leagueDatabase();
  const player = ensurePlayer(
    db,
    { orgId: 1, discordUserId: '700000000000000001', displayName: 'Ana' },
    100,
  );
  const evidenceId = db
    .insert(schema.evidence)
    .values({
      matchId: 3,
      kind: 'score_screenshot',
      url: 'https://discord.com/channels/1/2/3',
      uploadedBy: player.id,
      visibility: 'teams',
      at: 9000,
    })
    .returning({ id: schema.evidence.id })
    .get().id;
  const store = fakeEvidenceStore();
  const objectKey = () => db.select().from(schema.evidence).get()?.objectKey;
  return { db, store, evidenceId, objectKey };
}

describe('imageTypeOf', () => {
  it('reads the type from the file’s own bytes', () => {
    expect(imageTypeOf(PNG)).toBe('image/png');
    expect(imageTypeOf(JPEG)).toBe('image/jpeg');
    expect(imageTypeOf(WEBP)).toBe('image/webp');
  });

  it.each([
    ['a GIF', ascii('GIF89a......')],
    ['an SVG', ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['an HTML page', ascii('<!doctype html><script>alert(1)</script>')],
    ['a RIFF file that is not WebP', ascii('RIFF....WAVEfmt ')],
    ['nothing', new Uint8Array()],
  ])('refuses %s', (_name, data) => {
    expect(imageTypeOf(data)).toBeNull();
  });
});

describe('keepEvidence', () => {
  it('stores the image under the match and its hash, and records the key', async () => {
    const { db, store, evidenceId, objectKey } = withEvidence();
    expect(await keepEvidence(db, store, { evidenceId, matchId: 3 }, PNG)).toBe(true);
    const key = evidenceKeyOf(3, PNG, 'image/png');
    expect(key).toMatch(/^evidence\/3\/[0-9a-f]{64}\.png$/);
    expect(objectKey()).toBe(key);
    expect(store.files.get(key)).toEqual(PNG);
    // The same file again lands on the same key.
    await keepEvidence(db, store, { evidenceId, matchId: 3 }, PNG);
    expect(store.files.size).toBe(1);
  });

  it('keeps nothing that is not an image, and survives a store that fails', async () => {
    const { db, store, evidenceId, objectKey } = withEvidence();
    expect(await keepEvidence(db, store, { evidenceId, matchId: 3 }, ascii('<html>'))).toBe(false);
    store.failing = true;
    expect(await keepEvidence(db, store, { evidenceId, matchId: 3 }, PNG)).toBe(false);
    expect(store.files.size).toBe(0);
    expect(objectKey()).toBeNull();
  });

  it('downloads a command’s attachment first, and gives up when Discord fails', async () => {
    const { db, store, evidenceId, objectKey } = withEvidence();
    const gateway = fakeGateway();
    const target = { evidenceId, matchId: 3 };
    gateway.failing = true;
    expect(await fetchAndKeepEvidence(db, gateway, store, target, 'https://x')).toBe(false);
    gateway.failing = false;
    expect(await fetchAndKeepEvidence(db, gateway, store, target, 'https://x')).toBe(true);
    expect(objectKey()).toMatch(/\.png$/);
  });
});

describe('openEvidence', () => {
  it('gives league staff the kept image with its type', async () => {
    const { db, store, evidenceId } = withEvidence();
    await keepEvidence(db, store, { evidenceId, matchId: 3 }, JPEG);
    expect(evidenceCompetition(db, evidenceId)).toBe(1);
    expect(await openEvidence(db, store, STAFF, evidenceId)).toEqual({
      ok: true,
      type: 'image/jpeg',
      data: JPEG,
    });
  });

  it('refuses anyone but staff, and finds nothing without a copy or for an unknown row', async () => {
    const { db, store, evidenceId } = withEvidence();
    expect(await openEvidence(db, store, STAFF, evidenceId)).toEqual({
      ok: false,
      error: 'not_found',
    });
    await keepEvidence(db, store, { evidenceId, matchId: 3 }, PNG);
    expect(await openEvidence(db, store, { ...STAFF, memberRoleIds: [] }, evidenceId)).toEqual({
      ok: false,
      error: 'not_staff',
    });
    expect(await openEvidence(db, store, { ...STAFF, guildId: null }, evidenceId)).toEqual({
      ok: false,
      error: 'not_linked',
    });
    expect(await openEvidence(db, store, STAFF, evidenceId + 1)).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(evidenceCompetition(db, evidenceId + 1)).toBeNull();
  });

  it('never serves a stored file that is not an image', async () => {
    const { db, store, evidenceId } = withEvidence();
    const key = `evidence/3/${'b'.repeat(64)}.png`;
    store.files.set(key, ascii('<script>alert(1)</script>'));
    db.update(schema.evidence).set({ objectKey: key }).run();
    expect(await openEvidence(db, store, STAFF, evidenceId)).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});
