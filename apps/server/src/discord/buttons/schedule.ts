import { t } from '../../i18n/index.ts';
import { answerProposal } from '../../services/scheduling.ts';
import type { ButtonHandler } from '../commands/types.ts';
import { discordTime, matchFixture, mention, notify } from '../match-text.ts';

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
    const text = {
      fixture: matchFixture(locale, reply.match),
      when: discordTime(reply.at),
      member: mention(interaction.user.id),
    };
    // The buttons go once the proposal is answered.
    await interaction.update({ content: t(locale, `schedule.${reply.status}`, text) });
    if (reply.status === 'accepted') {
      await notify(context, reply.scheduleChannelId, {
        content: t(locale, 'schedule.announce', text),
      });
    }
  },
});

export const scheduleButtonHandlers: readonly ButtonHandler[] = [
  answer('accept'),
  answer('decline'),
];
