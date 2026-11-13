import { t } from '../../i18n/index.ts';
import { answerReport, rejectResult, validateResult } from '../../services/reports.ts';
import type { ButtonHandler } from '../commands/types.ts';
import { mention, notify, storedLine } from '../match-text.ts';

// The buttons under a result report. The custom ID names the match and, as nonce, the evidence
// row of the report it belongs to; the services re-check who clicks and the match's state.

const evidenceIdOf = (nonce: string) => (/^\d{1,15}$/.test(nonce) ? Number(nonce) : -1);

/** Confirm and Dispute, under the public report: for the other team. */
const answer = (action: 'confirm' | 'dispute'): ButtonHandler => ({
  action: `report-${action}`,
  async execute(interaction, target, context) {
    const { locale } = context;
    const reply = answerReport(
      context.db,
      interaction,
      { matchId: target.entityId, evidenceId: evidenceIdOf(target.nonce), action },
      context.now(),
    );
    if (!reply.ok) {
      await interaction.reply({
        content: t(locale, `match.error.${reply.error}`),
        ephemeral: true,
      });
      return;
    }

    const line = storedLine(locale, reply.match);
    const member = mention(interaction.user.id);
    // The buttons go once the report is answered.
    await interaction.update({ content: t(locale, `report.${reply.status}`, { line, member }) });
    if (reply.status === 'validated') {
      await notify(context, reply.resultsChannelId, {
        content: t(locale, 'result.announce', { line }),
      });
    } else {
      await notify(context, reply.queueChannelId, {
        content: t(locale, `queue.${reply.status}`, { line, member }),
      });
    }
  },
});

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
      await notify(context, reply.resultsChannelId, {
        content: t(locale, 'result.announce', { line }),
      });
    }
  },
});

export const reportButtonHandlers: readonly ButtonHandler[] = [
  answer('confirm'),
  answer('dispute'),
  decide('validate'),
  decide('reject'),
];
