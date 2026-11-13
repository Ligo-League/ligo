import type { ButtonHandler } from '../commands/types.ts';
import { reportButtonHandlers } from './report.ts';
import { scheduleButtonHandlers } from './schedule.ts';

/** Every kind of button the bot puts under its messages and answers. */
export const buttons: readonly ButtonHandler[] = [
  ...reportButtonHandlers,
  ...scheduleButtonHandlers,
];
