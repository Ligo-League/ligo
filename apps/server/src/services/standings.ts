import {
  computeStandings,
  rankChanges,
  recentForm,
  type FormResult,
  type StandingsRow,
} from '@ligo/core';
import { findGuildLeague, loadStandingsInput, type Db, type Theme } from '@ligo/db';

export interface StandingsTableRow extends Omit<StandingsRow, 'entry'> {
  team: { name: string; tag: string; colors: string[]; logoKey: string | null };
  /** The team's latest results, oldest first, at most `FORM_LENGTH`. */
  form: FormResult[];
  /** Places gained since the previous week (negative: lost); null before there is one. */
  change: number | null;
}

const FORM_LENGTH = 5;

export interface StandingsTable {
  division: string;
  rows: StandingsTableRow[];
}

export type StandingsReply =
  | {
      ok: true;
      competition: string;
      season: string;
      /** The league's image colours, where it set any. */
      theme: Theme;
      tables: StandingsTable[];
    }
  | { ok: false; error: 'not_linked' | 'no_season' | 'no_standings' }
  | { ok: false; error: 'unknown_division'; divisions: string[] };

/**
 * The current standings of the league a Discord server belongs to, computed from results on
 * every call. `division` narrows them to one division, by name or by its short prefix ("L1").
 */
export function getStandings(
  db: Db,
  request: { guildId: string | null; division?: string | null },
): StandingsReply {
  const league = request.guildId === null ? undefined : findGuildLeague(db, request.guildId);
  if (!league) return { ok: false, error: 'not_linked' };
  if (!league.season) return { ok: false, error: 'no_season' };

  let divisions = league.divisions;
  const wanted = request.division?.trim().toLowerCase();
  if (wanted) {
    divisions = divisions.filter(
      ({ division }) =>
        division.name.toLowerCase() === wanted || division.categoryPrefix.toLowerCase() === wanted,
    );
    if (divisions.length === 0) {
      const names = league.divisions.map(({ division }) => division.name);
      return { ok: false, error: 'unknown_division', divisions: names };
    }
  }

  const tables: StandingsTable[] = [];
  for (const { division, stageId } of divisions) {
    const data = stageId === undefined ? undefined : loadStandingsInput(db, stageId);
    if (!data) continue;
    const standings = computeStandings(data.input);
    if (!standings.ok) {
      // The competition's settings ask for something the engine cannot do: a setup fault that
      // staff must see in the logs, not a table computed by other rules.
      throw new Error(`Standings of ${division.name} failed: ${JSON.stringify(standings.error)}`);
    }
    const changes = rankChanges(data.input);
    tables.push({
      division: division.name,
      rows: standings.rows.map(({ entry, ...row }) => {
        const team = data.teams.find((candidate) => candidate.entry === entry);
        // computeStandings returns exactly the entries it was given, which come from `teams`.
        if (!team) throw new Error(`Standings row for unknown entry ${entry}`);
        return {
          ...row,
          team: { name: team.name, tag: team.tag, colors: team.colors, logoKey: team.logoKey },
          form: recentForm(data.input.matches, entry, FORM_LENGTH),
          change: changes?.get(entry) ?? null,
        };
      }),
    });
  }
  if (tables.length === 0) return { ok: false, error: 'no_standings' };

  return {
    ok: true,
    competition: league.competition.name,
    season: league.season.name,
    theme: league.competition.themeJson,
    tables,
  };
}
