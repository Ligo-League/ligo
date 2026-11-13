import { ADDABLE_TEAM_ROLES, type AddableTeamRole } from '@ligo/core';
import type { SeasonTeam } from '@ligo/db';
import { ApplicationCommandOptionType, InteractionContextType } from 'discord.js';
import { catalogs, t, type Locale } from '../../i18n/index.ts';
import { recordQueuePost } from '../../services/queue-posts.ts';
import {
  listRequests,
  REQUEST_NOTE_MAX_LENGTH,
  submitTeamChange,
  teamChoices,
  teamOfficials,
  type FileReply,
  type RequestInput,
} from '../../services/requests.ts';
import type { TeamMember, TeamStaffReply } from '../../services/team-staff.ts';
import { buttonId } from '../button-id.ts';
import { discordTime } from '../match-text.ts';
import { appliedNotice, requestLine, requestQueueMessage, requestWhat } from '../request-text.ts';
import { described, english, MAX_CHOICE_LENGTH, MAX_CHOICES } from './describe.ts';
import type { Command, CommandContext, CommandInteraction, MessageButton } from './types.ts';

// `/team`: who acts for each team (design doc section 5, "Team requests"). League staff change a
// team directly; its owner and managers file requests, approved by staff or applied at once.

const teamOption = {
  type: ApplicationCommandOptionType.Integer as const,
  name: 'team',
  ...described('command.team.option.teamOptional'),
  required: false,
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
const noteOption = {
  type: ApplicationCommandOptionType.String as const,
  name: 'note',
  ...described('command.team.option.note'),
  required: false,
  max_length: REQUEST_NOTE_MAX_LENGTH,
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

type Refusal =
  | Extract<TeamStaffReply, { ok: false }>
  | Extract<FileReply, { ok: false }>
  | { ok: false; error: 'team_required' };

function refusal(locale: Locale, reply: Refusal): string {
  return reply.error === 'role_full'
    ? t(locale, 'team.error.role_full', { max: reply.max })
    : t(locale, `team.error.${reply.error}`);
}

const isAddableRole = (value: string | null): value is AddableTeamRole =>
  ADDABLE_TEAM_ROLES.some((role) => role === value);

/** The change asked for by a subcommand, or null for one the bot does not know. */
function inputOf(interaction: CommandInteraction, action: string): RequestInput | null {
  const { options } = interaction;
  const teamId = options.getInteger('team');
  const note = options.getString('note');
  const member = options.getUser('member');
  const role = options.getString('role');
  if (action === 'leave') return { kind: 'team_member_remove', member: null, teamId, note };
  if (!member) return null;
  if (action === 'owner') return { kind: 'team_owner', member, teamId, note };
  if (action === 'member remove') return { kind: 'team_member_remove', member, teamId, note };
  if (action === 'member add' && isAddableRole(role)) {
    return { kind: 'team_member_add', member, role, teamId, note };
  }
  return null;
}

/**
 * A request was filed: the team is told privately, then the staff queue gets the request to
 * decide, or a notice of a change that applied at once.
 */
async function announceFiled(
  interaction: CommandInteraction,
  reply: Extract<FileReply, { ok: true }>,
  context: CommandContext,
): Promise<void> {
  const { locale } = context;
  const { request } = reply;
  const what = requestWhat(locale, request);
  if (reply.applied) {
    await interaction.reply({
      content: `${t(locale, 'request.applied', { what })}\n${teamSummary(locale, reply.team, reply.members)}`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      content: t(locale, 'request.filed', {
        id: request.id,
        what,
        deadline: discordTime(request.deadline ?? request.requestedAt),
      }),
      ephemeral: true,
    });
  }
  if (!reply.queueChannelId) return;
  try {
    const message = reply.applied
      ? appliedNotice(locale, request)
      : requestQueueMessage(locale, request);
    const post = await context.gateway.postMessage(reply.queueChannelId, message);
    if (!reply.applied) {
      recordQueuePost(
        context.db,
        { entity: 'request', entityId: request.id },
        { channelId: reply.queueChannelId, messageId: post.messageId },
        context.now(),
      );
    }
  } catch {
    // The request is stored: `/team requests` lists it, and the reminder posts it again.
  }
  const removed = request.subject;
  if (reply.applied && request.kind === 'team_member_remove' && removed.discordUserId !== null) {
    if (removed.playerId === request.requester.playerId) return;
    try {
      await context.gateway.sendDirectMessage(removed.discordUserId, {
        content: t(locale, 'request.dm.removed', { team: request.team.name }),
      });
    } catch {
      // Closed direct messages are the member's choice; the change is made.
    }
  }
}

/** The requests waiting: every team's for league staff, with Withdraw buttons for a team's own. */
async function showRequests(interaction: CommandInteraction, context: CommandContext) {
  const { locale } = context;
  const reply = listRequests(context.db, interaction, interaction.options.getInteger('team'));
  if (!reply.ok) {
    await interaction.reply({ content: refusal(locale, reply), ephemeral: true });
    return;
  }
  if (reply.requests.length === 0) {
    await interaction.reply({ content: t(locale, 'request.list.empty'), ephemeral: true });
    return;
  }
  const now = context.now();
  // Discord holds 25 buttons per message; a list longer than that is unlikely for one team.
  const shown = reply.requests.slice(0, MAX_CHOICES);
  const lines = shown.map((request) => requestLine(locale, request, now));
  const buttons: MessageButton[] = reply.staff
    ? []
    : shown.map((request) => ({
        customId: buttonId('request-withdraw', request.id, 0),
        label: t(locale, 'request.button.withdraw', { id: request.id }),
        style: 'secondary',
      }));
  await interaction.reply({
    content: [t(locale, 'request.list.title'), ...lines].join('\n'),
    buttons,
    ephemeral: true,
  });
}

export const teamCommand: Command = {
  data: {
    name: 'team',
    ...described('command.team.description'),
    // Teams and league staff both use it; each service checks who may do what.
    contexts: [InteractionContextType.Guild],
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'owner',
        ...described('command.team.owner.description'),
        options: [memberOption, teamOption, noteOption],
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
            options: [memberOption, roleOption, teamOption, noteOption],
          },
          {
            type: ApplicationCommandOptionType.Subcommand,
            name: 'remove',
            ...described('command.team.member.remove.description'),
            options: [memberOption, teamOption, noteOption],
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'leave',
        ...described('command.team.leave.description'),
        options: [teamOption],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'list',
        ...described('command.team.list.description'),
        options: [teamOption],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'requests',
        ...described('command.team.requests.description'),
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

    if (action === 'list') {
      const reply = teamOfficials(db, interaction, interaction.options.getInteger('team'));
      await privately(
        reply.ok ? teamSummary(locale, reply.team, reply.members) : refusal(locale, reply),
      );
      return;
    }
    if (action === 'requests') {
      await showRequests(interaction, context);
      return;
    }

    const input = inputOf(interaction, action);
    if (!input) {
      await privately(t(locale, 'error.unknownCommand'));
      return;
    }
    const submitted = submitTeamChange(db, interaction, input, context.now());
    if (!submitted.reply.ok) {
      await privately(refusal(locale, submitted.reply));
    } else if (submitted.mode === 'request') {
      await announceFiled(interaction, submitted.reply, context);
    } else {
      await privately(teamSummary(locale, submitted.reply.team, submitted.reply.members));
    }
  },

  async autocomplete(interaction, context) {
    if (interaction.focused.name !== 'team') {
      await interaction.respond([]);
      return;
    }
    const teams = teamChoices(context.db, interaction, interaction.focused.value, MAX_CHOICES);
    await interaction.respond(
      teams.map((team) => ({
        name: `${team.name} (${team.tag}) · ${team.division}`.slice(0, MAX_CHOICE_LENGTH),
        value: team.teamId,
      })),
    );
  },
};
