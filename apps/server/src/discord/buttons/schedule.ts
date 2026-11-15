import { t } from '../../i18n/index.ts';
import { answerProposal } from '../../services/scheduling.ts';
import type { ButtonHandler } from '../commands/types.ts';
import { announceAnswer, answeredMessage } from '../schedule-posts.ts';

// The buttons under a proposed time. The custom ID names the match and, as nonce, the proposal;
// the service re-checks who clicks, the proposal's state and the match's.

const proposalIdOf = (nonce: string) => (/^\d{1,15}$/.test(nonce) ? Number(nonce) : -1);

const answer = (action: 'accept' | 'decline'): ButtonHandler => ({
  action: `time-${action}`,
  async execute(interaction, target, context) {
    const { locale } = context;
    const reply = answerProposal(
      context.db,
      interaction,
      { matchId: target.entityId, proposalId: proposalIdOf(target.nonce), action },
      context.now(),
    );
    if (!reply.ok) {
      await interaction.reply({
        content: t(locale, `schedule.error.${reply.error}`),
        ephemeral: true,
      });
      return;
    }
    // The buttons go once the proposal is answered; the rest is as from the website.
    await interaction.update(answeredMessage(locale, reply, interaction.user.id));
    await announceAnswer(context, reply, interaction.user.id);
  },
});

export const scheduleButtonHandlers: readonly ButtonHandler[] = [
  answer('accept'),
  answer('decline'),
];
