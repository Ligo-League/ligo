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
import {
  disputeQueueMessage,
  mention,
  notifyQueue,
  reasonLabel,
  storedLine,
} from '../match-text.ts';
import { announceReportDecision, reportDecisionMessage } from '../staff-decisions.ts';

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
    // The report's post in the staff queue no longer waits for staff: it says so, without buttons.
    for (const post of reply.posts) {
      try {
        await context.gateway.editMessage(post.channelId, post.messageId, {
          content: t(locale, 'queue.validatedByOpponent', { line, member }),
        });
      } catch {
        // A post deleted or out of reach only looks out of date: the result is stored.
      }
    }
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
    await notifyQueue(
      context,
      reply.queueChannelId,
      disputeQueueMessage(locale, line, interaction.user.id, reply.dispute),
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

    await interaction.update(reportDecisionMessage(locale, reply, interaction.user.id));
    await announceReportDecision(context, reply, interaction.user.id);
  },
});

export const reportFormHandlers: readonly FormHandler[] = [disputeSent];

export const reportButtonHandlers: readonly ButtonHandler[] = [
  confirm,
  dispute,
  decide('validate'),
  decide('reject'),
];
