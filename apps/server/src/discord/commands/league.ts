import { ApplicationCommandOptionType, ChannelType } from 'discord.js';
import { catalogs, t } from '../../i18n/index.ts';
import { LEAGUE_CHANNEL_KINDS, setLeagueChannel } from '../../services/league-channels.ts';
import { described, english, STAFF_ONLY } from './describe.ts';
import type { Command } from './types.ts';

const isKind = (value: string | null): value is (typeof LEAGUE_CHANNEL_KINDS)[number] =>
  LEAGUE_CHANNEL_KINDS.some((kind) => kind === value);

export const leagueCommand: Command = {
  data: {
    name: 'league',
    ...described('command.league.description'),
    ...STAFF_ONLY,
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'channel',
        ...described('command.league.channel.description'),
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'kind',
            ...described('command.league.channel.option.kind'),
            required: true,
            choices: LEAGUE_CHANNEL_KINDS.map((kind) => ({
              name: catalogs.fr[`league.channel.kind.${kind}`],
              name_localizations: english(`league.channel.kind.${kind}`),
              value: kind,
            })),
          },
          {
            type: ApplicationCommandOptionType.Channel,
            name: 'channel',
            ...described('command.league.channel.option.channel'),
            required: true,
            channel_types: [ChannelType.GuildText],
          },
        ],
      },
    ],
  },

  async execute(interaction, context) {
    const { locale } = context;
    const privately = (content: string) => interaction.reply({ content, ephemeral: true });
    const kind = interaction.options.getString('kind');
    const channel = interaction.options.getChannel('channel');
    if (interaction.options.getSubcommand() !== 'channel' || !isKind(kind) || !channel) {
      await privately(t(locale, 'error.unknownCommand'));
      return;
    }

    const reply = await setLeagueChannel(
      context.db,
      context.gateway,
      interaction,
      { kind, channelId: channel.id, notice: t(locale, `league.channel.notice.${kind}`) },
      context.now(),
    );
    await privately(
      reply.ok
        ? t(locale, 'league.channel.set', {
            kind: t(locale, `league.channel.kind.${kind}`),
            channel: reply.channelId,
          })
        : t(locale, `league.error.${reply.error}`),
    );
  },
};
