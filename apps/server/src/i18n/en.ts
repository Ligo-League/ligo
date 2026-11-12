import type { MessageKey } from './fr.ts';

export const en: Record<MessageKey, string> = {
  'command.ping.description': 'Check that the bot is responding.',
  'ping.reply': 'Pong! Gateway latency: {gatewayMs} ms.',
  'ping.replyNoLatency': 'Pong!',
  'error.unknownCommand': 'Unknown command.',
  'error.unexpected': 'Something went wrong. Please try again in a moment.',
};
