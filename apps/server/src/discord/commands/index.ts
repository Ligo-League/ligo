import { matchCommand } from './match.ts';
import { pingCommand } from './ping.ts';
import { standingsCommand } from './standings.ts';
import type { Command } from './types.ts';

/** Every slash command the bot registers and answers. */
export const commands: readonly Command[] = [pingCommand, standingsCommand, matchCommand];
