import type { Db } from '@ligo/db';
import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type AutocompleteInteraction as DiscordAutocomplete,
  type ButtonInteraction as DiscordButton,
  type ChatInputCommandInteraction,
  type Interaction,
  type ModalSubmitInteraction as DiscordModalSubmit,
} from 'discord.js';
import type { Logger } from 'pino';
import type { AssetStore } from '../assets/store.ts';
import { DEFAULT_LOCALE } from '../i18n/index.ts';
import type { Actor } from '../services/permissions.ts';
import type {
  AutocompleteInteraction,
  ButtonHandler,
  ButtonInteraction,
  Command,
  CommandContext,
  CommandInteraction,
  FormHandler,
  FormSubmitInteraction,
  ReplyMessage,
} from './commands/types.ts';
import { createDiscordGateway } from './gateway.ts';
import { toDiscordMessage, toDiscordModal } from './outgoing.ts';
import { routeAutocomplete, routeButton, routeCommand, routeForm } from './router.ts';

// Discord shows at most this many suggestions for an option.
const MAX_CHOICES = 25;

/** Who acted, with the roles Discord sent along with the interaction. */
function actorOf(
  interaction:
    ChatInputCommandInteraction | DiscordAutocomplete | DiscordButton | DiscordModalSubmit,
): Actor {
  const roles = interaction.member?.roles;
  // A cached member carries a role manager; an uncached one the plain list of role IDs.
  const memberRoleIds = !roles ? [] : Array.isArray(roles) ? roles : [...roles.cache.keys()];
  return {
    guildId: interaction.guildId,
    user: { id: interaction.user.id, displayName: interaction.user.displayName },
    memberRoleIds,
  };
}

/** Sends a reply, or completes a deferred one. */
async function sendReply(
  interaction: ChatInputCommandInteraction | DiscordButton | DiscordModalSubmit,
  { ephemeral, ...message }: ReplyMessage,
): Promise<void> {
  const payload = toDiscordMessage(message);
  // A deferred reply was announced as public and can only be completed, not made private.
  if (interaction.deferred) await interaction.editReply(payload);
  else if (ephemeral) await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  else await interaction.reply(payload);
}

/**
 * The gateway client. Guild Members is a privileged intent: it must be enabled in the Developer
 * Portal (docs/setup.md), and the reconciler will need it to read role membership.
 */
export function createDiscordClient(deps: {
  commands: readonly Command[];
  buttons: readonly ButtonHandler[];
  forms: readonly FormHandler[];
  logger: Logger;
  db: Db;
  assets: AssetStore;
}): Client {
  const { commands, buttons, forms, logger, db, assets } = deps;
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });
  const gateway = createDiscordGateway(client);
  const contextNow = (): CommandContext => ({
    locale: DEFAULT_LOCALE,
    gatewayPingMs: client.ws.ping,
    db,
    gateway,
    assets,
    now: () => Date.now(),
  });

  client.once(Events.ClientReady, (ready) => {
    logger.info({ user: ready.user.tag, guilds: ready.guilds.cache.size }, 'Discord client ready');
  });

  client.on(Events.Error, (error) => {
    logger.error({ err: error }, 'Discord client error');
  });

  client.on(Events.InteractionCreate, (interaction: Interaction) => {
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused(true);
      const adapter: AutocompleteInteraction = {
        ...actorOf(interaction),
        commandName: interaction.commandName,
        options: {
          getSubcommand: () => interaction.options.getSubcommand(false),
          getInteger: (name) => interaction.options.getInteger(name),
        },
        focused: { name: focused.name, value: focused.value },
        async respond(choices) {
          await interaction.respond(choices.slice(0, MAX_CHOICES));
        },
      };
      routeAutocomplete(commands, adapter, contextNow(), logger).catch((error: unknown) => {
        // Reached when the suggestions could not be sent, e.g. the member kept typing.
        logger.error({ err: error, command: interaction.commandName }, 'Could not suggest');
      });
      return;
    }

    if (interaction.isButton()) {
      // Opening a form answers the click without marking it as replied.
      let formShown = false;
      const adapter: ButtonInteraction = {
        ...actorOf(interaction),
        customId: interaction.customId,
        get answered() {
          return interaction.replied || formShown;
        },
        reply: (message) => sendReply(interaction, message),
        async update(message) {
          await interaction.update(toDiscordMessage(message));
        },
        async showForm(form) {
          await interaction.showModal(toDiscordModal(form));
          formShown = true;
        },
      };
      routeButton(buttons, adapter, contextNow(), logger).catch((error: unknown) => {
        logger.error({ err: error }, 'Could not answer button');
      });
      return;
    }

    if (interaction.isModalSubmit()) {
      const adapter: FormSubmitInteraction = {
        ...actorOf(interaction),
        customId: interaction.customId,
        get answered() {
          return interaction.replied;
        },
        getText(id) {
          // discord.js throws for a field the form does not have.
          try {
            return interaction.fields.getTextInputValue(id) || null;
          } catch {
            return null;
          }
        },
        getSelected(id) {
          try {
            return interaction.fields.getStringSelectValues(id);
          } catch {
            return [];
          }
        },
        reply: (message) => sendReply(interaction, message),
        async update(message) {
          // Every form of this bot opens from a button, so it has a message to replace.
          if (!interaction.isFromMessage()) throw new Error('Form not opened from a message');
          await interaction.update(toDiscordMessage(message));
        },
      };
      routeForm(forms, adapter, contextNow(), logger).catch((error: unknown) => {
        logger.error({ err: error }, 'Could not answer form');
      });
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const adapter: CommandInteraction = {
      ...actorOf(interaction),
      channelId: interaction.channelId,
      commandName: interaction.commandName,
      options: {
        getSubcommand: () => interaction.options.getSubcommand(false),
        getSubcommandGroup: () => interaction.options.getSubcommandGroup(false),
        getString: (name) => interaction.options.getString(name),
        getInteger: (name) => interaction.options.getInteger(name),
        getBoolean: (name) => interaction.options.getBoolean(name),
        getAttachment: (name) => {
          const attachment = interaction.options.getAttachment(name);
          return (
            attachment && {
              url: attachment.url,
              contentType: attachment.contentType,
              size: attachment.size,
            }
          );
        },
        getUser: (name) => {
          const user = interaction.options.getUser(name);
          return user && { id: user.id, displayName: user.displayName };
        },
        getChannel: (name) => {
          const channel = interaction.options.getChannel(name);
          return channel && { id: channel.id };
        },
      },
      get answered() {
        return interaction.replied;
      },
      async defer() {
        await interaction.deferReply();
      },
      reply: (message) => sendReply(interaction, message),
    };

    routeCommand(commands, adapter, contextNow(), logger).catch((error: unknown) => {
      // Reached only when even the error reply could not be sent (e.g. the interaction expired).
      logger.error({ err: error, command: interaction.commandName }, 'Could not answer command');
    });
  });

  return client;
}
