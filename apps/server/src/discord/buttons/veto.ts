import { t } from '../../i18n/index.ts';
import { chooseVetoStep } from '../../services/veto.ts';
import type { ButtonHandler } from '../commands/types.ts';
import { readVetoNonce, vetoMessage } from '../veto-message.ts';

// A veto button names the match, the step it was offered at and the choice's place among the
// choices. The service replays the stored steps: a click out of turn or on an old message fails.
export const vetoButtonHandler: ButtonHandler = {
  action: 'veto',
  async execute(interaction, target, context) {
    const { locale } = context;
    const nonce = readVetoNonce(target.nonce);
    const reply = nonce
      ? chooseVetoStep(
          context.db,
          interaction,
          { matchId: target.entityId, step: nonce.step, choice: nonce.index },
          context.now(),
        )
      : ({ ok: false, error: 'stale' } as const);
    if (!reply.ok) {
      await interaction.reply({ content: t(locale, `veto.error.${reply.error}`), ephemeral: true });
      return;
    }
    await interaction.update(vetoMessage(locale, reply.view));
  },
};
