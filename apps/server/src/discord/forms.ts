import { reportFormHandlers } from './buttons/report.ts';
import { moveFormHandlers } from './buttons/move.ts';
import { requestFormHandlers } from './buttons/request.ts';
import type { FormHandler } from './commands/types.ts';

/** Every kind of form the bot opens and answers once sent. */
export const forms: readonly FormHandler[] = [
  ...moveFormHandlers,
  ...reportFormHandlers,
  ...requestFormHandlers,
];
