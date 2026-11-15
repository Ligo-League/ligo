import { createHash } from 'node:crypto';
import { listLeagueMatches, schema, type Db } from '@ligo/db';
import { eq } from 'drizzle-orm';
import type { EvidenceStore } from '../assets/evidence-store.ts';
import type { DiscordGateway } from '../discord/gateway.ts';
import { matchActorOf, requireStaff, sideOf, type Actor } from './permissions.ts';
import { SCREENSHOT_MAX_BYTES } from './results.ts';

// The server keeps its own copy of each score screenshot (maintainer, 14 November 2026), so the
// website can show it: the address Discord gives for an upload expires within a day.

const { evidence } = schema;

export type ImageType = 'image/png' | 'image/jpeg' | 'image/webp';

const EXTENSIONS: Record<ImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const startsWith = (data: Uint8Array, bytes: readonly number[], offset = 0) =>
  bytes.every((byte, index) => data[offset + index] === byte);
const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));

/**
 * The image type the file's first bytes show, whatever its name or declared type says; null for
 * anything else. Only these three are kept and served.
 */
export function imageTypeOf(data: Uint8Array): ImageType | null {
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(data, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(data, ascii('RIFF')) && startsWith(data, ascii('WEBP'), 8)) return 'image/webp';
  return null;
}

/** Where a screenshot is kept: by match, named by its content, so a file is stored once. */
export function evidenceKeyOf(matchId: number, data: Uint8Array, type: ImageType): string {
  const sha256 = createHash('sha256').update(data).digest('hex');
  return `evidence/${String(matchId)}/${sha256}.${EXTENSIONS[type]}`;
}

/**
 * Keeps the server's copy of a screenshot and records its key on the evidence row. False when the
 * file is not an image or could not be stored: the Discord copy is then all there is.
 */
export async function keepEvidence(
  db: Db,
  store: EvidenceStore,
  target: { evidenceId: number; matchId: number },
  data: Uint8Array,
): Promise<boolean> {
  const type = imageTypeOf(data);
  if (!type) return false;
  const key = evidenceKeyOf(target.matchId, data, type);
  try {
    await store.put(key, data);
  } catch {
    // The store logs what failed; the result stands on the Discord copy.
    return false;
  }
  db.update(evidence).set({ objectKey: key }).where(eq(evidence.id, target.evidenceId)).run();
  return true;
}

/** Downloads a screenshot attached to a command, then keeps it as `keepEvidence` does. */
export async function fetchAndKeepEvidence(
  db: Db,
  gateway: Pick<DiscordGateway, 'downloadAttachment'>,
  store: EvidenceStore,
  target: { evidenceId: number; matchId: number },
  url: string,
): Promise<boolean> {
  let data: Uint8Array;
  try {
    data = await gateway.downloadAttachment(url, SCREENSHOT_MAX_BYTES);
  } catch {
    return false;
  }
  return keepEvidence(db, store, target, data);
}

/** The competition an evidence row belongs to, through its match; null for an unknown row. */
export function evidenceCompetition(db: Pick<Db, 'select'>, evidenceId: number): number | null {
  const row = db
    .select({ matchId: evidence.matchId })
    .from(evidence)
    .where(eq(evidence.id, evidenceId))
    .get();
  if (!row) return null;
  return listLeagueMatches(db, { matchId: row.matchId })[0]?.competitionId ?? null;
}

export type EvidenceReply =
  | { ok: true; type: ImageType; data: Uint8Array }
  | { ok: false; error: 'not_linked' | 'not_staff' | 'not_found' };

/**
 * The server's copy of a piece of evidence, for league staff of its match's league and, unless
 * it is marked for staff, for the match's two teams (officials and captain). Evidence of another
 * league, or without a copy, is not found.
 */
export async function openEvidence(
  db: Pick<Db, 'select'>,
  store: EvidenceStore,
  actor: Actor,
  evidenceId: number,
): Promise<EvidenceReply> {
  const row = db.select().from(evidence).where(eq(evidence.id, evidenceId)).get();
  const [found] = row ? listLeagueMatches(db, { matchId: row.matchId }) : [];
  const staff = requireStaff(db, actor);
  if (!staff.ok) {
    const team =
      row?.visibility !== 'staff' &&
      found !== undefined &&
      sideOf(matchActorOf(db, actor, found.seasonId).teams, found) !== null;
    if (!team) return staff;
  } else if (found?.competitionId !== staff.league.competition.id) {
    return { ok: false, error: 'not_found' };
  }
  if (!row?.objectKey) return { ok: false, error: 'not_found' };
  const data = await store.read(row.objectKey);
  // Checked again on the way out: only an image is ever served.
  const type = data && imageTypeOf(data);
  return data && type ? { ok: true, type, data } : { ok: false, error: 'not_found' };
}
