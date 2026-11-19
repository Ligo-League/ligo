import { t, type Locale } from '../../i18n/index.ts';
import {
  checkMoveAnswer,
  decideMove,
  MOVE_REASON_MAX,
  type DecideMoveError,
  type DecideMoveReply,
} from '../../services/roster-move-apply.ts';
import { buttonId } from '../button-id.ts';
import type {
  ButtonHandler,
  ButtonInteraction,
  CommandContext,
  FormHandler,
  FormSubmitInteraction,
} from '../commands/types.ts';
import { announceMoveDecision, moveQueueMessage } from '../move-posts.ts';

// The buttons under a mercato move in the staff queue (design doc section 7): Validate, and
// Refuse with a reason the team reads. The team withdraws its move on the website. The custom ID
// names the move; the service checks who clicks and the move's state again.

const refusal = (locale: Locale, error: DecideMoveError) =>
  t(locale, `web.rosterMercato.error.${error}`);

/** Shows the decision on the post that was clicked, then everywhere else it goes. */
async function decided(
  interaction: Pick<ButtonInteraction | FormSubmitInteraction, 'update' | 'user'>,
  reply: Extract<DecideMoveReply, { ok: true }>,
  context: CommandContext,
): Promise<void> {
  const details = { team: reply.team, move: reply.move, publicUrl: context.publicUrl };
  await interaction.update(moveQueueMessage(context.locale, details, interaction.user.id));
  await announceMoveDecision(context, reply, interaction.user.id, context.publicUrl);
}

const approve: ButtonHandler = {
  action: 'move-approve',
  async execute(interaction, target, context) {
    const reply = decideMove(
      context.db,
      interaction,
      { requestId: target.entityId, decision: 'approve', reason: null },
      context.now(),
    );
    if (!reply.ok) {
      await interaction.reply({ content: refusal(context.locale, reply.error), ephemeral: true });
      return;
    }
    await decided(interaction, reply, context);
  },
};

/** The refusal form: the reason, required, which the team will read. */
export function moveRejectForm(locale: Locale, moveId: number) {
  return {
    customId: buttonId('move-reject', moveId, 0),
    title: t(locale, 'mercato.form.title', { id: moveId }),
    fields: [
      {
        kind: 'text' as const,
        id: 'reason',
        label: t(locale, 'mercato.form.reason'),
        description: t(locale, 'mercato.form.reasonHint'),
        required: true,
        maxLength: MOVE_REASON_MAX,
      },
    ],
  };
}

/** Refuse: opens the form, for league staff and a move still waiting. */
const reject: ButtonHandler = {
  action: 'move-reject',
  async execute(interaction, target, context) {
    const check = checkMoveAnswer(context.db, interaction, target.entityId);
    if (!check.ok) {
      await interaction.reply({ content: refusal(context.locale, check.error), ephemeral: true });
      return;
    }
    await interaction.showForm(moveRejectForm(context.locale, target.entityId));
  },
};

const rejectSent: FormHandler = {
  action: 'move-reject',
  async execute(interaction, target, context) {
    const reply = decideMove(
      context.db,
      interaction,
      { requestId: target.entityId, decision: 'reject', reason: interaction.getText('reason') },
      context.now(),
    );
    if (!reply.ok) {
      await interaction.reply({ content: refusal(context.locale, reply.error), ephemeral: true });
      return;
    }
    await decided(interaction, reply, context);
  },
};

export const moveButtonHandlers: readonly ButtonHandler[] = [approve, reject];
export const moveFormHandlers: readonly FormHandler[] = [rejectSent];
