import { proposalDays } from '../services/scheduling.ts';
import { MAX_CHOICES } from './commands/describe.ts';
import type { AutocompleteInteraction, CommandContext } from './commands/types.ts';
import { dayLabel } from './match-text.ts';

/**
 * Suggestions for a `date` option: the days left to play the match already chosen, or the next
 * two weeks, filtered by what was typed. The value is the date as `YYYY-MM-DD`.
 */
export async function suggestDays(
  interaction: AutocompleteInteraction,
  context: CommandContext,
): Promise<void> {
  const typed = interaction.focused.value.trim().toLowerCase();
  const days = proposalDays(
    context.db,
    interaction,
    interaction.options.getInteger('match'),
    context.now(),
  );
  await interaction.respond(
    days
      .map((day) => ({ name: dayLabel(context.locale, day.date), value: day.date }))
      .filter((day) => day.name.toLowerCase().includes(typed) || day.value.startsWith(typed))
      .slice(0, MAX_CHOICES),
  );
}
