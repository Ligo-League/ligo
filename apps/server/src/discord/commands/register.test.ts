import { describe, expect, it } from 'vitest';
import { leagueDatabase, registrationDatabase, TEST_GUILD } from '../../testing.ts';
import { fakeContext, fakeInteraction } from '../testing.ts';
import { registerCommand } from './register.ts';

// `/register`: quick access from Discord to the registration form on the website (design doc
// section 3: the website is the main tool).

const run = async (guildId: string | null, db = registrationDatabase()) => {
  const interaction = fakeInteraction('register', { guildId });
  await registerCommand.execute(interaction, fakeContext({ db }));
  return interaction.replies;
};

describe('/register', () => {
  it('gives the link to the form, to the member alone', async () => {
    expect(await run(TEST_GUILD)).toEqual([
      {
        content:
          'Les inscriptions sont ouvertes pour LFR, Saison 4 : http://localhost:3000/mlb-group/lfr/register',
        ephemeral: true,
      },
    ]);
  });

  it('says when registration is closed, or the server linked to no league', async () => {
    expect(await run(TEST_GUILD, leagueDatabase())).toEqual([
      { content: 'Les inscriptions ne sont pas ouvertes pour LFR.', ephemeral: true },
    ]);
    expect(await run('999999999999999999')).toEqual([
      { content: "Ce serveur n'est relié à aucune ligue.", ephemeral: true },
    ]);
  });
});
