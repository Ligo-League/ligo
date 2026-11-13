import type { ForfeitThresholds, RulesetSettings, SchedulingSettings } from '@ligo/core';
import { findGuildLeague, type Db } from '@ligo/db';
import { requireStaff, type Actor } from './permissions.ts';

/** What `/help` needs to explain the commands as this league runs them. */
export interface HelpFacts {
  /** Staff commands are listed in the overview for staff only; teams don't need them. */
  staff: boolean;
  /** Null on a server linked to no league: the explanations then name no league rule. */
  rules: {
    validation: RulesetSettings['result_validation'];
    teamRoles: RulesetSettings['team_roles'];
    /** Null before a season starts: thresholds are a season setting. */
    forfeits: ForfeitThresholds | null;
    extensionWeeks: number;
    autoSlot: SchedulingSettings['auto_slot'];
  } | null;
}

export function helpFacts(
  db: Pick<Db, 'select'>,
  actor: Pick<Actor, 'guildId' | 'memberRoleIds'>,
): HelpFacts {
  const league = actor.guildId === null ? undefined : findGuildLeague(db, actor.guildId);
  if (!league) return { staff: false, rules: null };
  const { rulesetJson } = league.competition;
  return {
    // The same check as every staff action, so the overview lists what this member can use.
    staff: requireStaff(db, actor).ok,
    rules: {
      validation: rulesetJson.result_validation,
      teamRoles: rulesetJson.team_roles,
      forfeits: league.season?.settingsJson.forfeits ?? null,
      extensionWeeks: league.competition.schedulingJson.extension_weeks,
      autoSlot: league.competition.schedulingJson.auto_slot,
    },
  };
}
