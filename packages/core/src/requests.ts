import type { ApprovalMode, RequestKind, RequestsSettings } from './settings.ts';
import type { TeamRole } from './team-roles.ts';

// Team requests (design doc section 5, "Team requests"; maintainer, 13 November 2026). A team's
// owner and managers ask for changes to the team; the league approves what its rules restrict
// and the rest applies at once. Pure rules: the server stores requests and applies them.

export const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_DECISIONS = ['approve', 'reject', 'withdraw'] as const;
export type RequestDecision = (typeof REQUEST_DECISIONS)[number];

export type FilingError = 'not_allowed' | 'owner_only' | 'owner_cannot_leave';

/**
 * Whether a member of the team may file this kind of request. `self` is true when the request is
 * about the filer: leaving the team.
 */
export function mayFile(
  kind: RequestKind,
  filerRole: TeamRole,
  self: boolean,
): { ok: true } | { ok: false; error: FilingError } {
  if (kind === 'team_member_add') {
    return filerRole === 'coach' ? { ok: false, error: 'not_allowed' } : { ok: true };
  }
  if (kind === 'team_owner') {
    return filerRole === 'owner' ? { ok: true } : { ok: false, error: 'owner_only' };
  }
  if (self) {
    // A team always has someone answerable to the league: the owner hands it over first.
    return filerRole === 'owner' ? { ok: false, error: 'owner_cannot_leave' } : { ok: true };
  }
  return filerRole === 'owner' ? { ok: true } : { ok: false, error: 'owner_only' };
}

/** Who answers the request: nobody (it applies at once) or league staff. */
export function approvalFor(
  kind: RequestKind,
  settings: RequestsSettings,
  self: boolean,
): ApprovalMode {
  // Nobody can be kept on a team against their will.
  if (kind === 'team_member_remove' && self) return 'auto';
  return settings.approval[kind];
}

const NEXT_STATUS: Record<RequestDecision, RequestStatus> = {
  approve: 'approved',
  reject: 'rejected',
  withdraw: 'withdrawn',
};

/** A request is decided once: approved, rejected with a reason, or withdrawn by its team. */
export function decideRequest(
  status: RequestStatus,
  decision: RequestDecision,
): { ok: true; status: RequestStatus } | { ok: false; error: 'not_pending' } {
  if (status !== 'pending') return { ok: false, error: 'not_pending' };
  return { ok: true, status: NEXT_STATUS[decision] };
}

const HOUR_MS = 3_600_000;

/** When league staff should have answered a request filed at `requestedAt`. */
export function requestDeadline(requestedAt: number, settings: RequestsSettings): number {
  return requestedAt + settings.answer_within_hours * HOUR_MS;
}

/** When staff are reminded of a request still waiting; null when the league wants no reminder. */
export function reminderAt(requestedAt: number, settings: RequestsSettings): number | null {
  if (settings.remind_before_hours === null) return null;
  return requestDeadline(requestedAt, settings) - settings.remind_before_hours * HOUR_MS;
}
