import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { MessageButton, OutgoingMessage } from './commands/types.ts';

const STYLES: Record<MessageButton['style'], ButtonStyle> = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

/** An outgoing message in the shape discord.js sends, for a reply, a post or an edit. */
export function toDiscordMessage(message: OutgoingMessage) {
  const { content, files = [], buttons = [], mentionUserIds = [] } = message;
  return {
    content,
    files: files.map((file) => new AttachmentBuilder(Buffer.from(file.data), { name: file.name })),
    components:
      buttons.length === 0
        ? []
        : [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              buttons.map((button) =>
                new ButtonBuilder()
                  .setCustomId(button.customId)
                  .setLabel(button.label)
                  .setStyle(STYLES[button.style]),
              ),
            ),
          ],
    // Text coming from team names or notes must never ping @everyone or a role: only the users
    // the caller names are notified.
    allowedMentions: { parse: [], users: [...mentionUserIds] },
  };
}
