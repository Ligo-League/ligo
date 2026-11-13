// Allowed values of the enum columns of schema v1 (design doc section 4).
// Each list types its column and feeds the column's CHECK constraint.

export const LOCALES = ['fr', 'en'] as const;
export const LEGAL_STATUSES = ['association', 'association_1901', 'company', 'amateur'] as const;
export const TEAM_STAFF_ROLES = ['manager', 'staff'] as const;

export const PARTICIPANT_MODES = ['team', 'mixed'] as const;
export const SEASON_STATUSES = ['registration', 'active', 'cup', 'closed'] as const;
export const DIVISION_KINDS = ['league', 'regional'] as const;
export const SLOT_STATUSES = ['active', 'frozen', 'withdrawn', 'excluded'] as const;
export const ROSTER_ROLES = ['player', 'sub', 'coach'] as const;
export const STAGE_KINDS = [
  'round_robin',
  'single_elim',
  'double_elim',
  'barrage',
  'ladder',
] as const;
export const STAGE_STATUSES = ['draft', 'published', 'closed'] as const;

export const SIDES = ['a', 'b'] as const;
export const MATCH_STATUSES = [
  'scheduled',
  'reported',
  'confirmed',
  'disputed',
  'validated',
  'forfeit',
  'void',
] as const;
export const MATCH_SLOT_SOURCES = ['entry', 'seed', 'winner_of', 'loser_of'] as const;
export const LINEUP_ROLES = ['starter', 'sub'] as const;
export const GAME_STATUSES = ['pending', 'final', 'void'] as const;
export const STATS_SOURCES = ['none', 'manual', 'replay', 'api'] as const;
export const EVIDENCE_KINDS = ['score_screenshot', 'moss', 'vod_link', 'other'] as const;
export const EVIDENCE_VISIBILITIES = ['staff', 'teams', 'public'] as const;
/** Where a proposed match time stands; only `pending` can still be answered. */
export const PROPOSAL_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'superseded',
  'withdrawn',
] as const;
/** One step of a map veto (design doc section 5); `decider` is the map left, nobody's choice. */
export const VETO_ACTIONS = ['ban', 'pick', 'decider', 'side', 'ot_side'] as const;
export const START_SIDES = ['attack', 'defense'] as const;
/** How staff settled a disputed report: the action that took the match out of dispute. */
export const DISPUTE_RESOLUTIONS = [
  'validated',
  'rejected',
  'voided',
  'result_entered',
  'forfeit',
] as const;
export const SANCTION_TARGETS = ['slot', 'team', 'player', 'staff'] as const;
export const SANCTION_KINDS = [
  'warning',
  'admin_defeat',
  'points',
  'forfeit',
  'suspension',
  'exclusion',
  'slot_freeze',
  'slot_withdrawal',
  'accreditation_removal',
  'league_ban',
] as const;

export const AUDIT_ACTOR_KINDS = ['user', 'bot', 'system'] as const;
