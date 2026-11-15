# Règlement LFR — Saison 4 (brouillon)

Ce document rassemble les règles décidées en concevant Ligo, la plateforme qui gère la ligue.
Il sert de base au règlement de la Saison 4 : des règles courtes, applicables, et **appliquées par
l'outil** plutôt que laissées à la bonne volonté de chacun.

Chaque règle indique :

- **Statut** : _Décidée_ (par le mainteneur), _Règlement S3_ (reprise telle quelle), ou
  _Provisoire_ (en attendant la réponse du propriétaire de la ligue, avec la question à trancher).
- **Appliquée par** : ce que Ligo fait pour la faire respecter. Une règle sans cette ligne n'est
  pas encore appliquée par l'outil.

Tous les nombres de ce document sont des **réglages** : le staff peut les changer d'une saison à
l'autre sans modifier l'outil. Les valeurs données sont celles de la Saison 4.

Les questions encore ouvertes sont listées dans `docs/open-questions.md` (O-xx : propriétaire,
M-xx : mainteneur).

---

## 1. Structure

### 1.1 Divisions

- La ligue compte des divisions classées par niveau : Ligue 1 (niveau 1), Ligue 2 (niveau 2).
  Une division a autant d'équipes qu'elle a de places, **12 au maximum** : avec un match par
  semaine, la saison régulière doit tenir dans une saison R6 et laisser la place à la Coupe de
  France.
- La saison régulière est un championnat aller simple : chaque équipe affronte chaque autre une
  fois, **un match par semaine**.
- Une équipe nouvellement inscrite commence en général en **Ligue 2**. Quand des places se
  libèrent en Ligue 1, parce que des équipes sont parties, le staff peut y placer directement une
  nouvelle équipe. Une équipe qui ne se réinscrit pas perd sa place : si elle revient, elle
  s'inscrit comme une nouvelle équipe.
- **Statut** : Décidée.
- **Appliquée par** : le staff choisit la division en validant l'inscription ; une inscription qui
  ferait dépasser 12 équipes dans une division est refusée (phase 3), et le calendrier n'est
  généré que pour une division dans la limite (phase 4).

### 1.2 Format des matchs

- Ligue 1 et Ligue 2 : **BO1**, une carte jouée après le veto.
- Une carte se gagne en **7 manches sur 12**. À 6–6, une prolongation au meilleur des 3 manches :
  le score final est 8–6 ou 8–7. Il n'y a jamais de match nul.
- **Statut** : Décidée.
- **Appliquée par** : un score impossible (par exemple 7–6, 9–3 ou une égalité) est refusé à la
  saisie, par les équipes comme par le staff.

### 1.3 Pool de cartes

- Le pool officiel compétitif de la saison Ubisoft en cours. Saison 4 au départ : Bank, Chalet,
  Clubhouse, Nighthaven Labs, Lair, Villa, Kafe Dostoyevsky, Border, Fortress.
- Le staff met le pool à jour quand Ubisoft le modifie.
- **Statut** : Décidée.
- **Appliquée par** : le veto ne propose que les cartes du pool.

## 2. Équipes

### 2.1 Clubs et équipes

- Un **club** (la structure : Not Scam, W Mates, Greed) peut inscrire **plusieurs équipes**, par
  exemple une équipe principale et une académie. C'est l'équipe qui joue : elle a sa place dans
  une division, ses matchs et sa ligne au classement, sous son propre nom.
- Plusieurs équipes d'un même club peuvent jouer dans la même division (Greed et GREED Academy en
  Ligue 1). La limite par division est un réglage, sans limite en Saison 4.
- Les mouvements de joueurs entre équipes d'un même club (mouvement de mercato, remplacement sur
  quelques matchs, promotion de l'académie) seront des réglages, fixés avec le mercato.
- **Statut** : Décidée ; les mouvements entre équipes d'un club sont Provisoires (M-22).
- **Appliquée par** : les clubs arrivent avec l'inscription sur le site (phase 3).

### 2.2 Responsables

- Deux niveaux : les responsables du **club** (le propriétaire et ses managers) agissent pour
  toutes ses équipes ; ceux d'une **équipe** (managers, coach) pour cette équipe seulement.
- Un club a **au plus 3 managers** en plus de son propriétaire ; chaque équipe a **au plus 3
  managers** et **au plus 1 coach**. Avec le **capitaine**, ce sont
  eux qui agissent pour l'équipe dans ses matchs : proposer et accepter un horaire, faire le veto,
  signaler et confirmer un résultat. C'est d'abord le rôle du capitaine, mais un responsable peut
  toujours le faire.
- Dans un match entre deux équipes d'un même club, les responsables du club n'agissent pour
  aucun des deux côtés : chaque équipe agit par ses propres responsables et son capitaine.
- Le propriétaire répond de l'équipe devant la ligue. Il ne peut pas la quitter sans l'avoir
  confiée à quelqu'un d'autre.
- Une même personne peut être responsable de plusieurs équipes.
- **Statut** : Décidée (remplace « un manager et 3 membres de staff » du formulaire S3).
- **Appliquée par** : chaque commande vérifie, au moment du clic, que la personne est responsable
  de l'équipe concernée, à son niveau ou à celui de son club. Les rôles Discord ne suffisent pas.
  Les limites sont des réglages. Le capitaine de l'effectif validé pour la saison agit dans les
  matchs de cette saison, et il est mentionné avec les responsables quand un horaire est proposé,
  un résultat signalé ou un veto lancé. Il ne demande aucun changement de responsables : `/team`
  reste réservé aux responsables. Le capitaine de remplacement pour un match est nommé sur la
  page du match par les responsables ou le capitaine habituel ; il agit dans ce match seulement
  et y est mentionné, mais ne nomme personne.

### 2.3 Effectifs

- 5 joueurs et jusqu'à 2 remplaçants, dont **un capitaine**, qui est forcément un titulaire.
  Quand le capitaine ne peut pas jouer un match, les responsables ou le capitaine nomment un
  autre titulaire ou un remplaçant capitaine pour ce match, jusqu'au signalement du résultat. Le
  capitaine habituel continue d'agir aussi.
- **Un joueur, une équipe par compétition** : un joueur peut figurer dans plusieurs équipes
  seulement si elles ne jouent pas la même compétition. Ligue 1 et Ligue 2 comptent comme une
  seule compétition, puisque montées et descentes les relient. Une inscription qui ne respecte pas
  cette règle est refusée.
- **Âge** : 16 ans minimum au premier jour de la saison. Chaque joueur indique sa date de
  naissance sur sa page ; personne d'autre ne la voit, le staff voit seulement s'il a l'âge
  requis.
- **Serveur Discord** : un joueur doit être membre du serveur Discord de la LFR pour rejoindre
  une équipe.
- **Changements d'effectif** : libres jusqu'au début de la saison, puis uniquement pendant les
  fenêtres de mercato annoncées : 3 mouvements par équipe, un joueur transféré est bloqué un jour.
- À l'inscription, chaque joueur **accepte la publication de ses statistiques**. Sans cet
  accord, il ne peut pas figurer dans un effectif.
- **Clubs avant toute compétition** : chacun peut créer sur le site un club et sa première équipe,
  sans compétition, et en est propriétaire ; les responsables du club y ajoutent des équipes. Les
  noms et les tags sont réservés dès la création. Tant qu'une équipe ne joue dans aucune
  compétition, ses responsables la changent eux-mêmes, sans validation. Ses joueurs la rejoignent
  par son lien d'invitation, avec leur propre compte, une fois leur compte R6 et leur nationalité
  renseignés ; 10 joueurs au plus (réglage du groupe). Ils la quittent quand ils veulent ; les
  responsables (hors coach) peuvent en retirer. Cette liste reste ouverte toute l'année : elle
  prépare une inscription. Seul l'effectif d'une saison en cours, qui joue ses matchs, ne change
  qu'en fenêtre de mercato.
- **Inscription sur le site** : un responsable qui gère les joueurs de l'équipe l'inscrit et
  accepte le règlement en vigueur, dont la version est enregistrée. Il choisit ensuite, parmi les
  joueurs de l'équipe, les titulaires, les remplaçants et le capitaine. Personne ne renseigne les
  données d'un autre : chaque joueur indique lui-même, sur sa page, son nom Ubisoft, son
  profileID s'il l'a, son rang (qu'il tient à jour), sa nationalité, sa date de naissance et son
  accord sur les statistiques. Le staff voit l'inscription dès son dépôt et la valide une fois
  l'équipe au complet, chaque joueur sur le serveur Discord de la ligue et les responsables dans
  les limites de la ligue.
- **Statut** : Règlement S3 ; capitaine (article 2.2), accord sur les statistiques, inscription,
  capitaine titulaire, une équipe par compétition, âge, serveur Discord et verrouillage des
  effectifs décidés (mainteneur, 14 et 15 novembre 2026).
- **Appliquée par** : `/clubs/new`, la page de l'équipe et `/me` ; les joueurs rejoignent
  l'équipe par son lien d'invitation ; `/c/lfr/register` inscrit l'équipe ; tout responsable
  qui peut inscrire l'équipe (propriétaire, managers du club, managers de l'équipe, pas le
  coach) compose l'effectif sur la page de l'inscription ou retire l'inscription ; le staff valide sur `/staff`, en choisissant
  la division (12 équipes au plus), ou refuse avec une raison. La validation donne à l'équipe sa
  place et l'effectif de la saison. Le mercato viendra ensuite.

### 2.4 Demandes des équipes

- Les équipes gèrent elles-mêmes leurs responsables, par **demande** au staff de la ligue :
  - le propriétaire et les managers demandent d'**ajouter** un manager ou un coach ; seuls le
    propriétaire et les managers du club demandent un **manager du club** ;
  - seul le propriétaire peut **confier le club** à un nouveau propriétaire, qui quitte alors
    le club ;
  - seul le propriétaire peut **retirer** un responsable : c'est immédiat, sans validation ;
  - chacun peut **quitter** l'équipe, immédiatement, sauf le propriétaire.
- Le staff répond **sous 24 heures** : il approuve, ou refuse en donnant une **raison**, que
  l'équipe reçoit. Une demande peut être retirée tant qu'elle attend.
- Le staff peut aussi modifier une équipe directement, sans demande.
- À partir de la phase 3, l'inscription, les mouvements de mercato et les transferts de place
  passent aussi par des demandes.
- **Statut** : Décidée.
- **Appliquée par** : `/team` dépose la demande et la poste dans la file du staff avec les boutons
  Approuver et Refuser ; le refus exige une raison. Le bot rappelle la demande au staff 6 heures
  avant l'échéance. L'équipe reçoit la réponse en message privé. Toutes les demandes sont
  conservées, quelle que soit leur issue.

## 3. Programmation des matchs

### 3.1 Semaine de jeu

- Chaque match a sa semaine, du lundi 00:00 au dimanche 23:59, à l'heure de Paris.
- Les deux équipes conviennent d'un jour et d'une heure dans la semaine du match ou dans sa
  prolongation.
- **Statut** : Décidée.
- **Appliquée par** : `/match propose-time` ; l'équipe adverse accepte ou refuse avec un bouton.
  Un horaire passé ou hors de la semaine et de sa prolongation est refusé. Une nouvelle
  proposition d'une équipe remplace la précédente.

### 3.2 Prolongation et horaire automatique

- Sans horaire convenu à la fin de la semaine, le match reçoit **une semaine de prolongation**,
  et il est aussitôt fixé au **dimanche 21:00** de cette semaine de prolongation.
- Les équipes peuvent encore convenir d'un autre horaire pendant la prolongation ; il remplace
  l'horaire automatique.
- **Statut** : Décidée.
- **Appliquée par** : l'horloge du bot accorde la prolongation, fixe l'horaire et prévient les
  deux équipes dans le salon de planning, sans intervention du staff. Le message rappelle que les
  équipes peuvent encore convenir d'un autre horaire.

### 3.3 Exceptions

- Un match peut se jouer hors de sa semaine et de sa prolongation si **les deux équipes sont
  d'accord**, mais seul le staff peut fixer cet horaire. Les équipes ne peuvent pas le proposer
  elles-mêmes.
- **Statut** : Décidée.
- **Appliquée par** : `/staff match schedule`, enregistré dans l'historique.

### 3.4 Salon du match

- Une fois les salons de match créés par le bot, la proposition d'horaire et le veto se font
  **uniquement dans le salon du match**. Le bot y épingle un message qui explique les étapes.
- **Statut** : Décidée ; appliquée à partir de la création des salons de match (phase 4).

## 4. Côtés, hôte et veto

### 4.1 Qui choisit quoi

- L'équipe **la moins bien classée** au moment du veto choisit le côté de départ et commence le
  veto. L'autre équipe choisit le côté en prolongation. L'équipe **la mieux classée héberge**.
- À égalité de classement (par exemple en semaine 1), **pile ou face**, comme sur le circuit
  BLAST. En BO1, le gagnant choisit soit **le choix du côté**, soit **qui bannit en premier** ;
  le perdant prend l'autre décision. En BO3 et BO5, le gagnant choisit qui bannit en premier.
  Après un pile ou face, **les équipes conviennent de l'hôte** entre elles.
- **Statut** : Décidée.
- **Appliquée par** : le bot calcule le classement en direct et fige ces rôles au lancement du
  veto. Le pile ou face est tiré par le bot, annoncé dans le message et gardé dans l'historique ;
  les décisions qui suivent se prennent avec des boutons, et le message laisse l'hôte aux équipes.

### 4.2 Veto

- Le veto suit celui du circuit BLAST ([règlement BLAST R6 2025](https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/53GxmEddEWemHwz8BBbJpZ/96a6decc0ca03defc9c1ae9e06bd0809/BLASTR6_GLOBALRULEBOOK_SEASON_2025.pdf),
  article 5.1.3.2). L'équipe A est celle qui bannit en premier.
- BO1 : bans alternés, l'équipe A commence, jusqu'à ce qu'il reste une carte. L'équipe qui a le
  choix du côté choisit son côté de départ, l'autre son côté en prolongation.
- BO3 : A ban, B ban, A ban, B ban, A pick, B pick, A ban, B ban ; la carte restante est la
  décisive. Pour une carte choisie, l'adversaire de celui qui l'a choisie prend le côté de
  départ, celui qui l'a choisie le côté en prolongation ; pour la décisive, un nouveau pile ou
  face désigne l'équipe qui choisit le côté.
- BO5 : A ban, B ban, A pick, B pick, A ban, B ban, A pick, B pick ; la carte restante est la
  décisive. Côtés comme en BO3.
- **4 minutes par étape.** Sans choix à temps, le bot choisit au hasard et le note.
- **Statut** : Décidée.
- **Appliquée par** : `/match veto`, ou la page du veto sur le site (`/matches/:id/veto`, pour
  les deux équipes et le staff) ; seule l'équipe dont c'est le tour peut choisir. La carte et les
  bans sont enregistrés avec le match.

### 4.3 Re-host

- Le score d'avant l'incident est conservé. Chaque équipe peut demander **un re-host par
  carte**. Le staff peut en accorder d'autres, à sa discrétion, pour un vrai problème (bug du
  jeu, incident grave chez un joueur), et tranche en cas de désaccord.
- **Statut** : Décidée. Pas encore appliquée par l'outil (phase 5, replays).

## 5. Résultats

### 5.1 Signalement

- Après le match, un responsable d'une des deux équipes signale le score avec une
  **capture d'écran du tableau des scores**. Sans capture, pas de signalement.
- **Statut** : Règlement S3.
- **Appliquée par** : `/match report`, ou la page du match sur le site (capture envoyée depuis
  l'ordinateur), exige la capture et refuse un score impossible. Les deux équipes et le staff
  voient la capture sur le site ; personne d'autre.

### 5.2 Confirmation ou contestation

- L'équipe adverse confirme ou conteste. Une contestation indique une raison : score incorrect,
  capture manquante ou illisible, joueur non inscrit ou non éligible, match non joué, problème
  technique ou re-host, ou « autre » avec une explication obligatoire (1 000 caractères au plus).
- La raison n'est montrée qu'au staff : elle peut mettre en cause un joueur.
- **Statut** : Décidée (la liste des raisons est un réglage).
- **Appliquée par** : boutons sous le signalement, ou la page du match sur le site ; seule
  l'équipe adverse peut répondre.

### 5.3 Validation

- **Un résultat confirmé par l'équipe adverse compte aussitôt** : les deux équipes sont d'accord,
  le staff n'a pas à le valider (mainteneur, 14 novembre 2026). Un résultat contesté attend la
  décision du staff, qui peut aussi valider un résultat signalé sans attendre la confirmation.
- Le staff peut rejeter un signalement (le match revient « à jouer »), saisir ou corriger un
  résultat, ou annuler un match. Un résultat n'est jamais effacé : une annulation le marque comme
  nul et non avenu.
- C'est un réglage de la compétition (`result_validation`) : une autre ligue peut exiger la
  validation du staff pour chaque résultat.
- Chaque résultat qui compte est annoncé dans le salon des résultats, y compris les forfaits et
  les corrections.
- **Statut** : Décidée (mainteneur, 14 novembre 2026), à la place du règlement S3.
- **Appliquée par** : file de validation du staff ; chaque action est enregistrée dans
  l'historique, avec son auteur et sa date.

## 6. Classement

### 6.1 Points

- **3 points par victoire**, 0 par défaite. Un forfait compte comme un match joué : 3 points à
  l'adversaire, 0 à l'équipe forfait.
- Score d'un forfait en manches : **7–0** pour une équipe qui ne se présente pas : l'équipe
  présente ne perd rien à la différence de manches. C'est un réglage de la saison.
- Un forfait créé par la règle des 50 % (voir 7.3) a son propre réglage ; en attendant O-27, il
  vaut aussi 7–0.
- **Statut** : Décidée, sauf le score d'un forfait créé par la règle des 50 % (O-27).

### 6.2 Colonnes

- MJ (matchs joués), W (victoires), L (défaites), RW (manches gagnées), RL (manches perdues),
  Diff (RW − RL), PTS (points). Les lettres anglaises sont gardées : elles sont plus parlantes que
  leurs traductions.
- L'image du classement montre aussi l'évolution de chaque équipe depuis la semaine précédente
  et la forme (5 derniers résultats).

### 6.3 Départage

- Classement aux points, puis à la différence de manches. Les équipes encore à égalité partagent
  le même rang.
- **Statut** : Décidée (le départage suivant est un réglage : rang partagé, match d'appui en BO1
  ou décision du staff).

### 6.4 Sanctions au classement

- Le staff peut retirer ou rendre des points, avec un motif. Une sanction ne s'efface pas : une
  erreur se corrige par la sanction inverse.
- **Appliquée par** : `/staff sanction`.

**Appliquée par (tout l'article 6)** : le classement est **calculé** à partir des résultats
validés, des forfaits et des sanctions, à chaque consultation. Personne ne le modifie à la main.

## 7. Forfaits et exclusion

### 7.1 Forfaits

- Seul le staff enregistre un forfait. Une équipe ne peut pas se déclarer vainqueur par forfait.
- **2e forfait** : avertissement automatique.
- **3e forfait** : **exclusion automatique** de la saison (voir 7.2).
- **Aucune des deux équipes ne se présente** : chacune reçoit une défaite par forfait, comme si
  elle seule avait déclaré forfait (0 point, score de forfait perdu, match joué), et le forfait
  compte pour chacune (avertissement, exclusion). Personne ne gagne le match.
- **Statut** : Décidée.
- **Appliquée par** : `/staff match forfeit` (`team` : la première, la seconde ou les deux
  équipes) ; le bot compte les forfaits de chaque équipe concernée dans la saison à chaque fois,
  ajoute l'avertissement puis prononce l'exclusion dans la même opération.

### 7.2 Exclusion

- L'exclusion est **automatique** au seuil de forfaits. Les responsables de l'équipe
  reçoivent un message privé avec la raison et la manière de faire appel ; le salon des résultats
  l'annonce, sans la raison.
- **Appel** : le staff peut annuler une exclusion. L'équipe est alors réintégrée et tous ses
  matchs comptent de nouveau tels qu'ils étaient.
- **Dérogation** : le staff peut désactiver l'exclusion automatique pour une équipe, **toujours
  avec une raison**, et la réactiver. Seul le staff peut le faire. Le staff peut toujours exclure
  une équipe à la main, pour ses forfaits ou toute autre faute grave du règlement.
- **Statut** : Décidée.
- **Appliquée par** : `/staff exclusion exclude | reinstate | auto`, chaque décision enregistrée
  dans l'historique.

### 7.3 Règle des 50 %

- Seuls les matchs **réellement joués** (résultat validé, avec un score) comptent comme joués.
  Les forfaits ne comptent pas, quelle que soit l'équipe qui a déclaré forfait.
- La moitié se calcule sur **tous les matchs de l'équipe dans la saison régulière** (hors matchs
  annulés).
- **Au moins la moitié jouée** : ses résultats validés restent ; chacun de ses autres matchs
  devient une victoire par forfait pour l'adversaire.
- **Moins de la moitié jouée** : **tous** ses matchs deviennent des victoires par forfait pour
  ses adversaires, pour que chaque adversaire obtienne le même résultat contre elle. Exception :
  un match où l'adversaire avait lui-même déclaré forfait reste une défaite pour cet adversaire
  (ne pas se présenter ne rapporte pas de victoire).
- Un match entre deux équipes exclues ne compte pour aucune des deux.
- L'équipe exclue apparaît en dernier au classement, marquée « Exclue », et ne joue plus.
- **Pourquoi les forfaits ne comptent pas** : une équipe est exclue parce qu'elle déclare
  forfait. Si ses forfaits comptaient comme joués, plus elle déclarerait forfait, plus vite elle
  passerait la barre des 50 % et garderait ses résultats : l'inverse du but de la règle.
- **Statut** : Décidée.
- **Appliquée par** : le classement applique la règle au calcul ; aucun résultat n'est réécrit.
  Plus aucun signalement, horaire ou veto n'est accepté sur les matchs d'une équipe exclue.

## 8. Montées, descentes et barrages

- Les **2 dernières** équipes d'une division descendent dans la division inférieure à la fin de
  la saison régulière, **seulement si une division inférieure existe**. La Ligue 2 n'a pas de
  relégation tant qu'aucune ligue n'existe en dessous.
- Les **2 premières** équipes de la division inférieure montent.
- L'équipe **juste au-dessus des relégués** joue un **barrage** contre la **3e** de la division
  inférieure. Le vainqueur prend la place dans la division supérieure.
- La 1re de la Ligue 1 est championne (étoile Ligue 1).
- Les places se comptent depuis le haut et le bas du classement : elles suivent la taille de la
  division.
- Les barrages se jouent **avant la Coupe de France**, en **BO1**.
- **Statut** : Décidée.
- **Appliquée par** : l'image du classement colore ces places (champion, montée, barrage,
  relégation). Les montées et descentes elles-mêmes seront appliquées en fin de saison
  (phase 6).

## 9. Coupe de France

- Élimination directe, une semaine après la fin des ligues. BO1 avant les 8es de finale, BO3 en
  8es et quarts, BO5 en demies et finale. Le vainqueur est Champion de France.
- 7 jours pour convenir d'un horaire, sans prolongation ; à défaut, dimanche 21:00. Une équipe
  absente est disqualifiée ; si les deux sont absentes, les deux le sont et l'adversaire du tour
  suivant passe.
- **Toutes les équipes inscrites en LFR**, Ligue 1 et Ligue 2, participent.
- Le tableau est établi selon la ligue et le classement final : les mieux classées sont
  favorisées.
- Le staff désigne l'équipe qui choisit le côté de départ ; l'autre choisit le côté en
  prolongation ; les équipes conviennent de l'hôte.
- **Statut** : Règlement S3 ; participants et principe du tableau décidés. La forme exacte du
  tableau et la règle de choix des côtés restent à fixer (O-17). Pas encore appliquée par
  l'outil (phase 6).

## 10. Divers

- **MOSS** obligatoire pour chaque match ; les fichiers MOSS ne sont jamais publics.
- Un membre du staff de la ligue ne joue pas dans le championnat.
- Un joueur banni pour triche l'est sur toutes les ligues du groupe (LFR, LFV, LFRL).
- **Replays obligatoires** : pour chaque match, au moins une équipe envoie les replays de
  chaque carte sur le site.
- **Statut** : Règlement S3 ; replays obligatoires décidés. MOSS et replays sur le site en
  phase 5.

---

## À trancher avant la Saison 4

| Question | Sujet                                         | En attendant                        |
| -------- | --------------------------------------------- | ----------------------------------- |
| O-17     | Coupe de France : forme du tableau, côtés     | Non appliqué                        |
| O-22     | Qui peut se déclarer disponible (recrutement) | Joueurs sans équipe, mercato ouvert |
| O-27     | Score d'un forfait créé par la règle des 50 % | 7–0, comme une absence              |
