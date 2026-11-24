import type { MossGap } from '@ligo/core';
import type { Db, LeagueMatch } from '@ligo/db';
import { mossCheck } from './moss.ts';

// What a result waits for before it can count (design doc section 4, "Invariants"): every MOSS
// file where the league asks for them (M-47; 5-10), and both teams' replays where it asks for
// those (M-49; 5-11). The teams can never get past them; league staff may, with a written reason
// that the audit log keeps. A forfeit waits for nothing.

export type ValidationBlocker = { kind: 'moss'; gaps: MossGap[] };

export const WAIVER_MAX_LENGTH = 500;

export function validationBlockers(
  db: Pick<Db, 'select'>,
  found: LeagueMatch,
): ValidationBlocker[] {
  const moss = mossCheck(db, found);
  return moss.required && moss.gaps.length > 0 ? [{ kind: 'moss', gaps: moss.gaps }] : [];
}

/** Staff's reason for validating anyway, trimmed; null when none was written. */
export function readWaiver(raw: string | null | undefined): string | null {
  const reason = raw?.trim().slice(0, WAIVER_MAX_LENGTH) ?? '';
  return reason === '' ? null : reason;
}
