import type { VetoTeam } from '@ligo/core';
import { t, type Locale } from '../i18n/index.ts';
import { setVetoMessage, type StartVetoReply, type VetoView } from '../services/veto.ts';
import { buttonId } from './button-id.ts';
import type { CommandContext, MessageButton, OutgoingMessage } from './commands/types.ts';
import { discordTime, matchFixture, mention } from './match-text.ts';

// The veto message: who picks what, the steps so far, and the buttons of the current turn. It is
// rebuilt from the stored veto after every step, by a click or by the clock.

/** The custom ID of a veto button: the match, the step it belongs to, the choice's place. */
export const vetoButtonId = (matchId: number, step: number, index: number) =>
  buttonId('veto', matchId, `${step}x${index}`);

/** The step and choice a veto button carries, or null for a malformed one. */
export function readVetoNonce(nonce: string): { step: number; index: number } | null {
  const match = /^(\d{1,4})x(\d{1,2})$/.exec(nonce);
  return match ? { step: Number(match[1]), index: Number(match[2]) } : null;
}

export const sideLabel = (locale: Locale, side: string) =>
  side === 'attack' ? t(locale, 'veto.side.attack') : t(locale, 'veto.side.defense');

/** The name of the veto's team A or B. */
export function vetoTeamName(
  view: Pick<VetoView, 'match' | 'teamA'>,
  team: VetoTeam | null,
): string {
  const side = team === 'A' ? view.teamA : view.teamA === 'a' ? 'b' : 'a';
  return view.match[side].name;
}

/** A choice of the current step as a team reads it: a map, a side, or a decision. */
export function vetoChoiceLabel(locale: Locale, view: VetoView, choice: string): string {
  const { state } = view;
  if (state.status === 'done') return choice;
  if (state.action === 'side' || state.action === 'ot_side') return sideLabel(locale, choice);
  if (choice === 'side_selection' || choice === 'first_ban') {
    return t(locale, `veto.choice.${choice}`);
  }
  if (state.action === 'first_ban' && (choice === 'A' || choice === 'B')) {
    return t(locale, 'veto.choice.bansFirst', { team: vetoTeamName(view, choice) });
  }
  return choice;
}

export function vetoMessage(locale: Locale, view: VetoView): OutgoingMessage {
  const { match, state } = view;
  const teamName = (team: VetoTeam | null) => vetoTeamName(view, team);
  const lines = [
    t(locale, 'veto.title', { fixture: matchFixture(locale, match), bestOf: match.bestOf }),
  ];
  if (view.byCoin || view.host === null) {
    lines.push(t(locale, 'veto.coin', { winner: teamName('A') }));
  } else {
    lines.push(
      t(locale, 'veto.roles', {
        chooser: teamName('A'),
        other: teamName('B'),
        host: match[view.host].name,
      }),
    );
  }
  // The decisions after the coin toss (BLAST 5.1.3.2, O-11).
  for (const step of view.steps) {
    const late = step.timedOut ? t(locale, 'veto.timedOut') : '';
    if (
      step.action === 'toss_choice' &&
      (step.choice === 'side_selection' || step.choice === 'first_ban')
    ) {
      lines.push(t(locale, `veto.tossChoice.${step.choice}`, { team: teamName(step.team) }) + late);
    } else if (step.action === 'first_ban' && (step.choice === 'A' || step.choice === 'B')) {
      lines.push(t(locale, 'veto.firstBan', { team: teamName(step.choice) }) + late);
    }
  }

  const bans = view.steps
    .filter((step) => step.action === 'ban')
    .map((step) =>
      t(locale, step.timedOut ? 'veto.ban.timedOut' : 'veto.ban', {
        map: step.map ?? '?',
        team: teamName(step.team),
      }),
    );
  if (bans.length > 0) lines.push(t(locale, 'veto.bans', { list: bans.join(', ') }));

  for (const step of view.steps) {
    if (step.action !== 'pick' && step.action !== 'decider') continue;
    const game = { n: step.game ?? 1, map: step.map ?? '?', team: teamName(step.team) };
    const key = step.action === 'decider' ? 'veto.game.decider' : 'veto.game.picked';
    const line = [match.bestOf === 1 ? t(locale, 'veto.game', game) : t(locale, key, game)];
    const toss = view.steps.find((s) => s.action === 'toss' && s.game === step.game);
    if (toss) line.push(t(locale, 'veto.deciderToss', { team: teamName(toss.team) }));
    const side = view.steps.find((s) => s.action === 'side' && s.game === step.game);
    const otSide = view.steps.find((s) => s.action === 'ot_side' && s.game === step.game);
    if (side?.side && otSide?.side) {
      line.push(
        t(locale, 'veto.sides', {
          team: teamName(side.team),
          side: sideLabel(locale, side.side),
          otTeam: teamName(otSide.team),
          otSide: sideLabel(locale, otSide.side),
        }),
      );
    } else if (side?.side) {
      line.push(
        t(locale, 'veto.sides.start', {
          team: teamName(side.team),
          side: sideLabel(locale, side.side),
        }),
      );
    } else if (step.action === 'decider' && state.status === 'done') {
      line.push(t(locale, 'veto.sides.later'));
    }
    lines.push(line.join(' — '));
  }

  if (state.status === 'done') {
    lines.push(t(locale, 'veto.done'));
    return { content: lines.join('\n'), buttons: [] };
  }
  lines.push(
    t(locale, `veto.turn.${state.action}`, {
      team: teamName(state.team),
      map: state.map ?? '?',
      deadline: view.deadline === null ? '' : discordTime(view.deadline, 'R'),
    }),
    t(locale, 'veto.timeoutRule'),
  );
  const isSide = state.action === 'side' || state.action === 'ot_side';
  const isDecision = state.action === 'toss_choice' || state.action === 'first_ban';
  const style: MessageButton['style'] =
    isSide || isDecision ? 'primary' : state.action === 'ban' ? 'danger' : 'success';
  const buttons = state.choices.map((choice, index): MessageButton => ({
    customId: vetoButtonId(match.id, state.step, index),
    label: vetoChoiceLabel(locale, view, choice),
    style,
  }));
  return { content: lines.join('\n'), buttons };
}

type Poster = Pick<CommandContext, 'db' | 'gateway' | 'locale'>;
type Started = Extract<StartVetoReply, { ok: true }>;

/** The veto's first message, mentioning both sides' officials and captains. */
export function vetoStartMessage(locale: Locale, reply: Started): OutgoingMessage {
  const message = vetoMessage(locale, reply.view);
  return {
    ...message,
    content: [message.content, reply.mentionUserIds.map(mention).join(' ')]
      .filter(Boolean)
      .join('\n'),
    mentionUserIds: reply.mentionUserIds,
  };
}

/**
 * Posts the veto in a channel and keeps where, so that later steps, the clock and the website
 * edit it; false when Discord refused it. The same wherever the veto was started (M-32).
 */
export async function postVeto(
  context: Poster,
  channelId: string,
  reply: Started,
): Promise<boolean> {
  try {
    const posted = await context.gateway.postMessage(
      channelId,
      vetoStartMessage(context.locale, reply),
    );
    setVetoMessage(context.db, reply.view.match.id, { channelId, messageId: posted.messageId });
    return true;
  } catch {
    return false;
  }
}

/** Shows a step taken elsewhere (on the website) on the veto's Discord message, if it has one. */
export async function refreshVeto(context: Poster, view: VetoView): Promise<void> {
  if (view.channelId === null || view.messageId === null) return;
  try {
    await context.gateway.editMessage(
      view.channelId,
      view.messageId,
      vetoMessage(context.locale, view),
    );
  } catch {
    // The step is stored; the next click or tick shows it.
  }
}
