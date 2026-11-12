// French is the reference catalog: every other language must define exactly these keys.
export const fr = {
  'command.ping.description': 'Vérifie que le bot répond.',
  'ping.reply': 'Pong ! Latence de la passerelle : {gatewayMs} ms.',
  'ping.replyNoLatency': 'Pong !',
  'command.standings.description': 'Affiche le classement de la saison en cours.',
  'command.standings.option.division':
    'Division, par exemple « Ligue 1 » ou « L1 ». Toutes par défaut.',
  'standings.title': '{competition} · {season} · {division}',
  'standings.column.rank': '#',
  'standings.column.team': 'Équipe',
  'standings.column.played': 'J',
  'standings.column.wins': 'V',
  'standings.column.losses': 'D',
  'standings.column.for': 'F',
  'standings.column.against': 'C',
  'standings.column.diff': 'Diff',
  'standings.column.points': 'PTS',
  'standings.not_linked': "Ce serveur n'est relié à aucune ligue.",
  'standings.no_season': "Aucune saison n'est en cours.",
  'standings.no_standings': "Le classement n'est pas encore disponible.",
  'standings.unknownDivision': 'Division inconnue. Divisions : {divisions}.',
  'standings.tooLong':
    'Le classement est trop long pour un seul message. Précise une division : {divisions}.',
  'error.unknownCommand': 'Commande inconnue.',
  'error.unexpected': 'Une erreur est survenue. Réessaie dans un instant.',
} as const;

export type MessageKey = keyof typeof fr;
