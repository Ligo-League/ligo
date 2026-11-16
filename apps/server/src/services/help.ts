import type { RulesetSettings } from '@ligo/core';
import { findGuildLeague, type Db } from '@ligo/db';
import { requireStaff, type Actor } from './permissions.ts';

/** What `/help` needs to explain the commands as this league runs them. */
export interface HelpFacts {
  /** Staff commands are listed in the overview for staff only; teams don't need them. */
  staff: boolean;
  /** How a reported result is validated; null on a server linked to no league. */
  validation: RulesetSettings['result_validation'] | null;
}

export function helpFacts(
  db: Pick<Db, 'select'>,
  actor: Pick<Actor, 'guildId' | 'memberRoleIds'>,
): HelpFacts {
  const league = actor.guildId === null ? undefined : findGuildLeague(db, actor.guildId);
  if (!league) return { staff: false, validation: null };
  return {
    // The same check as every staff action, so the overview lists what this member can use.
    staff: requireStaff(db, actor).ok,
    validation: league.competition.rulesetJson.result_validation,
  };
}
