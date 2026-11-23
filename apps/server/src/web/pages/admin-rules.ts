import { html } from 'hono/html';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import { COMPUTED_TIEBREAKS, type CompetitionRulesView } from '../../services/admin-rules.ts';
import type { SettingErrors } from '../../services/settings-form.ts';
import { csrfField, pageOf, type Page } from '../layout.ts';
import { settingsSections, type FieldView, type SectionView } from './settings-fields.ts';

// A competition's rules in the admin panel (phase 3h; design doc section 7): the points and
// tie-breakers new seasons copy, how a map is won, the veto, promotion, registration, the
// mercato, stats and dispute reasons.

type View = Extract<CompetitionRulesView, { ok: true }>;

const int = (min = 0, max?: number) =>
  ({ type: 'number', min, ...(max === undefined ? {} : { max }) }) as const;
const optionalInt = (min = 0) => ({ type: 'number', min, optional: true }) as const;
const options = <T extends string>(entries: readonly (readonly [T, MessageKey])[]) =>
  entries.map(([value, label]) => ({ value, label }));

const TIEBREAK_LABELS = {
  points: 'web.admin.rules.tiebreak.points',
  diff: 'web.admin.rules.tiebreak.diff',
  score_for: 'web.admin.rules.tiebreak.score_for',
  wins: 'web.admin.rules.tiebreak.wins',
} as const satisfies Record<(typeof COMPUTED_TIEBREAKS)[number], MessageKey>;

function vetoFields(formats: readonly string[]): FieldView[] {
  return formats.flatMap((format): FieldView[] => [
    {
      path: `ruleset.veto.formats.${format}.sequence`,
      label: 'web.admin.rules.vetoSequence',
      help: 'web.admin.rules.vetoSequenceHelp',
      input: { type: 'text', maxlength: 200 },
    },
    {
      path: `ruleset.veto.formats.${format}.decider_side`,
      label: 'web.admin.rules.deciderSide',
      input: {
        type: 'select',
        options: options([
          ['team_a', 'web.admin.rules.decider.team_a'],
          ['coin', 'web.admin.rules.decider.coin'],
          ['round_difference', 'web.admin.rules.decider.round_difference'],
        ]),
      },
    },
  ]);
}

/** The points and tie-breakers, at `prefix` (the competition's, or a season's under `settings.`). */
export function scoringFields(prefix = ''): FieldView[] {
  return [
    { path: `${prefix}points.outcomes.win`, label: 'web.admin.rules.pointsWin', input: int() },
    { path: `${prefix}points.outcomes.loss`, label: 'web.admin.rules.pointsLoss', input: int() },
    {
      path: `${prefix}points.outcomes.overtime_win`,
      label: 'web.admin.rules.pointsOvertimeWin',
      input: { type: 'number', optional: true },
    },
    {
      path: `${prefix}points.outcomes.overtime_loss`,
      label: 'web.admin.rules.pointsOvertimeLoss',
      help: 'web.admin.rules.pointsOvertimeHelp',
      input: { type: 'number', optional: true },
    },
    {
      path: `${prefix}points.forfeit.winner`,
      label: 'web.admin.rules.pointsForfeitWinner',
      input: int(),
    },
    {
      path: `${prefix}points.forfeit.loser`,
      label: 'web.admin.rules.pointsForfeitLoser',
      input: { type: 'number' },
    },
    {
      path: `${prefix}points.forfeit.counts_as_played`,
      label: 'web.admin.rules.forfeitPlayed',
      input: { type: 'checkbox' },
    },
    {
      path: `${prefix}tiebreak.criteria`,
      label: 'web.admin.rules.tiebreak',
      help: 'web.admin.rules.tiebreakHelp',
      input: {
        type: 'selectList',
        size: COMPUTED_TIEBREAKS.length,
        options: COMPUTED_TIEBREAKS.map((value) => ({ value, label: TIEBREAK_LABELS[value] })),
      },
    },
    {
      path: `${prefix}tiebreak.unresolved_tie`,
      label: 'web.admin.rules.unresolvedTie',
      input: {
        type: 'select',
        options: options([
          ['shared', 'web.admin.rules.unresolved.shared'],
          ['tiebreak_match', 'web.admin.rules.unresolved.tiebreak_match'],
          ['staff_decision', 'web.admin.rules.unresolved.staff_decision'],
        ]),
      },
    },
  ];
}

/** The rules form's sections, with one veto format block per format the competition has. */
export function rulesSections(view: View): SectionView[] {
  return [
    {
      title: 'web.admin.rules.section.scoring',
      fields: scoringFields(),
    },
    {
      title: 'web.admin.rules.section.games',
      fields: [
        {
          path: 'ruleset.game_score.win_at',
          label: 'web.admin.rules.winAt',
          help: 'web.admin.rules.winAtHelp',
          input: optionalInt(2),
        },
        {
          path: 'ruleset.game_score.overtime_rounds',
          label: 'web.admin.rules.overtimeRounds',
          input: optionalInt(1),
        },
      ],
    },
    {
      title: 'web.admin.rules.section.veto',
      groups: { 'ruleset.veto.formats': 'web.admin.rules.group.veto' },
      fields: [
        {
          path: 'ruleset.veto.step_seconds',
          label: 'web.admin.rules.stepSeconds',
          input: int(30, 3600),
        },
        ...vetoFields(view.vetoFormats),
      ],
    },
    {
      title: 'web.admin.rules.section.promotion',
      groups: { 'ruleset.promotion': 'web.admin.rules.group.promotion' },
      fields: [
        { path: 'ruleset.promotion.relegated', label: 'web.admin.rules.relegated', input: int() },
        {
          path: 'ruleset.promotion.relegation_barrage',
          label: 'web.admin.rules.relegationBarrage',
          input: int(),
        },
        {
          path: 'ruleset.promotion.barrage_opponent_place',
          label: 'web.admin.rules.barrageOpponent',
          input: int(1),
        },
      ],
    },
    {
      title: 'web.admin.rules.section.registration',
      fields: [
        {
          path: 'ruleset.registration.starters',
          label: 'web.admin.rules.starters',
          input: int(1, 20),
        },
        {
          path: 'ruleset.registration.subs_max',
          label: 'web.admin.rules.subsMax',
          input: int(0, 20),
        },
        {
          path: 'ruleset.registration.stats_consent_required',
          label: 'web.admin.rules.statsConsent',
          input: { type: 'checkbox' },
        },
        {
          path: 'ruleset.registration.invite_days',
          label: 'web.admin.rules.inviteDays',
          input: int(1, 60),
        },
        {
          path: 'ruleset.registration.min_age',
          label: 'web.admin.rules.minAge',
          help: 'web.admin.rules.emptyNone',
          input: optionalInt(1),
        },
        {
          path: 'ruleset.registration.lineup_lock_days',
          label: 'web.admin.rules.lineupLock',
          input: int(0, 60),
        },
        {
          path: 'ruleset.registration.division_max',
          label: 'web.admin.rules.divisionMax',
          input: int(2, 64),
        },
      ],
    },
    {
      title: 'web.admin.rules.section.mercato',
      fields: [
        {
          path: 'ruleset.mercato.mode',
          label: 'web.admin.rules.mercatoMode',
          input: {
            type: 'select',
            options: options([
              ['open', 'web.admin.rules.mercato.open'],
              ['windows', 'web.admin.rules.mercato.windows'],
            ]),
          },
        },
        {
          path: 'ruleset.mercato.max_moves_per_team',
          label: 'web.admin.rules.maxMoves',
          help: 'web.admin.rules.emptyNone',
          input: optionalInt(1),
        },
        {
          path: 'ruleset.mercato.lock_hours',
          label: 'web.admin.rules.lockHours',
          input: int(0, 720),
        },
        {
          path: 'ruleset.mercato.intra_club_moves',
          label: 'web.admin.rules.intraClub',
          input: {
            type: 'select',
            options: options([
              ['counted', 'web.admin.rules.intra.counted'],
              ['free', 'web.admin.rules.intra.free'],
              ['closed', 'web.admin.rules.intra.closed'],
            ]),
          },
        },
      ],
    },
    {
      title: 'web.admin.rules.section.stats',
      fields: [
        {
          path: 'ruleset.stats.entry_days',
          label: 'web.admin.rules.entryDays',
          help: 'web.admin.rules.emptyNone',
          input: optionalInt(1),
        },
        {
          path: 'ruleset.stats.kills_deaths_tolerance',
          label: 'web.admin.rules.tolerance',
          input: int(0, 50),
        },
      ],
    },
    {
      title: 'web.admin.rules.section.disputes',
      fields: [
        {
          path: 'ruleset.dispute_reasons',
          label: 'web.admin.rules.disputeReasons',
          help: 'web.admin.rules.disputeReasonsHelp',
          input: {
            type: 'rows',
            size: view.reasonRows,
            columns: [
              { name: 'key', label: 'web.admin.rules.reasonKey', maxlength: 32 },
              { name: 'label.fr', label: 'web.admin.rules.reasonFr', maxlength: 100 },
              { name: 'label.en', label: 'web.admin.rules.reasonEn', maxlength: 100 },
            ],
          },
        },
      ],
    },
  ];
}

export interface RulesPageData {
  view: View;
  typed: { values: Record<string, string>; errors: SettingErrors } | null;
  saved: boolean;
  csrf: string;
}

export function rulesPageView(locale: Locale, data: RulesPageData): Page {
  const { view } = data;
  const base = `/admin/${view.org.slug}/${view.competition.slug}`;
  const title = t(locale, 'web.admin.rules.title', { name: view.competition.name });
  return pageOf(
    title,
    html`<p><a href="${base}">${view.competition.name}</a></p>
      <h1>${title}</h1>
      <p class="muted">${t(locale, 'web.admin.rules.intro')}</p>
      ${data.saved ? html`<p class="card flash">${t(locale, 'web.admin.comp.done.saved')}</p>` : ''}
      ${
        data.typed
          ? html`<p class="card flash error">${t(locale, 'web.admin.settings.notSaved')}</p>`
          : ''
      }
      <form class="card stack" method="post" action="${base}/rules">
        ${csrfField(data.csrf)}
        ${settingsSections(
          locale,
          rulesSections(view),
          data.typed?.values ?? view.values,
          data.typed?.errors ?? {},
        )}
        <button type="submit">${t(locale, 'web.admin.org.save')}</button>
      </form>`,
  );
}
