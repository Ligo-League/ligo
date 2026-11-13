import { reportFormHandlers } from './buttons/report.ts';
import type { FormHandler } from './commands/types.ts';

/** Every kind of form the bot opens and answers once sent. */
export const forms: readonly FormHandler[] = [...reportFormHandlers];
