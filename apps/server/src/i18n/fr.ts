// French is the reference catalog: every other language must define exactly these keys.
export const fr = {
  'command.ping.description': 'Vérifie que le bot répond.',
  'ping.reply': 'Pong ! Latence de la passerelle : {gatewayMs} ms.',
  'ping.replyNoLatency': 'Pong !',
  'command.standings.description': 'Affiche le classement de la saison en cours.',
  'command.standings.option.division':
    'Division, par exemple « Ligue 1 » ou « L1 ». Toutes par défaut.',
  'command.standings.option.format': 'Image (par défaut) ou tableau en texte.',
  'command.standings.option.format.image': 'Image',
  'command.standings.option.format.text': 'Texte',
  'standings.title': '{competition} · {season} · {division}',
  'standings.subtitle': '{competition} · {season}',
  'standings.column.form': 'Forme',
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
  'command.match.description': 'Gestion des matchs, réservée au staff.',
  'command.match.result.description': "Enregistre ou corrige le résultat d'un match.",
  'command.match.result.option.match':
    'Le match : tape une équipe, une division ou une semaine (s3), puis choisis dans la liste.',
  'command.match.result.option.scoreA': 'Manches gagnées par la première équipe citée.',
  'command.match.result.option.scoreB': 'Manches gagnées par la seconde équipe citée.',
  'command.match.result.option.screenshot':
    "Capture d'écran du tableau des scores (facultative pour le staff).",
  'match.label': '{division} · S{week} · {teamA} – {teamB}',
  'match.labelWithResult': '{division} · S{week} · {teamA} {scoreA}–{scoreB} {teamB}',
  'match.result.recorded':
    'Résultat enregistré : {division}, semaine {week}, {teamA} {scoreA}–{scoreB} {teamB}.',
  'match.result.corrected':
    'Résultat corrigé : {division}, semaine {week}, {teamA} {scoreA}–{scoreB} {teamB} (avant : {previousA}–{previousB}).',
  'match.error.not_linked': "Ce serveur n'est relié à aucune ligue.",
  'match.error.not_staff': 'Cette commande est réservée au staff de la ligue.',
  'match.error.match_not_found':
    'Match introuvable dans cette ligue. Choisis-le dans la liste proposée.',
  'match.error.match_closed':
    'Ce match est un forfait ou a été annulé : son résultat ne se modifie pas ici.',
  'match.error.unsupported_series':
    'Ce match se joue en plusieurs cartes ; la saisie carte par carte arrive plus tard.',
  'match.error.invalid_score':
    "Score invalide : deux nombres entiers différents, il n'y a pas de match nul.",
  'match.error.invalid_screenshot':
    'La capture doit être une image PNG, JPEG ou WebP de moins de 20 Mo, jointe à la commande.',
  'error.unknownCommand': 'Commande inconnue.',
  'error.unexpected': 'Une erreur est survenue. Réessaie dans un instant.',
} as const;

export type MessageKey = keyof typeof fr;
