import { slugify } from '@ligo/core';
import { STANDINGS_ZONE_KINDS, type StandingsZoneKind } from '@ligo/core';
import { renderStandingsPng, resolveTheme, type ImageTheme } from '@ligo/render';
import { ApplicationCommandOptionType } from 'discord.js';
import type { AssetStore } from '../../assets/store.ts';
import { catalogs, t, type Locale, type MessageKey } from '../../i18n/index.ts';
import {
  getStandings,
  type StandingsReply,
  type StandingsTable,
} from '../../services/standings.ts';
import { loadLogos } from '../../services/logos.ts';
import { formatStandingsTable } from '../standings-table.ts';
import { described, english } from './describe.ts';
import type { Command, CommandFile } from './types.ts';

// Discord refuses a message longer than this.
const MESSAGE_LIMIT = 2000;

const choice = (value: string, key: MessageKey) => ({
  name: catalogs.fr[key],
  name_localizations: english(key),
  value,
});

type Standings = Extract<StandingsReply, { ok: true }>;

/** Each zone's colour, from the league's theme. */
const ZONE_COLORS: Record<StandingsZoneKind, keyof ImageTheme> = {
  champion: 'accent',
  promotion: 'win',
  barrage_promotion: 'barrage',
  barrage_relegation: 'barrage',
  relegation: 'loss',
};

async function renderTable(
  locale: Locale,
  standings: Standings,
  table: StandingsTable,
  assets: AssetStore,
): Promise<CommandFile> {
  const logos = await loadLogos(
    assets,
    table.rows.map((row) => row.team.logoKey),
  );
  const theme = resolveTheme(standings.theme);
  const shown = new Set(table.rows.map((row) => row.zone));
  const legend = STANDINGS_ZONE_KINDS.filter((kind) => shown.has(kind)).map((kind) => ({
    color: theme[ZONE_COLORS[kind]],
    label: t(locale, `standings.zone.${kind}`),
  }));
  const data = await renderStandingsPng({
    title: table.division,
    subtitle: t(locale, 'standings.subtitle', {
      competition: standings.competition,
      season: standings.season,
    }),
    headers: {
      rank: t(locale, 'standings.column.rank'),
      team: t(locale, 'standings.column.team'),
      played: t(locale, 'standings.column.played'),
      wins: t(locale, 'standings.column.wins'),
      losses: t(locale, 'standings.column.losses'),
      for: t(locale, 'standings.column.for'),
      against: t(locale, 'standings.column.against'),
      diff: t(locale, 'standings.column.diff'),
      points: t(locale, 'standings.column.points'),
      form: t(locale, 'standings.column.form'),
    },
    rows: table.rows.map((row) => ({
      ...row,
      name: row.team.name,
      colors: row.team.colors,
      logo: row.team.logoKey === null ? null : (logos.get(row.team.logoKey) ?? null),
      zoneColor: row.zone === null ? null : theme[ZONE_COLORS[row.zone]],
    })),
    legend,
    theme: standings.theme,
  });
  const slug = slugify(table.division);
  return { name: `standings-${slug.ok ? slug.slug : 'division'}.png`, data };
}

export const standingsCommand: Command = {
  data: {
    name: 'standings',
    ...described('command.standings.description'),
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: 'division',
        ...described('command.standings.option.division'),
        required: false,
      },
      {
        type: ApplicationCommandOptionType.String,
        name: 'format',
        ...described('command.standings.option.format'),
        required: false,
        choices: [
          choice('image', 'command.standings.option.format.image'),
          choice('text', 'command.standings.option.format.text'),
        ],
      },
    ],
  },
  async execute(interaction, context) {
    const { locale } = context;
    const standings = getStandings(context.db, {
      guildId: interaction.guildId,
      division: interaction.options.getString('division'),
    });

    // Refusals are private, so they are sent before any public deferral.
    if (!standings.ok) {
      const content =
        standings.error === 'unknown_division'
          ? t(locale, 'standings.unknownDivision', { divisions: standings.divisions.join(', ') })
          : t(locale, `standings.${standings.error}`);
      await interaction.reply({ content, ephemeral: true });
      return;
    }

    if (interaction.options.getString('format') !== 'text') {
      // Rendering can take longer than the 3 seconds Discord waits for a reply.
      await interaction.defer();
      const files = await Promise.all(
        standings.tables.map((table) => renderTable(locale, standings, table, context.assets)),
      );
      await interaction.reply({ content: '', ephemeral: false, files });
      return;
    }

    const content = standings.tables
      .map((table) => {
        const title = t(locale, 'standings.title', {
          competition: standings.competition,
          season: standings.season,
          division: table.division,
        });
        return `**${title}**\n\`\`\`\n${formatStandingsTable(locale, table)}\n\`\`\``;
      })
      .join('\n');
    if (content.length > MESSAGE_LIMIT) {
      const divisions = standings.tables.map((table) => table.division).join(', ');
      await interaction.reply({
        content: t(locale, 'standings.tooLong', { divisions }),
        ephemeral: true,
      });
      return;
    }
    await interaction.reply({ content, ephemeral: false });
  },
};
