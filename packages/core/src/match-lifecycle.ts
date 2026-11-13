import type { ResultValidationMode } from './settings.ts';

// The life of a match result (design doc section 5, "Result lifecycle"): a team reports, the
// opponent confirms or disputes, staff validate. Only `validated` and `forfeit` count in
// standings. Who is acting is decided by the caller, from the database; this file only says
// whether that kind of actor may take that step from that status.

export type MatchLifecycleStatus =
  'scheduled' | 'reported' | 'confirmed' | 'disputed' | 'validated' | 'forfeit' | 'void';

export const MATCH_ACTIONS = [
  'report',
  'confirm',
  'dispute',
  'validate',
  'reject',
  'forfeit',
  'void',
] as const;
export type MatchAction = (typeof MATCH_ACTIONS)[number];

/** The team that reports, the other team of the match, or league staff. */
export const MATCH_ACTORS = ['reporting_team', 'opposing_team', 'staff'] as const;
export type MatchActor = (typeof MATCH_ACTORS)[number];

export type MatchStepResult =
  { ok: true; status: MatchLifecycleStatus } | { ok: false; error: 'not_allowed' | 'wrong_status' };

const AWAITING_STAFF: readonly MatchLifecycleStatus[] = ['reported', 'confirmed', 'disputed'];

const RULES: Record<
  MatchAction,
  { by: MatchActor; from: readonly MatchLifecycleStatus[]; to: MatchLifecycleStatus }
> = {
  report: { by: 'reporting_team', from: ['scheduled'], to: 'reported' },
  confirm: { by: 'opposing_team', from: ['reported'], to: 'confirmed' },
  dispute: { by: 'opposing_team', from: ['reported'], to: 'disputed' },
  validate: { by: 'staff', from: AWAITING_STAFF, to: 'validated' },
  // A rejected report puts the match back to be reported again.
  reject: { by: 'staff', from: AWAITING_STAFF, to: 'scheduled' },
  forfeit: { by: 'staff', from: ['scheduled', ...AWAITING_STAFF, 'validated'], to: 'forfeit' },
  void: { by: 'staff', from: ['scheduled', ...AWAITING_STAFF, 'validated', 'forfeit'], to: 'void' },
};

/**
 * The status a match takes when `actor` does `action`, or why it cannot. `validation` is the
 * league's `result_validation`: with `'opponent'`, the opponent's confirmation validates.
 */
export function nextMatchStatus(step: {
  status: MatchLifecycleStatus;
  action: MatchAction;
  actor: MatchActor;
  validation: ResultValidationMode;
}): MatchStepResult {
  const rule = RULES[step.action];
  // An annulled match is final for everyone, whoever asks.
  if (step.status === 'void') return { ok: false, error: 'wrong_status' };
  if (step.actor !== rule.by) return { ok: false, error: 'not_allowed' };
  if (!rule.from.includes(step.status)) return { ok: false, error: 'wrong_status' };
  const validatesOnConfirm = step.action === 'confirm' && step.validation === 'opponent';
  return { ok: true, status: validatesOnConfirm ? 'validated' : rule.to };
}
