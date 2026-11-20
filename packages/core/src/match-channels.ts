import {
  CATEGORY_CAPACITY,
  categoryName,
  channelName,
  fillTemplate,
  numberedName,
} from './discord-names.ts';
import type {
  ChannelPermission,
  DesiredCategory,
  DesiredChannel,
  DesiredOverwrite,
} from './reconcile.ts';
import type { DiscordSettings } from './settings.ts';

// Match channels (design doc section 6, "Match channel lifecycle"; M-44). Which match channels a
// league's server should hold now, in which category, with which permissions. Pure: the server
// gathers the matches and hands the plan to the reconciler.

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * What the teams and staff may do in an open match channel. Add Reactions is left out: the bot is
 * not invited with it, and Discord refuses an overwrite granting what the bot does not hold.
 */
export const OPEN_PERMISSIONS = [
  'view_channel',
  'send_messages',
  'read_message_history',
  'attach_files',
  'embed_links',
] as const satisfies readonly ChannelPermission[];
/** What the teams keep once the channel is archived: reading, not writing. */
export const ARCHIVED_TEAM_PERMISSIONS = [
  'view_channel',
  'read_message_history',
] as const satisfies readonly ChannelPermission[];
/** The bot, which must see the channel it posts and pins the control message in. */
export const BOT_PERMISSIONS = [
  ...OPEN_PERMISSIONS,
  'pin_messages',
] as const satisfies readonly ChannelPermission[];

export const matchChannelKey = (matchId: number) => `match:${String(matchId)}`;

export interface ChannelMatch {
  id: number;
  /** `prefix` is the division's category prefix, `{division}` in the templates. */
  division: { id: number; prefix: string; staffRoleId: string | null };
  week: number;
  /** The start of its planned week. */
  windowStart: number;
  /** When its result counted (validated, forfeit or annulled); null while it has not. */
  countedAt: number | null;
  /** Staff opened its week before the usual day (`/week publish`). */
  openEarly: boolean;
  /** Each side's tag, and the key of its team role, or null when the team has none. */
  a: { tag: string; roleKey: string | null };
  b: { tag: string; roleKey: string | null };
}

export interface MatchChannelContext {
  settings: Pick<
    DiscordSettings,
    | 'open_days_before_week'
    | 'archive_hours_after_result'
    | 'channel_template'
    | 'category_template'
    | 'archive_category_template'
  >;
  /** The server's ID, which is its @everyone role's. */
  everyoneId: string;
  /** The league's staff role. */
  staffRoleId: string;
  /** The bot's own user ID; null leaves it out, when it is not known. */
  botUserId: string | null;
  /** The match channels Ligo already holds, by key. */
  existing: ReadonlySet<string>;
  now: number;
}

export interface MatchChannelPlan {
  categories: DesiredCategory[];
  channels: DesiredChannel[];
}

type State = 'closed' | 'open' | 'archived';

function stateOf(found: ChannelMatch, context: MatchChannelContext): State {
  const { settings, now } = context;
  if (
    found.countedAt !== null &&
    now >= found.countedAt + settings.archive_hours_after_result * HOUR_MS
  ) {
    // An archive is kept only for a channel that was opened: old results get no new channel.
    return context.existing.has(matchChannelKey(found.id)) ? 'archived' : 'closed';
  }
  const opensAt = found.windowStart - settings.open_days_before_week * DAY_MS;
  return found.openEarly || now >= opensAt ? 'open' : 'closed';
}

/**
 * The position of each match among its group, by match ID: a category's `index` follows, so a
 * channel keeps its category while others come and go (`packIntoCategories` in reverse).
 */
function indexes(matches: readonly ChannelMatch[], group: (found: ChannelMatch) => string) {
  const byGroup = new Map<string, number[]>();
  for (const found of matches) {
    const key = group(found);
    const ids = byGroup.get(key) ?? [];
    ids.push(found.id);
    byGroup.set(key, ids);
  }
  const index = new Map<number, number>();
  for (const ids of byGroup.values()) {
    ids.sort((x, y) => x - y);
    ids.forEach((id, position) => index.set(id, Math.floor(position / CATEGORY_CAPACITY) + 1));
  }
  return index;
}

/** The match channels and their categories the server should hold now. */
export function matchChannelPlan(
  matches: readonly ChannelMatch[],
  context: MatchChannelContext,
): MatchChannelPlan {
  const { settings } = context;
  const perWeek = settings.category_template.includes('{week}');
  const weekGroup = (found: ChannelMatch) =>
    perWeek ? `${String(found.division.id)}:${String(found.week)}` : String(found.division.id);
  const openIndex = indexes(matches, weekGroup);
  const archiveIndex = indexes(matches, (found) => String(found.division.id));

  const categories = new Map<string, DesiredCategory & { order: number[] }>();
  const channels: DesiredChannel[] = [];
  for (const found of [...matches].sort((x, y) => x.id - y.id)) {
    const state = stateOf(found, context);
    if (state === 'closed') continue;
    const values = {
      week: found.week,
      division: found.division.prefix,
      tagA: found.a.tag,
      tagB: found.b.tag,
    };
    let parent: DesiredCategory;
    if (state === 'open') {
      const index = openIndex.get(found.id) ?? 1;
      parent = {
        kind: 'week_category',
        key: perWeek
          ? `division:${String(found.division.id)}:week:${String(found.week)}:${String(index)}`
          : `division:${String(found.division.id)}:${String(index)}`,
        name: numberedName(categoryName(fillTemplate(settings.category_template, values)), index),
      };
      const order = [0, found.division.id, perWeek ? found.week : 0, index];
      categories.set(`${parent.kind}:${parent.key}`, { ...parent, order });
    } else {
      const index = archiveIndex.get(found.id) ?? 1;
      parent = {
        kind: 'archive_category',
        key: `division:${String(found.division.id)}:${String(index)}`,
        name: numberedName(
          categoryName(fillTemplate(settings.archive_category_template, values)),
          index,
        ),
      };
      categories.set(`${parent.kind}:${parent.key}`, {
        ...parent,
        order: [1, found.division.id, 0, index],
      });
    }

    const team = (roleKey: string | null): DesiredOverwrite[] =>
      roleKey === null
        ? []
        : [
            state === 'open'
              ? { target: { role: { key: roleKey } }, allow: OPEN_PERMISSIONS, deny: [] }
              : {
                  target: { role: { key: roleKey } },
                  allow: ARCHIVED_TEAM_PERMISSIONS,
                  deny: ['send_messages'],
                },
          ];
    const staff = (id: string | null): DesiredOverwrite[] =>
      id === null ? [] : [{ target: { role: { id } }, allow: OPEN_PERMISSIONS, deny: [] }];
    channels.push({
      kind: 'match_channel',
      key: matchChannelKey(found.id),
      name: channelName(fillTemplate(settings.channel_template, values)),
      parent: { kind: parent.kind, key: parent.key },
      overwrites: [
        { target: { role: { id: context.everyoneId } }, allow: [], deny: ['view_channel'] },
        ...team(found.a.roleKey),
        ...team(found.b.roleKey === found.a.roleKey ? null : found.b.roleKey),
        ...staff(context.staffRoleId),
        ...staff(
          found.division.staffRoleId === context.staffRoleId ? null : found.division.staffRoleId,
        ),
        ...(context.botUserId === null
          ? []
          : [{ target: { member: context.botUserId }, allow: BOT_PERMISSIONS, deny: [] }]),
      ],
    });
  }

  const ordered = [...categories.values()].sort((x, y) => {
    for (let position = 0; position < x.order.length; position += 1) {
      const difference = (x.order[position] ?? 0) - (y.order[position] ?? 0);
      if (difference !== 0) return difference;
    }
    return 0;
  });
  return {
    categories: ordered.map(({ kind, key, name }) => ({ kind, key, name })),
    channels,
  };
}
