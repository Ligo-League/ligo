import { ApplicationCommandOptionType, ChannelType } from 'discord.js';
import { catalogs, t, type Locale } from '../../i18n/index.ts';
import {
  LEAGUE_CHANNEL_KINDS,
  listLeagueChannels,
  searchDivisions,
  setLeagueChannel,
} from '../../services/league-channels.ts';
import { described, english, MAX_CHOICE_LENGTH, MAX_CHOICES, STAFF_ONLY } from './describe.ts';
import type { Command, CommandContext, CommandInteraction } from './types.ts';

const isKind = (value: string | null): value is (typeof LEAGUE_CHANNEL_KINDS)[number] =>
  LEAGUE_CHANNEL_KINDS.some((kind) => kind === value);

const channelText = (locale: Locale, channelId: string | null) =>
  channelId === null ? t(locale, 'league.channels.unset') : `<#${channelId}>`;

async function listChannels(
  interaction: CommandInteraction,
  context: CommandContext,
): Promise<void> {
  const { locale } = context;
  const reply = listLeagueChannels(context.db, interaction);
  if (!reply.ok) {
    await interaction.reply({ content: t(locale, `league.error.${reply.error}`), ephemeral: true });
    return;
  }
  const lines = [
    t(locale, 'league.channels.title'),
    `${t(locale, 'league.channel.kind.staff_queue')} : ${channelText(locale, reply.queueChannelId)}`,
    `${t(locale, 'league.channel.kind.schedule')} : ${channelText(locale, reply.scheduleChannelId)}`,
    // The divisions' own results channels follow the league's, which they fall back to.
    `${t(locale, 'league.channel.kind.results')} : ${channelText(locale, reply.resultsChannelId)}`,
    ...reply.divisions.map((row) =>
      t(locale, 'league.channels.division', {
        division: row.name,
        channel:
          row.resultsChannelId === null
            ? t(locale, 'league.channels.inherited')
            : `<#${row.resultsChannelId}>`,
      }),
    ),
  ];
  await interaction.reply({ content: lines.join('\n'), ephemeral: true });
}

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
            required: false,
            channel_types: [ChannelType.GuildText],
          },
          {
            type: ApplicationCommandOptionType.Integer,
            name: 'division',
            ...described('command.league.channel.option.division'),
            required: false,
            autocomplete: true,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'channels',
        ...described('command.league.channels.description'),
      },
    ],
  },

  async execute(interaction, context) {
    const { locale } = context;
    const privately = (content: string) => interaction.reply({ content, ephemeral: true });
    if (interaction.options.getSubcommand() === 'channels') {
      await listChannels(interaction, context);
      return;
    }
    const kind = interaction.options.getString('kind');
    if (interaction.options.getSubcommand() !== 'channel' || !isKind(kind)) {
      await privately(t(locale, 'error.unknownCommand'));
      return;
    }

    const reply = await setLeagueChannel(
      context.db,
      context.gateway,
      interaction,
      {
        kind,
        channelId: interaction.options.getChannel('channel')?.id ?? null,
        divisionId: interaction.options.getInteger('division'),
        notice: (division) =>
          division === null
            ? t(locale, `league.channel.notice.${kind}`)
            : t(locale, 'league.channel.notice.resultsDivision', { division }),
      },
      context.now(),
    );
    if (!reply.ok) {
      await privately(t(locale, `league.error.${reply.error}`));
      return;
    }
    const kindName = t(locale, `league.channel.kind.${kind}`);
    if (reply.channelId === null) {
      await privately(
        t(locale, 'league.channel.cleared', { division: reply.division?.name ?? '' }),
      );
    } else if (reply.division) {
      await privately(
        t(locale, 'league.channel.setDivision', {
          kind: kindName,
          division: reply.division.name,
          channel: reply.channelId,
        }),
      );
    } else {
      await privately(
        t(locale, 'league.channel.set', { kind: kindName, channel: reply.channelId }),
      );
    }
  },

  async autocomplete(interaction, context) {
    if (interaction.focused.name !== 'division') {
      await interaction.respond([]);
      return;
    }
    const found = searchDivisions(context.db, interaction, interaction.focused.value);
    await interaction.respond(
      found.slice(0, MAX_CHOICES).map((row) => ({
        name: `${row.name} (${row.categoryPrefix})`.slice(0, MAX_CHOICE_LENGTH),
        value: row.id,
      })),
    );
  },
};
