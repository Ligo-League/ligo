import { schema } from '@ligo/db';
import { fakeObjectStore } from '@ligo/storage';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Actor } from '../services/permissions.ts';
import { setTeamOwner } from '../services/team-staff.ts';
import {
  leagueDatabase,
  playedMatch,
  requireMoss,
  TEST_GUILD,
  TEST_STAFF_ROLE,
} from '../testing.ts';
import { ANA, testSite } from './testing.ts';

// MOSS files on the match page's staff panel (M-47, 5-10): who owes one, their files to
// download, the reason needed to validate without them, and the hold during an investigation.
// Match 3 is Bravo (Ana's) v Charlie, reported here by Bravo, with its replays.

const LEA = { id: '222222222222222222', displayName: 'Léa Staff' };
const STAFF: Actor = { guildId: TEST_GUILD, user: LEA, memberRoleIds: [TEST_STAFF_ROLE] };

function site(withFiles = false) {
  const db = leagueDatabase();
  requireMoss(db);
  setTeamOwner(db, STAFF, { teamId: 2, member: ANA }, 100);
  const objects = fakeObjectStore();
  const browser = testSite({
    db,
    users: { 'code-lea': LEA },
    replays: { objects, parserVersion: null, uploadOrigin: null },
  });
  browser.setRoles([TEST_STAFF_ROLE], LEA.id);
  const players = playedMatch(db, 3, withFiles);
  db.update(schema.match).set({ status: 'reported' }).where(eq(schema.match.id, 3)).run();
  db.update(schema.game).set({ scoreA: 7, scoreB: 5 }).where(eq(schema.game.matchId, 3)).run();
  const evidenceId = db
    .insert(schema.evidence)
    .values({
      matchId: 3,
      kind: 'score_screenshot',
      objectKey: `evidence/3/${'a'.repeat(64)}.png`,
      uploadedBy: players.a[0] ?? 0,
      at: 1,
    })
    .returning()
    .get().id;
  const stored = () => db.select().from(schema.match).where(eq(schema.match.id, 3)).get();
  const act = (action: string, fields: Record<string, string> = {}) =>
    browser.post(`/matches/3/staff/${action}`, fields);
  return { ...browser, objects, players, evidenceId, stored, act };
}
const where = (response: Response) => response.headers.get('location');

describe('MOSS files on the staff panel', () => {
  it('lists who owes a file and asks for a reason to validate while some are missing', async () => {
    const { request, logIn, act, evidenceId, stored } = site();
    await logIn('/matches/3', 'code-lea');
    const page = await (await request('/matches/3')).text();
    expect(page).toContain('Fichiers MOSS');
    expect(page).toContain('m3a1');
    expect(page).toContain('name="waiver"');
    const refused = await act('validate', { evidence: String(evidenceId) });
    expect(where(refused)).toBe('/matches/3?staff_error=moss_missing#staff');
    expect(stored()?.status).toBe('reported');
    const done = await act('validate', { evidence: String(evidenceId), waiver: 'Fichiers perdus' });
    expect(where(done)).toBe('/matches/3?staff=validated#staff');
    expect(stored()?.status).toBe('validated');
  });

  it('asks for no reason once every file is there', async () => {
    const { request, logIn } = site(true);
    await logIn('/matches/3', 'code-lea');
    const page = await (await request('/matches/3')).text();
    expect(page).toContain('télécharger');
    expect(page).not.toContain('name="waiver"');
  });

  it('holds the files with a reason, then releases them', async () => {
    const { logIn, act, stored } = site();
    await logIn('/matches/3', 'code-lea');
    expect(where(await act('moss-hold', { reason: '' }))).toBe(
      '/matches/3?staff_error=reason_required#staff',
    );
    expect(where(await act('moss-hold', { reason: 'Enquête' }))).toBe(
      '/matches/3?staff=moss_held#staff',
    );
    expect(stored()?.mossHoldReason).toBe('Enquête');
    expect(where(await act('moss-release'))).toBe('/matches/3?staff=moss_released#staff');
    expect(stored()?.mossHeldAt).toBeNull();
  });

  it('gives staff a file through a short storage link, and refuses the teams', async () => {
    const { db, request, logIn, objects, players, jar } = site(true);
    const row = db
      .select()
      .from(schema.evidence)
      .where(eq(schema.evidence.playerId, players.a[0] ?? 0))
      .get();
    await objects.put(row?.objectKey ?? '', new Uint8Array(3), 'application/octet-stream');
    await logIn('/matches/3', 'code-lea');
    const response = await request(`/evidence/${String(row?.id)}`);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(
      `https://storage.invalid/get/${row?.objectKey ?? ''}`,
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    jar.clear();
    await logIn('/matches/3');
    expect((await request(`/evidence/${String(row?.id)}`)).status).toBe(403);
  });
});
