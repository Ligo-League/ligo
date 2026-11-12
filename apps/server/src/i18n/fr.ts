// French is the reference catalog: every other language must define exactly these keys.
export const fr = {
  'command.ping.description': 'Vérifie que le bot répond.',
  'ping.reply': 'Pong ! Latence de la passerelle : {gatewayMs} ms.',
  'ping.replyNoLatency': 'Pong !',
  'error.unknownCommand': 'Commande inconnue.',
  'error.unexpected': 'Une erreur est survenue. Réessaie dans un instant.',
} as const;

export type MessageKey = keyof typeof fr;
