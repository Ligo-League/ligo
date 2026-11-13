import { ADDABLE_TEAM_ROLES, type AddableTeamRole } from '@ligo/core';
import type { SeasonTeam } from '@ligo/db';
import { ApplicationCommandOptionType } from 'discord.js';
import { catalogs, t, type Locale } from '../../i18n/index.ts';
import {
  addTeamMember,
  removeTeamMember,
  searchTeams,
  setTeamOwner,
  showTeamStaff,
  type TeamMember,
  type TeamStaffReply,
} from '../../services/team-staff.ts';
import { described, english, MAX_CHOICE_LENGTH, MAX_CHOICES, STAFF_ONLY } from './describe.ts';
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
const roleOption = {
  type: ApplicationCommandOptionType.String as const,
  name: 'role',
  ...described('command.team.option.role'),
  required: true,
  choices: ADDABLE_TEAM_ROLES.map((role) => ({
    name: catalogs.fr[`team.role.${role}`],
    name_localizations: english(`team.role.${role}`),
    value: role,
  })),
};

// A mention shows the member's current name; nobody is notified (see `toDiscordMessage`).
const nameOf = (member: TeamMember) =>
  member.discordUserId ? `<@${member.discordUserId}>` : member.displayName;

/** "Alpha Esport (ALP) : propriétaire X ; managers Y, Z ; coach W." */
export function teamSummary(locale: Locale, team: SeasonTeam, members: TeamMember[]): string {
  const none = t(locale, 'team.none');
  const names = (role: TeamMember['role']) => {
    const holders = members.filter((member) => member.role === role).map(nameOf);
    return holders.length > 0 ? holders.join(', ') : none;
  };
  return t(locale, 'team.summary', {
    team: team.name,
    tag: team.tag,
    owner: names('owner'),
    managers: names('manager'),
    coach: names('coach'),
  });
}

function answer(locale: Locale, reply: TeamStaffReply): string {
  if (reply.ok) return teamSummary(locale, reply.team, reply.members);
  return reply.error === 'role_full'
    ? t(locale, 'team.error.role_full', { max: reply.max })
    : t(locale, `team.error.${reply.error}`);
}

const isAddableRole = (value: string | null): value is AddableTeamRole =>
  ADDABLE_TEAM_ROLES.some((role) => role === value);

export const teamCommand: Command = {
  data: {
    name: 'team',
    ...described('command.team.description'),
    ...STAFF_ONLY,
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'owner',
        ...described('command.team.owner.description'),
        options: [teamOption, memberOption],
      },
      {
        type: ApplicationCommandOptionType.SubcommandGroup,
        name: 'member',
        ...described('command.team.member.description'),
        options: [
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: 'add',
            ...described('command.team.member.add.description'),
            options: [teamOption, memberOption, roleOption],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: 'remove',
            ...described('command.team.member.remove.description'),
            options: [teamOption, memberOption],
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'list',
        ...described('command.team.list.description'),
        options: [teamOption],
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
    if (action === 'list') {
      await privately(answer(locale, showTeamStaff(db, interaction, teamId)));
      return;
    }

    const member = interaction.options.getUser('member');
    const role = interaction.options.getString('role');
    const now = context.now();
    let reply: TeamStaffReply | null = null;
    if (member && action === 'owner') {
      reply = setTeamOwner(db, interaction, { teamId, member }, now);
    } else if (member && action === 'member add' && isAddableRole(role)) {
      reply = addTeamMember(db, interaction, { teamId, member, role }, now);
    } else if (member && action === 'member remove') {
      reply = removeTeamMember(db, interaction, { teamId, member }, now);
    }
    await privately(reply ? answer(locale, reply) : t(locale, 'error.unknownCommand'));
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
