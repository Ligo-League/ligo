import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { Form, FormField, MessageButton, OutgoingMessage } from './commands/types.ts';

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

function toLabel(field: FormField): LabelBuilder {
  const label = new LabelBuilder().setLabel(field.label);
  if (field.kind === 'select') {
    return label.setStringSelectMenuComponent(
      new StringSelectMenuBuilder()
        .setCustomId(field.id)
        .setRequired(true)
        .addOptions(field.options.map((option) => ({ value: option.value, label: option.label }))),
    );
  }
  if (field.description) label.setDescription(field.description);
  return label.setTextInputComponent(
    new TextInputBuilder()
      .setCustomId(field.id)
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(field.required)
      .setMaxLength(field.maxLength),
  );
}

/** A form in the shape discord.js opens as a modal. */
export function toDiscordModal(form: Form): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(form.customId)
    .setTitle(form.title)
    .addLabelComponents(form.fields.map(toLabel));
}
