import type { ButtonHandler } from '../commands/types.ts';
import { moveButtonHandlers } from './move.ts';
import { reportButtonHandlers } from './report.ts';
import { requestButtonHandlers } from './request.ts';
import { scheduleButtonHandlers } from './schedule.ts';

/** Every kind of button the bot puts under its messages and answers. */
export const buttons: readonly ButtonHandler[] = [
  ...moveButtonHandlers,
  ...reportButtonHandlers,
  ...requestButtonHandlers,
  ...scheduleButtonHandlers,
];
