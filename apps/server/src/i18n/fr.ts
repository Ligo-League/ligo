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
  'standings.column.played': 'Joués',
  'standings.column.playedShort': 'MJ',
  'standings.column.wins': 'W',
  'standings.column.losses': 'L',
  'standings.column.for': 'RW',
  'standings.column.against': 'RL',
  'standings.column.diff': 'Diff',
  'standings.column.points': 'PTS',
  'standings.not_linked': "Ce serveur n'est relié à aucune ligue.",
  'standings.no_season': "Aucune saison n'est en cours.",
  'standings.no_standings': "Le classement n'est pas encore disponible.",
  'standings.unknownDivision': 'Division inconnue. Divisions : {divisions}.',
  'standings.tooLong':
    'Le classement est trop long pour un seul message. Précise une division : {divisions}.',
  'command.match.description': 'Les matchs de ton équipe.',
  'command.match.report.description':
    "Signale le résultat d'un match de ton équipe, avec la capture d'écran.",
  'command.match.report.option.match': 'Le match : choisis-le dans la liste.',
  'command.match.report.option.screenshot': "Capture d'écran du tableau des scores.",
  'command.staff.description': 'Actions réservées au staff de la ligue.',
  'command.staff.match.description': 'Résultats et matchs.',
  'command.staff.match.validate.description': 'Valide un résultat signalé par une équipe.',
  'command.staff.match.void.description': 'Annule un match, avec un motif.',
  'command.staff.match.void.option.reason': 'Le motif, conservé dans le journal.',
  'command.staff.match.forfeit.description': "Enregistre le forfait d'une équipe sur un match.",
  'command.staff.match.forfeit.option.team': "L'équipe qui déclare forfait.",
  'command.staff.match.forfeit.side.a': 'La première équipe citée',
  'command.staff.match.forfeit.side.b': 'La seconde équipe citée',
  'command.staff.sanction.description': 'Sanctions.',
  'command.staff.sanction.add.description': 'Donne une sanction à une équipe.',
  'command.staff.sanction.list.description': "Affiche les sanctions d'une équipe cette saison.",
  'command.staff.sanction.option.kind': 'Le type de sanction.',
  'command.staff.sanction.option.reason': 'Le motif de la sanction.',
  'command.staff.sanction.option.points':
    'Points à ajouter au classement : un nombre négatif en retire (par exemple -1).',
  'command.staff.match.result.description': "Enregistre ou corrige le résultat d'un match.",
  'command.staff.match.option.match':
    'Le match : tape une équipe, une division ou une semaine (s3), puis choisis dans la liste.',
  'command.match.option.scoreA': 'Manches gagnées par la première équipe citée.',
  'command.match.option.scoreB': 'Manches gagnées par la seconde équipe citée.',
  'command.staff.match.result.option.screenshot':
    "Capture d'écran du tableau des scores (facultative pour le staff).",
  'match.label': '{division} · S{week} · {teamA} – {teamB}',
  'match.labelWithResult': '{division} · S{week} · {teamA} {scoreA}–{scoreB} {teamB}',
  'match.result.recorded':
    'Résultat enregistré : {division}, semaine {week}, {teamA} {scoreA}–{scoreB} {teamB}.',
  'match.result.corrected':
    'Résultat corrigé : {division}, semaine {week}, {teamA} {scoreA}–{scoreB} {teamB} (avant : {previousA}–{previousB}).',
  'match.line': '{division}, semaine {week} : {teamA} {scoreA}–{scoreB} {teamB}',
  'match.fixture': '{division}, semaine {week} : {teamA} – {teamB}',
  'report.posted':
    '{reporter} signale pour {team} : **{line}**. {opponents}, confirmez ou contestez ce résultat.',
  'report.postedNoOpponent':
    "{reporter} signale pour {team} : **{line}**. L'équipe adverse n'a pas encore de manager enregistré : le staff validera.",
  'report.notQueued': "Le staff n'a pas pu être prévenu automatiquement : merci de le prévenir.",
  'report.button.confirm': 'Confirmer',
  'report.button.dispute': 'Contester',
  'report.button.validate': 'Valider',
  'report.button.reject': 'Refuser',
  'report.confirmed': '**{line}** — confirmé par {member}. En attente de validation par le staff.',
  'report.validated': '**{line}** — confirmé par {member}. Résultat validé.',
  'report.disputed': '**{line}** — contesté par {member}. Le staff va trancher.',
  'queue.report': 'Résultat à valider — **{line}**. Signalé par {reporter} pour {team}.',
  'queue.confirmed': "{line} — confirmé par l'équipe adverse ({member}).",
  'queue.disputed': '{line} — contesté par {member}. Une décision du staff est attendue.',
  'queue.validated': '**{line}** — validé par {member}.',
  'queue.rejected': '**{line}** — refusé par {member}. Le match est à signaler de nouveau.',
  'result.announce': 'Résultat validé — {line}.',
  'result.announceCorrected': 'Résultat corrigé — {line} (au lieu de {previousA}–{previousB}).',
  'result.announceForfeit': 'Forfait — {fixture}. {team} déclare forfait.',
  'staff.match.validated': 'Résultat validé : {line}.',
  'staff.match.voided': 'Match annulé : {fixture}.',
  'staff.match.forfeit':
    'Forfait enregistré : {fixture}. {team} déclare forfait ({count} cette saison).',
  'staff.match.forfeit.warning': 'Un avertissement a été ajouté automatiquement à {team}.',
  'staff.match.forfeit.exclusion':
    "{team} atteint le seuil d'exclusion avec {count} forfaits. L'exclusion reste une décision du staff.",
  'queue.exclusion':
    "{team} atteint le seuil d'exclusion avec {count} forfaits ({fixture}). Une décision du staff est attendue.",
  'sanction.reason.forfeits': 'Avertissement automatique : {count} forfaits cette saison.',
  'sanction.kind.warning': 'Avertissement',
  'sanction.kind.points': 'Points au classement',
  'sanction.kindPoints': '{points} point(s) au classement',
  'sanction.line': '{date} — {kind} — {reason}',
  'sanction.added': 'Sanction enregistrée pour {team} : {sanction}',
  'sanction.list.title': 'Sanctions de {team} cette saison :',
  'sanction.list.none': 'Aucune sanction pour {team} cette saison.',
  'sanction.error.not_linked': "Ce serveur n'est relié à aucune ligue.",
  'sanction.error.not_staff': 'Cette commande est réservée au staff de la ligue.',
  'sanction.error.no_season': "Aucune saison n'est en cours.",
  'sanction.error.team_not_found':
    'Équipe introuvable dans la saison en cours. Choisis-la dans la liste proposée.',
  'sanction.error.reason_required': 'Un motif est nécessaire.',
  'sanction.error.points_required':
    'Indique un nombre de points non nul, entre -100 et 100 (négatif pour en retirer).',
  'sanction.error.points_not_allowed': 'Un avertissement ne porte pas de points.',
  'match.error.no_team': 'Tu ne gères aucune équipe. Le staff peut te nommer avec /team manager.',
  'match.error.no_season': "Cette ligue n'a pas de saison en cours.",
  'report.hint.nothingLeft': 'Aucun match à signaler : ceux de tes équipes ont déjà un résultat.',
  'report.hint.noMatch': 'Aucun de tes matchs à signaler ne correspond à « {query} ».',
  'dispute.form.title': 'Contester le résultat',
  'dispute.form.reason': 'Motif',
  'dispute.form.details': 'Détails',
  'dispute.form.detailsHint':
    'Obligatoires pour « Autre ». Lus par le staff de la ligue seulement.',
  'dispute.reason.other': 'Autre',
  'queue.disputedWithReason':
    '{line} — contesté par {member}. Motif : **{reason}**. Une décision du staff est attendue.',
  'match.error.reason_unknown':
    "Ce motif n'est pas proposé par la ligue. Clique de nouveau sur Contester.",
  'match.error.details_required':
    'Pour « Autre », explique le problème dans les détails. Clique de nouveau sur Contester.',
  'match.error.details_too_long':
    'Les détails dépassent {max} caractères. Clique de nouveau sur Contester.',
  'match.error.not_linked': "Ce serveur n'est relié à aucune ligue.",
  'match.error.not_your_match': "Tu n'es ni manager ni staff d'une des deux équipes de ce match.",
  'match.error.not_reportable': 'Ce match a déjà un résultat signalé ou validé.',
  'match.error.screenshot_required': "La capture d'écran du tableau des scores est obligatoire.",
  'match.error.screenshot_unreadable': "Je n'ai pas pu récupérer la capture. Réessaie.",
  'match.error.queue_not_set':
    "La ligue n'a pas encore choisi son salon de validation. Préviens le staff.",
  'match.error.stale': 'Ce bouton correspond à un ancien signalement.',
  'match.error.not_opponent': "Seule l'équipe adverse peut confirmer ou contester ce résultat.",
  'match.error.wrong_status': "Ce match n'attend pas cette action : il a déjà été traité.",
  'match.error.reason_required': 'Un motif est nécessaire.',
  'match.error.not_staff': 'Cette commande est réservée au staff de la ligue.',
  'match.error.match_not_found':
    'Match introuvable dans cette ligue. Choisis-le dans la liste proposée.',
  'match.error.match_closed':
    'Ce match est un forfait ou a été annulé : son résultat ne se modifie pas ici.',
  'match.error.unsupported_series':
    'Ce match se joue en plusieurs cartes ; la saisie carte par carte arrive plus tard.',
  'match.error.invalid_score':
    "Score invalide : deux nombres entiers différents, il n'y a pas de match nul.",
  'match.error.impossible_score':
    'Score impossible avec le règlement de la ligue : une carte se termine entre {widest} et {closest}, ou en prolongation ({overtime}).',
  'match.error.invalid_screenshot':
    'La capture doit être une image PNG, JPEG ou WebP de moins de 20 Mo, jointe à la commande.',
  'command.team.description': 'Managers et staff des équipes, réservé au staff de la ligue.',
  'command.team.manager.description': "Désigne le manager d'une équipe.",
  'command.team.staff.description': "Staff d'une équipe.",
  'command.team.staff.add.description': "Ajoute un membre au staff d'une équipe.",
  'command.team.staff.remove.description': "Retire un membre (staff ou manager) d'une équipe.",
  'command.team.staff.list.description': "Affiche le manager et le staff d'une équipe.",
  'command.team.option.team': "L'équipe : tape son nom ou son tag, puis choisis dans la liste.",
  'command.team.option.member': 'Le membre Discord concerné.',
  'team.summary': '{team} ({tag}) : manager {manager} ; staff {staff}.',
  'team.none': 'aucun',
  'team.error.not_linked': "Ce serveur n'est relié à aucune ligue.",
  'team.error.not_staff': 'Cette commande est réservée au staff de la ligue.',
  'team.error.no_season': "Aucune saison n'est en cours.",
  'team.error.team_not_found':
    'Équipe introuvable dans la saison en cours. Choisis-la dans la liste proposée.',
  'team.error.already_on_team': 'Ce membre a déjà ce rôle dans cette équipe.',
  'team.error.not_on_team': "Ce membre n'est ni manager ni staff de cette équipe.",
  'team.error.staff_full':
    'Cette équipe a déjà {max} membres de staff, le maximum prévu par la ligue.',
  'command.league.description': 'Réglages de la ligue sur ce serveur, réservés au staff.',
  'command.league.channel.description': 'Choisit le salon que le bot utilise pour un usage.',
  'command.league.channel.option.kind': 'À quoi sert le salon.',
  'command.league.channel.option.channel': 'Le salon textuel à utiliser.',
  'league.channel.kind.staff_queue': 'File de validation du staff',
  'league.channel.kind.results': 'Résultats validés',
  'league.channel.notice.staff_queue':
    'Les résultats signalés par les équipes arriveront ici pour être validés par le staff.',
  'league.channel.notice.results': 'Les résultats validés seront annoncés ici.',
  'league.channel.set': 'Salon enregistré : {kind} dans <#{channel}>.',
  'command.league.channel.option.division':
    'Pour les résultats : une division seulement. Sans elle, toute la ligue.',
  'command.league.channels.description': 'Affiche les salons que le bot utilise.',
  'league.channel.notice.resultsDivision':
    'Les résultats validés de {division} seront annoncés ici.',
  'league.channel.setDivision': 'Salon enregistré : {kind} de {division} dans <#{channel}>.',
  'league.channel.cleared':
    "{division} n'a plus son propre salon : ses résultats seront annoncés dans celui de la ligue.",
  'league.channels.title': '**Salons du bot**',
  'league.channels.unset': 'non choisi',
  'league.channels.inherited': 'celui de la ligue',
  'league.channels.division': '• {division} : {channel}',
  'league.error.channel_required': 'Choisis le salon à utiliser.',
  'league.error.division_not_found': 'Division inconnue. Choisis-la dans la liste proposée.',
  'league.error.queue_per_division':
    'Seul le salon des résultats peut être propre à une division : choisis celui-ci sans division.',
  'command.match.proposeTime.description': "Propose un horaire de match à l'équipe adverse.",
  'command.match.option.date': 'Le jour : choisis-le dans la liste ou tape AAAA-MM-JJ.',
  'command.match.option.time': "L'heure, par exemple 21:00, à l'heure de la ligue.",
  'command.staff.match.schedule.description':
    "Fixe l'horaire d'un match, sans contrainte de semaine.",
  'schedule.proposed':
    '{proposer} propose pour {team} : **{fixture}** le {when}. {opponents}, acceptez ou refusez.',
  'schedule.proposedNoOpponent':
    "{proposer} propose pour {team} : **{fixture}** le {when}. L'équipe adverse n'a ni manager ni staff : le staff de la ligue peut fixer l'horaire.",
  'schedule.button.accept': 'Accepter',
  'schedule.button.decline': 'Refuser',
  'schedule.accepted': '**{fixture}** — le {when}, accepté par {member}.',
  'schedule.declined':
    '**{fixture}** — le {when}, refusé par {member}. Proposez un autre horaire avec /match propose-time.',
  'schedule.announce': 'Horaire fixé — {fixture} : {when}.',
  'schedule.autoSlot':
    "Prolongation — **{fixture}** : aucun horaire convenu pendant la semaine. Le match est fixé au {when}. Vous pouvez encore convenir d'un autre horaire jusqu'au {deadline} avec /match propose-time. {mentions}",
  'staff.match.scheduled': 'Horaire fixé : {fixture}, {when}.',
  'schedule.hint.nothingLeft':
    'Aucun match à planifier : ceux de tes équipes ont déjà un résultat.',
  'schedule.hint.noMatch': 'Aucun de tes matchs à planifier ne correspond à « {query} ».',
  'schedule.error.not_linked': "Ce serveur n'est relié à aucune ligue.",
  'schedule.error.not_staff': 'Cette commande est réservée au staff de la ligue.',
  'schedule.error.no_team':
    'Tu ne gères aucune équipe. Le staff peut te nommer avec /team manager.',
  'schedule.error.match_not_found':
    'Match introuvable dans cette ligue. Choisis-le dans la liste proposée.',
  'schedule.error.not_your_match':
    "Tu n'es ni manager ni staff d'une des deux équipes de ce match.",
  'schedule.error.not_schedulable':
    "Ce match a déjà un résultat : il n'y a plus d'horaire à fixer.",
  'schedule.error.in_past': 'Cet horaire est déjà passé.',
  'schedule.error.outside_period':
    'Cet horaire tombe hors de la semaine du match et de sa prolongation. Le staff de la ligue peut fixer un autre horaire.',
  'schedule.error.stale': 'Cette proposition a déjà reçu une réponse ou a été remplacée.',
  'schedule.error.not_opponent':
    "Seule l'équipe adverse peut accepter ou refuser cette proposition.",
  'schedule.error.invalid_date':
    'Date illisible : choisis un jour dans la liste ou tape AAAA-MM-JJ.',
  'schedule.error.invalid_time': 'Heure illisible : tape-la comme 21:00.',
  'schedule.error.nonexistent_time':
    "Cette heure n'existe pas ce jour-là, à cause du changement d'heure. Choisis-en une autre.",
  'league.channel.kind.schedule': 'Planning des matchs',
  'league.channel.notice.schedule': 'Les prolongations et les horaires fixés seront annoncés ici.',
  'league.error.not_linked': "Ce serveur n'est relié à aucune ligue.",
  'league.error.not_staff': 'Cette commande est réservée au staff de la ligue.',
  'league.error.cannot_post':
    'Je ne peux pas écrire dans ce salon. Donne-moi « Voir le salon » et « Envoyer des messages », puis réessaie.',
  'error.unknownCommand': 'Commande inconnue.',
  'error.unknownButton': "Ce bouton n'est plus utilisable.",
  'error.unknownForm': "Ce formulaire n'est plus utilisable.",
  'error.unexpected': 'Une erreur est survenue. Réessaie dans un instant.',
  'command.help.description': 'Explique les commandes du bot en détail.',
  'command.help.option.command': 'La commande à expliquer. Sans elle, la liste des commandes.',
  'help.choice.standings': '/standings',
  'help.choice.match': '/match report',
  'help.choice.staff-match': '/staff match',
  'help.choice.staff-sanction': '/staff sanction',
  'help.choice.team': '/team',
  'help.choice.league': '/league channel',
  'help.overview':
    "**Les commandes de Ligo**\n• `/standings` — le classement de la saison, en image ou en texte.\n• `/match propose-time` — proposer un horaire de match à l'équipe adverse.\n• `/match veto` — le veto des cartes, avant le match.\n• `/match report` — signaler le résultat d'un match de ton équipe, avec la capture d'écran du tableau des scores.\n• `/help` — cette aide. `/help command:` explique une commande en détail.",
  'help.overview.staff':
    '**Staff de la ligue**\n• `/staff match` — valider, saisir, corriger ou annuler un résultat ; enregistrer un forfait.\n• `/staff sanction` — un avertissement ou des points pour une équipe, et la liste de ses sanctions.\n• `/team` — le manager et le staff de chaque équipe.\n• `/league channel` — les salons du bot : file de validation et résultats.\n\n**Mise en place**\n1. `/league channel` deux fois : la file de validation du staff, puis le salon des résultats.\n2. `/team manager` pour chaque équipe.\nLes équipes peuvent alors signaler leurs résultats avec `/match report`.',
  'help.page.standings':
    "**`/standings`** — le classement de la saison en cours\nOuvert à tous.\n\n• `division` (facultatif) : « Ligue 1 » ou « L1 », par exemple. Sans elle, toutes les divisions.\n• `format` (facultatif) : Image (par défaut) ou Texte.\n\nSeuls comptent les résultats validés et les forfaits, avec les points des sanctions. Un résultat signalé mais pas encore validé n'apparaît pas.\nColonnes : MJ matchs joués, W victoires, L défaites, RW manches gagnées, RL manches perdues, Diff (RW − RL), PTS points. Les égalités sont départagées selon le règlement de la ligue.",
  'help.page.match':
    "**`/match report`** — signaler le résultat d'un match\nPour le manager et le staff des deux équipes. Le staff de la ligue les désigne avec `/team manager`.\n\n• `match` : choisis-le dans la liste. Elle ne montre que les matchs de tes équipes encore à jouer ; tape un nom, un tag ou « s3 » (semaine 3) pour la filtrer.\n• `score_a` et `score_b` : les manches gagnées par la première et la seconde équipe citées, dans l'ordre du match, pas forcément la tienne d'abord.\n• `screenshot` : la capture du tableau des scores, obligatoire. PNG, JPEG ou WebP, {maxMb} Mo au plus.\n\nUn score impossible selon le règlement (7–6, par exemple) est refusé. Un forfait ne se signale pas : préviens le staff de la ligue.",
  'help.match.steps.staff':
    "**Ensuite**\n1. Le bot publie le résultat avec la capture et mentionne l'équipe adverse.\n2. L'équipe adverse clique **Confirmer** ou **Contester**. Pour contester, elle choisit un motif et peut ajouter des détails, lus par le staff seulement.\n3. Le staff clique **Valider** ou **Refuser**. Refusé, le match peut être signalé de nouveau.\n4. Validé, le résultat est annoncé dans le salon des résultats et compte au classement.",
  'help.match.steps.opponent':
    "**Ensuite**\n1. Le bot publie le résultat avec la capture et mentionne l'équipe adverse.\n2. L'équipe adverse clique **Confirmer** : le résultat est validé, annoncé dans le salon des résultats et compte au classement. **Contester** demande un motif et des détails, lus par le staff de la ligue, qui tranche.",
  'help.choice.match-time': '/match propose-time',
  'help.page.matchTime':
    "**`/match propose-time`** — proposer un horaire\nPour le manager et le staff des deux équipes.\n\n• `match` : choisis-le dans la liste, parmi les matchs de tes équipes encore à jouer.\n• `date` : le jour, choisi dans la liste (les jours restants de la semaine du match et de sa prolongation) ou tapé comme AAAA-MM-JJ.\n• `time` : l'heure, comme 21:00, à l'heure de la ligue. Le message l'affiche ensuite à l'heure de chacun.\n\nL'équipe adverse clique **Accepter** ou **Refuser**. Une nouvelle proposition de ton équipe remplace la précédente. Un horaire hors de la semaine et de sa prolongation se demande au staff de la ligue.\n\n**Sans accord**",
  'help.matchTime.autoSlot':
    'Sans horaire convenu à la fin de la semaine, le bot accorde {weeks} semaine(s) de prolongation et fixe aussitôt le match au dernier {day} de la prolongation, à {time}. Un horaire convenu ensuite le remplace.',
  'help.matchTime.noAutoSlot':
    "Sans horaire convenu à la fin de la semaine, le bot accorde {weeks} semaine(s) de prolongation ; ensuite, le staff de la ligue fixe l'horaire.",
  'help.page.staffMatch':
    "**`/staff match`** — les résultats, réservé au staff de la ligue\n`match` : tape une équipe, une division (L1) ou une semaine (s3), puis choisis dans la liste.\n\n• `result` — saisit ou corrige un score (`score_a`, `score_b`, `screenshot` facultatif). Il compte aussitôt, sans validation, et il est annoncé dans le salon des résultats, une correction aussi.\n• `schedule` — fixe l'horaire d'un match (`date`, `time`), même hors de sa semaine. Annoncé dans le salon du planning.\n• `validate` — valide un résultat signalé par une équipe, comme le bouton **Valider**. La liste ne propose que les matchs en attente.\n• `void` — annule un match, avec un motif (`reason`) gardé dans le journal. Rien n'est supprimé ; le match ne compte plus.\n• `forfeit` — enregistre le forfait de la première ou de la seconde équipe citée (`team`). Il est annoncé dans le salon des résultats.",
  'help.staffMatch.footer':
    'Un forfait ou un match annulé ne se corrige pas avec `result`. Chaque action est inscrite au journal avec son auteur.',
  'help.forfeit.warning':
    "À {count} forfaits, un avertissement est ajouté automatiquement à l'équipe.",
  'help.forfeit.exclusion':
    "À {count} forfaits, le staff est alerté dans la file de validation ; l'exclusion reste sa décision.",
  'help.page.staffSanction':
    "**`/staff sanction`** — les sanctions d'équipe, réservé au staff de la ligue\n• `add` — `team`, `kind`, `reason`, et `points` pour une sanction en points.\n  – Avertissement : gardé dans la liste, sans effet sur le classement.\n  – Points au classement : `points:-1` retire un point, `points:2` en ajoute deux. Le classement suit aussitôt.\n• `list` — les sanctions d'une équipe cette saison, avec date et motif. Les avertissements automatiques des forfaits y figurent.\n\nUne sanction ne se supprime pas : pour en annuler une, ajoute la sanction inverse (`points:1` après `points:-1`) avec son motif.",
  'help.page.team':
    "**`/team`** — qui agit pour chaque équipe, réservé au staff de la ligue\nLe manager et le staff d'une équipe peuvent signaler et confirmer ses résultats. En attendant les inscriptions sur le site, c'est ici qu'on les désigne.\n\n• `/team manager` — désigne le manager d'une équipe (`team`, `member`). L'ancien manager perd ce rôle.\n• `/team staff add` — ajoute un membre au staff d'une équipe.\n• `/team staff remove` — retire un membre de l'équipe, manager compris.\n• `/team staff list` — le manager et le staff d'une équipe.\n\nUne même personne peut gérer plusieurs équipes.",
  'help.team.max': 'Une équipe a un manager et {max} membres de staff au plus.',
  'help.page.league':
    "**`/league channel`** — les salons du bot, réservé au staff de la ligue\n• `kind` File de validation du staff : les résultats à valider avec leurs captures, les contestations et les alertes de forfaits. Une seule pour toute la ligue ; garde-la réservée au staff.\n• `kind` Planning des matchs : les prolongations et les horaires fixés, en attendant un salon par match.\n• `kind` Résultats validés : chaque résultat qui compte y est annoncé, forfaits compris.\n• `channel` : le salon textuel. Le bot y poste un message ; s'il ne peut pas y écrire, rien n'est enregistré.\n• `division` (facultatif, résultats seulement) : donne à une division son propre salon de résultats. Sans `channel`, la division perd le sien et revient à celui de la ligue. Plusieurs divisions peuvent partager un salon.\n\n**`/league channels`** — affiche les salons choisis, division par division.\n\nLe bot retrouve ses salons par leur identifiant : les renommer ne casse rien. Sans file de validation, les équipes ne peuvent pas signaler de résultat.",
  'command.match.veto.description': "Lance le veto des cartes d'un match de ton équipe.",
  'veto.title': '**Veto — {fixture}** (BO{bestOf})',
  'veto.roles':
    '{chooser} choisit le côté de départ et commence le veto ; {other} choisit le côté en prolongation. Hôte : {host}.',
  'veto.coin': 'Égalité au classement : le bot a tiré au sort {chooser}.',
  'veto.bans': 'Bannies : {list}',
  'veto.ban': '{map} ({team})',
  'veto.ban.timedOut': '{map} ({team}, temps écoulé)',
  'veto.game': 'Carte {n} : **{map}**',
  'veto.game.picked': 'Carte {n} : **{map}** (choix de {team})',
  'veto.game.decider': 'Carte {n} : **{map}** (décisive)',
  'veto.sides': '{team} commence en {side} ; en prolongation, {otTeam} prend {otSide}.',
  'veto.sides.start': '{team} commence en {side}.',
  'veto.sides.later':
    "Côtés : à l'équipe qui a la meilleure différence de manches sur les cartes précédentes.",
  'veto.side.attack': 'Attaque',
  'veto.side.defense': 'Défense',
  'veto.turn.ban': 'Au tour de **{team}** : bannir une carte. Fin du temps {deadline}.',
  'veto.turn.pick': 'Au tour de **{team}** : choisir une carte. Fin du temps {deadline}.',
  'veto.turn.side':
    'Au tour de **{team}** : choisir le côté de départ sur {map}. Fin du temps {deadline}.',
  'veto.turn.ot_side':
    'Au tour de **{team}** : choisir le côté en prolongation sur {map}. Fin du temps {deadline}.',
  'veto.timeoutRule': 'Sans choix à temps, le bot choisit au hasard.',
  'veto.done': 'Veto terminé. Bon match !',
  'veto.started': 'Veto lancé : le message est juste en dessous.',
  'veto.error.not_linked': "Ce serveur n'est relié à aucune ligue.",
  'veto.error.no_team':
    "Tu n'es ni manager ni staff d'une équipe de cette ligue. Demande au staff de la ligue de t'ajouter avec /team.",
  'veto.error.match_not_found': "Ce match n'existe pas dans cette ligue. Choisis-le dans la liste.",
  'veto.error.not_your_match': "Ce match n'est pas celui de ton équipe.",
  'veto.error.not_schedulable':
    "Ce match n'est plus à jouer : son résultat est déjà signalé ou réglé.",
  'veto.error.already_started':
    'Le veto de ce match a déjà commencé : son message est dans le salon où il a été lancé.',
  'veto.error.no_format':
    "La ligue n'a pas de veto pour ce format de match. Le staff de la ligue peut l'ajouter dans les réglages.",
  'veto.error.pool_size':
    'Le nombre de cartes de la saison ne correspond pas à la séquence de veto. Préviens le staff de la ligue.',
  'veto.error.no_ranks':
    'Le classement de cette division est introuvable : impossible de savoir qui choisit les côtés. Préviens le staff de la ligue.',
  'veto.error.not_started': "Le veto de ce match n'a pas commencé.",
  'veto.error.stale': 'Ce choix a déjà été fait : regarde le message à jour.',
  'veto.error.finished': 'Le veto de ce match est terminé.',
  'veto.error.not_your_turn': "Ce n'est pas au tour de ton équipe.",
  'veto.error.invalid_choice': "Ce choix n'est plus possible.",
  'veto.hint.nothingLeft': 'Aucun match à jouer pour tes équipes.',
  'veto.hint.noMatch': 'Aucun de tes matchs à jouer ne correspond à « {query} ».',
  'help.choice.match-veto': '/match veto',
  'help.page.matchVeto':
    "**`/match veto`** — le veto des cartes\nPour le manager et le staff des deux équipes ; le staff de la ligue peut aussi le lancer.\n\n• `match` : choisis-le dans la liste.\n\nAu lancement, le bot fige qui choisit quoi d'après le classement du moment : l'équipe la moins bien classée choisit le côté de départ et commence le veto, l'autre choisit le côté en prolongation, la mieux classée héberge. À égalité de classement, le bot tire au sort.\n\nLe bot poste un message avec un bouton par carte : chaque équipe clique à son tour pour bannir ou choisir, puis Attaque ou Défense. Le message se met à jour à chaque choix. Chaque tour a un temps limité ; sans choix à temps, le bot choisit au hasard et le note.\nÀ la fin, la carte est enregistrée avec le match : `/match report` la reprend.",
  'card.eyebrow': '{competition} · {season}',
  'card.title': '{division} · Semaine {week}',
  'card.label.time': 'Match programmé',
  'card.label.result': 'Résultat',
  'card.vs': 'VS',
  'card.forfeit': 'Forfait',
  'card.when': '{date} · {time} {zone}',
  'card.winner': 'Victoire de {team}',
  'card.forfeitBy': 'Forfait de {team}',
  'standings.zone.champion': 'Champion',
  'standings.zone.promotion': 'Montée',
  'standings.zone.barrage_promotion': 'Barrage de montée',
  'standings.zone.qualification': 'Qualification',
  'standings.zone.barrage_relegation': 'Barrage de maintien',
  'standings.zone.relegation': 'Relégation',
} as const;

export type MessageKey = keyof typeof fr;
