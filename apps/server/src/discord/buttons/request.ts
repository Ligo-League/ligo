import { t, type Locale } from '../../i18n/index.ts';
import {
  answerRequest,
  checkAnswer,
  REQUEST_REASON_MAX_LENGTH,
  type AnswerReply,
} from '../../services/requests.ts';
import { buttonId } from '../button-id.ts';
import type {
  ButtonHandler,
  ButtonInteraction,
  CommandContext,
  FormHandler,
  FormSubmitInteraction,
} from '../commands/types.ts';
import { requestQueueMessage } from '../request-text.ts';
import { announceRequestDecision } from '../staff-decisions.ts';

// The buttons under a team request in the staff queue: Approve and Refuse. A team withdraws its
// request on the website. The custom ID names the request; the services re-check who clicks and its
// state.

type Failure = Extract<AnswerReply, { ok: false }>;

export const refusal = (locale: Locale, reply: Failure) =>
  reply.error === 'role_full'
    ? t(locale, 'team.error.role_full', { max: reply.max })
    : t(locale, `request.error.${reply.error}`);

/** Shows the decision on the post that was clicked, then everywhere else it goes. */
async function decided(
  interaction: Pick<ButtonInteraction | FormSubmitInteraction, 'update'>,
  reply: Extract<AnswerReply, { ok: true }>,
  context: CommandContext,
): Promise<void> {
  await interaction.update(requestQueueMessage(context.locale, reply.request));
  await announceRequestDecision(context, reply);
}

const approve: ButtonHandler = {
  action: 'request-approve',
  async execute(interaction, target, context) {
    const reply = answerRequest(
      context.db,
      interaction,
      { requestId: target.entityId, decision: 'approve', reason: null },
      context.now(),
    );
    if (!reply.ok) {
      await interaction.reply({ content: refusal(context.locale, reply), ephemeral: true });
      return;
    }
    await decided(interaction, reply, context);
  },
};

/** The refusal form: the reason, required, which the team will read. */
export function rejectForm(locale: Locale, requestId: number) {
  return {
    customId: buttonId('request-reject', requestId, 0),
    title: t(locale, 'request.form.title', { id: requestId }),
    fields: [
      {
        kind: 'text' as const,
        id: 'reason',
        label: t(locale, 'request.form.reason'),
        description: t(locale, 'request.form.reasonHint'),
        required: true,
        maxLength: REQUEST_REASON_MAX_LENGTH,
      },
    ],
  };
}

/** Refuse: opens the form, for league staff and a request still waiting. */
const reject: ButtonHandler = {
  action: 'request-reject',
  async execute(interaction, target, context) {
    const check = checkAnswer(context.db, interaction, target.entityId);
    if (!check.ok) {
      await interaction.reply({ content: refusal(context.locale, check), ephemeral: true });
      return;
    }
    await interaction.showForm(rejectForm(context.locale, target.entityId));
  },
};

const rejectSent: FormHandler = {
  action: 'request-reject',
  async execute(interaction, target, context) {
    const reply = answerRequest(
      context.db,
      interaction,
      { requestId: target.entityId, decision: 'reject', reason: interaction.getText('reason') },
      context.now(),
    );
    if (!reply.ok) {
      await interaction.reply({ content: refusal(context.locale, reply), ephemeral: true });
      return;
    }
    await decided(interaction, reply, context);
  },
};

export const requestButtonHandlers: readonly ButtonHandler[] = [approve, reject];
export const requestFormHandlers: readonly FormHandler[] = [rejectSent];
