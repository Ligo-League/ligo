import { REST, Routes } from 'discord.js';
import { loadConfig } from '../config.ts';
import { commands } from './commands/index.ts';
import { inviteUrl } from './permissions.ts';

// `pnpm discord:register`: replaces the slash commands of ONE guild (the staging server) with
// the current list. Guild commands update instantly; global registration comes with production.
const loaded = loadConfig(process.env);
if (!loaded.ok) {
  console.error(`Invalid configuration: ${loaded.errors.join('; ')}. See .env.example.`);
  process.exit(1);
}
const { discordToken, discordClientId, discordGuildId } = loaded.config;

const rest = new REST().setToken(discordToken);
try {
  await rest.put(Routes.applicationGuildCommands(discordClientId, discordGuildId), {
    body: commands.map((command) => command.data),
  });
  const names = commands.map((command) => `/${command.data.name}`).join(', ');
  console.log(`Registered ${commands.length} command(s) in guild ${discordGuildId}: ${names}`);
  console.log(`Invite URL: ${inviteUrl(discordClientId)}`);
} catch (error) {
  // Only the message: the error object can carry request details.
  const reason = error instanceof Error ? error.message : 'unknown error';
  console.error(`Could not register commands: ${reason}`);
  console.error(
    'Check DISCORD_TOKEN, DISCORD_CLIENT_ID and DISCORD_GUILD_ID, and that the bot was invited with the applications.commands scope (docs/setup.md).',
  );
  process.exit(1);
}
