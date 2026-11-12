import { pingCommand } from './ping.ts';
import type { Command } from './types.ts';

/** Every slash command the bot registers and answers. */
export const commands: readonly Command[] = [pingCommand];
