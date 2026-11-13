import { OTHER_DISPUTE_REASON, type DisputeReason } from '@ligo/core';
import { announceWithCard } from '../match-card.ts';
import { t, type Locale, type MessageKey } from '../../i18n/index.ts';
import {
  answerReport,
  checkDispute,
  DISPUTE_DETAILS_MAX_LENGTH,
  rejectResult,
  validateResult,
  type AnswerError,
  type AnswerReply,
  type DisputeDetails,
} from '../../services/reports.ts';
import { buttonId } from '../button-id.ts';
import type {
  ButtonHandler,
  CommandContext,
  Form,
  FormHandler,
  FormSubmitInteraction,
  ButtonInteraction,
} from '../commands/types.ts';
import { mention, notifyQueue, storedLine } from '../match-text.ts';

// The buttons under a result report. The custom ID names the match and, as nonce, the evidence
// row of the report it belongs to; the services re-check who clicks and the match's state.

const evidenceIdOf = (nonce: string) => (/^\d{1,15}$/.test(nonce) ? Number(nonce) : -1);

const ERROR_KEYS = {
  not_linked: 'match.error.not_linked',
  match_not_found: 'match.error.match_not_found',
  stale: 'match.error.stale',
  not_your_match: 'match.error.not_your_match',
  not_opponent: 'match.error.not_opponent',
  wrong_status: 'match.error.wrong_status',
  reason_unknown: 'match.error.reason_unknown',
  details_required: 'match.error.details_required',
  details_too_long: 'match.error.details_too_long',
} as const satisfies Record<AnswerError, MessageKey>;

// Every refusal is worded without parameters but one, which names the limit.
const refusal = (locale: Locale, error: AnswerError) =>
  t(locale, ERROR_KEYS[error], { max: DISPUTE_DETAILS_MAX_LENGTH });

/** The reason in the member's language; "other" is worded by the bot, not the league. */
function reasonLabel(locale: Locale, dispute: Pick<DisputeDetails, 'label'>): string {
  if (!dispute.label) return t(locale, 'dispute.reason.other');
  return dispute.label[locale] ?? dispute.label.fr;
}

/** Tells the channel, then staff, that the report was answered. Its buttons go once answered. */
async function announceAnswer(
  interaction: Pick<ButtonInteraction | FormSubmitInteraction, 'update' | 'user'>,
  reply: Extract<AnswerReply, { ok: true }>,
  context: CommandContext,
): Promise<void> {
  const { locale } = context;
  const line = storedLine(locale, reply.match);
  const member = mention(interaction.user.id);
  // The public message names no reason: a reason can accuse a player, and staff decide.
  await interaction.update({ content: t(locale, `report.${reply.status}`, { line, member }) });
  if (reply.status === 'validated') {
    await announceWithCard(
      context,
      reply.resultsChannelId,
      { content: t(locale, 'result.announce', { line }) },
      reply.match.id,
      'result',
    );
    return;
  }
  if (reply.dispute) {
    const reason = t(locale, 'queue.disputedWithReason', {
      line,
      member,
      reason: reasonLabel(locale, reply.dispute),
    });
    // A block quote keeps the team's own words apart from the bot's; mentions never ping.
    const details = reply.dispute.details === null ? '' : `\n>>> ${reply.dispute.details}`;
    await notifyQueue(
      context,
      reply.queueChannelId,
      { content: reason + details },
      { entity: 'dispute', entityId: reply.dispute.id },
    );
    return;
  }
  await notifyQueue(
    context,
    reply.queueChannelId,
    { content: t(locale, `queue.${reply.status}`, { line, member }) },
    { entity: 'match', entityId: reply.match.id },
  );
}

/** Confirm, under the public report: for the other team. */
const confirm: ButtonHandler = {
  action: 'report-confirm',
  async execute(interaction, target, context) {
    const reply = answerReport(
      context.db,
      interaction,
      { matchId: target.entityId, evidenceId: evidenceIdOf(target.nonce), action: 'confirm' },
      context.now(),
    );
    if (!reply.ok) {
      await interaction.reply({ content: refusal(context.locale, reply.error), ephemeral: true });
      return;
    }
    await announceAnswer(interaction, reply, context);
  },
};

/** The dispute form: a reason from the league's list or "other", and the team's details. */
export function disputeForm(
  locale: Locale,
  target: { matchId: number; evidenceId: number },
  reasons: readonly DisputeReason[],
): Form {
  return {
    customId: buttonId('report-dispute', target.matchId, target.evidenceId),
    title: t(locale, 'dispute.form.title'),
    fields: [
      {
        kind: 'select',
        id: 'reason',
        label: t(locale, 'dispute.form.reason'),
        options: [
          ...reasons.map((reason) => ({
            value: reason.key,
            label: reasonLabel(locale, reason),
          })),
          { value: OTHER_DISPUTE_REASON, label: t(locale, 'dispute.reason.other') },
        ],
      },
      {
        kind: 'text',
        id: 'details',
        label: t(locale, 'dispute.form.details'),
        description: t(locale, 'dispute.form.detailsHint'),
        required: false,
        maxLength: DISPUTE_DETAILS_MAX_LENGTH,
      },
    ],
  };
}

/**
 * Dispute, under the public report: opens the form for the other team. Someone who may not
 * dispute is told at once instead of filling a form for nothing.
 */
const dispute: ButtonHandler = {
  action: 'report-dispute',
  async execute(interaction, target, context) {
    const request = { matchId: target.entityId, evidenceId: evidenceIdOf(target.nonce) };
    const check = checkDispute(context.db, interaction, request);
    if (!check.ok) {
      await interaction.reply({ content: refusal(context.locale, check.error), ephemeral: true });
      return;
    }
    await interaction.showForm(disputeForm(context.locale, request, check.reasons));
  },
};

/** The sent dispute form. Everything is checked again: time has passed since the click. */
const disputeSent: FormHandler = {
  action: 'report-dispute',
  async execute(interaction, target, context) {
    const reply = answerReport(
      context.db,
      interaction,
      {
        matchId: target.entityId,
        evidenceId: evidenceIdOf(target.nonce),
        action: 'dispute',
        reason: interaction.getSelected('reason')[0] ?? '',
        details: interaction.getText('details'),
      },
      context.now(),
    );
    if (!reply.ok) {
      await interaction.reply({ content: refusal(context.locale, reply.error), ephemeral: true });
      return;
    }
    await announceAnswer(interaction, reply, context);
  },
};

/** Validate and Reject, under the staff queue post: for league staff. */
const decide = (action: 'validate' | 'reject'): ButtonHandler => ({
  action: `report-${action}`,
  async execute(interaction, target, context) {
    const { locale } = context;
    const request = { matchId: target.entityId, evidenceId: evidenceIdOf(target.nonce) };
    const reply =
      action === 'validate'
        ? validateResult(context.db, interaction, request, context.now())
        : rejectResult(context.db, interaction, request, context.now());
    if (!reply.ok) {
      await interaction.reply({
        content: t(locale, `match.error.${reply.error}`),
        ephemeral: true,
      });
      return;
    }

    const line = storedLine(locale, reply.match);
    const member = mention(interaction.user.id);
    await interaction.update({
      content: t(locale, action === 'validate' ? 'queue.validated' : 'queue.rejected', {
        line,
        member,
      }),
    });
    if (reply.status === 'validated') {
      await announceWithCard(
        context,
        reply.resultsChannelId,
        { content: t(locale, 'result.announce', { line }) },
        reply.match.id,
        'result',
      );
    }
  },
});

export const reportFormHandlers: readonly FormHandler[] = [disputeSent];

export const reportButtonHandlers: readonly ButtonHandler[] = [
  confirm,
  dispute,
  decide('validate'),
  decide('reject'),
];
