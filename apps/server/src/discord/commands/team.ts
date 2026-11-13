import type { SeasonTeam } from '@ligo/db';
import { ApplicationCommandOptionType } from 'discord.js';
import { t, type Locale } from '../../i18n/index.ts';
import {
  addTeamStaff,
  removeTeamStaff,
  searchTeams,
  setTeamManager,
  showTeamStaff,
  type TeamMember,
  type TeamStaffReply,
} from '../../services/team-staff.ts';
import { described, MAX_CHOICE_LENGTH, MAX_CHOICES, STAFF_ONLY } from './describe.ts';
import type { Command } from './types.ts';

const teamOption = {
  type: ApplicationCommandOptionType.Integer as const,
  name: 'team',
  ...described('command.team.option.team'),
  required: true,
  autocomplete: true,
};
const memberOption = {
  type: ApplicationCommandOptionType.User as const,
  name: 'member',
  ...described('command.team.option.member'),
  required: true,
};

// A mention shows the member's current name; nobody is notified (see `toDiscordMessage`).
const nameOf = (member: TeamMember) =>
  member.discordUserId ? `<@${member.discordUserId}>` : member.displayName;

/** "Alpha Esport (ALP) : manager X ; staff Y, Z." */
function summary(locale: Locale, team: SeasonTeam, members: TeamMember[]): string {
  const none = t(locale, 'team.none');
  const manager = members.find((member) => member.role === 'manager');
  const staff = members.filter((member) => member.role === 'staff');
  return t(locale, 'team.summary', {
    team: team.name,
    tag: team.tag,
    manager: manager ? nameOf(manager) : none,
    staff: staff.length > 0 ? staff.map(nameOf).join(', ') : none,
  });
}

function answer(locale: Locale, reply: TeamStaffReply): string {
  if (reply.ok) return summary(locale, reply.team, reply.members);
  return reply.error === 'staff_full'
    ? t(locale, 'team.error.staff_full', { max: reply.max })
    : t(locale, `team.error.${reply.error}`);
}

export const teamCommand: Command = {
  data: {
    name: 'team',
    ...described('command.team.description'),
    ...STAFF_ONLY,
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'manager',
        ...described('command.team.manager.description'),
        options: [teamOption, memberOption],
      },
      {
        type: ApplicationCommandOptionType.SubcommandGroup,
        name: 'staff',
        ...described('command.team.staff.description'),
        options: [
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: 'add',
            ...described('command.team.staff.add.description'),
            options: [teamOption, memberOption],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: 'remove',
            ...described('command.team.staff.remove.description'),
            options: [teamOption, memberOption],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: 'list',
            ...described('command.team.staff.list.description'),
            options: [teamOption],
          },
        ],
      },
    ],
  },

  async execute(interaction, context) {
    const { locale, db } = context;
    const privately = (content: string) => interaction.reply({ content, ephemeral: true });
    const action = [interaction.options.getSubcommandGroup(), interaction.options.getSubcommand()]
      .filter(Boolean)
      .join(' ');

    const teamId = interaction.options.getInteger('team');
    if (teamId === null) {
      // Free text typed instead of a suggestion never arrives as a number.
      await privately(t(locale, 'team.error.team_not_found'));
      return;
    }
    if (action === 'staff list') {
      await privately(answer(locale, showTeamStaff(db, interaction, teamId)));
      return;
    }

    const change = {
      manager: setTeamManager,
      'staff add': addTeamStaff,
      'staff remove': removeTeamStaff,
    }[action];
    const member = interaction.options.getUser('member');
    if (!change || !member) {
      await privately(t(locale, 'error.unknownCommand'));
      return;
    }
    await privately(answer(locale, change(db, interaction, { teamId, member }, context.now())));
  },

  async autocomplete(interaction, context) {
    if (interaction.focused.name !== 'team') {
      await interaction.respond([]);
      return;
    }
    const teams = searchTeams(context.db, interaction, interaction.focused.value, MAX_CHOICES);
    await interaction.respond(
      teams.map((team) => ({
        name: `${team.name} (${team.tag}) · ${team.division}`.slice(0, MAX_CHOICE_LENGTH),
        value: team.teamId,
      })),
    );
  },
};
