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
  Une division a autant d'équipes qu'elle a de places ; ce nombre n'est pas fixé par le
  règlement.
- La saison régulière est un championnat aller simple : chaque équipe affronte chaque autre une
  fois, **un match par semaine**.
- **Statut** : Décidée. La taille maximale d'une division reste à fixer (O-16).

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

### 2.1 Responsables d'équipe

- Chaque équipe a **un manager** et **au plus 3 membres de staff**. Eux seuls agissent pour
  l'équipe : proposer un horaire, faire le veto, signaler et confirmer un résultat.
- Une même personne peut gérer plusieurs équipes.
- **Statut** : Règlement S3 (formulaire d'inscription).
- **Appliquée par** : chaque commande vérifie, au moment du clic, que la personne est manager ou
  staff de l'équipe concernée. Les rôles Discord ne suffisent pas.

### 2.2 Effectifs

- 5 joueurs et jusqu'à 2 remplaçants. Mercato uniquement pendant les fenêtres annoncées,
  3 mouvements par équipe, un joueur transféré est bloqué un jour.
- **Statut** : Règlement S3. Pas encore appliquée par l'outil (inscriptions et mercato sur le
  site, phase 3).

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
- **Statut** : Décidée (le moment où l'horaire automatique est fixé attend la confirmation du
  propriétaire, O-13).
- **Appliquée par** : l'horloge du bot accorde la prolongation, fixe l'horaire et prévient les
  deux équipes dans le salon de planning, sans intervention du staff.

### 3.3 Exceptions

- Seul le staff peut fixer un horaire hors de la semaine et de sa prolongation.
- **Statut** : Provisoire (O-24 : les équipes peuvent-elles convenir d'un horaire hors période ?).
- **Appliquée par** : `/staff match schedule`, enregistré dans l'historique.

### 3.4 Salon du match

- Une fois les salons de match créés par le bot, la proposition d'horaire et le veto se font
  **uniquement dans le salon du match**. Le bot y épingle un message qui explique les étapes.
- **Statut** : Décidée ; appliquée à partir de la création des salons de match (phase 4).

## 4. Côtés, hôte et veto

### 4.1 Qui choisit quoi

- L'équipe **la moins bien classée** au moment du veto choisit le côté de départ et commence le
  veto. L'autre équipe choisit le côté en prolongation. L'équipe **la mieux classée héberge**.
- À égalité de classement (par exemple en semaine 1), **le bot tire au sort** l'équipe qui
  choisit le côté de départ ; l'autre héberge.
- **Statut** : Décidée ; le tirage au sort est provisoire (O-12).
- **Appliquée par** : le bot calcule le classement en direct et fige ces rôles au lancement du
  veto. Un tirage au sort est annoncé dans le message et gardé dans l'historique.

### 4.2 Veto

- BO1 : bans alternés, l'équipe A commence, jusqu'à ce qu'il reste une carte. L'équipe A choisit
  son côté de départ, l'équipe B son côté en prolongation.
- BO3 : A ban, B ban, A ban, B ban, A pick, B pick, A ban, B ban ; la carte restante est la
  décisive. Pour une carte choisie, l'adversaire de celui qui l'a choisie prend le côté de
  départ, celui qui l'a choisie le côté en prolongation ; pour la décisive, l'équipe à la
  meilleure différence de manches sur les cartes précédentes choisit.
- BO5 : A ban, B ban, A pick, B pick, A ban, B ban, A pick, B pick ; la carte restante est la
  décisive. Côtés comme en BO3.
- **4 minutes par étape.** Sans choix à temps, le bot choisit au hasard et le note.
- **Statut** : Décidée ; l'ordre des bans attend la confirmation du propriétaire (O-11).
- **Appliquée par** : `/match veto` ; seule l'équipe dont c'est le tour peut cliquer. La carte
  et les bans sont enregistrés avec le match.

### 4.3 Re-host

- Le score d'avant l'incident est conservé. Chaque équipe peut demander un re-host par carte ;
  le staff peut en ordonner d'autres et tranche en cas de désaccord.
- **Statut** : Règlement S3. Pas encore appliquée par l'outil (phase 5, replays).

## 5. Résultats

### 5.1 Signalement

- Après le match, le manager ou un membre du staff d'une équipe signale le score avec une
  **capture d'écran du tableau des scores**. Sans capture, pas de signalement.
- **Statut** : Règlement S3.
- **Appliquée par** : `/match report` exige la capture et refuse un score impossible.

### 5.2 Confirmation ou contestation

- L'équipe adverse confirme ou conteste. Une contestation indique une raison : score incorrect,
  capture manquante ou illisible, joueur non inscrit ou non éligible, match non joué, problème
  technique ou re-host, ou « autre » avec une explication obligatoire (1 000 caractères au plus).
- La raison n'est montrée qu'au staff : elle peut mettre en cause un joueur.
- **Statut** : Décidée (la liste des raisons est un réglage).
- **Appliquée par** : boutons sous le signalement ; seule l'équipe adverse peut répondre.

### 5.3 Validation

- **Un résultat ne compte qu'après validation par le staff.** Le staff peut aussi rejeter le
  signalement (le match revient « à jouer »), saisir ou corriger un résultat, ou annuler un
  match. Un résultat n'est jamais effacé : une annulation le marque comme nul et non avenu.
- Chaque résultat qui compte est annoncé dans le salon des résultats, y compris les forfaits et
  les corrections.
- **Statut** : Règlement S3.
- **Appliquée par** : file de validation du staff ; chaque action est enregistrée dans
  l'historique, avec son auteur et sa date.

## 6. Classement

### 6.1 Points

- **3 points par victoire**, 0 par défaite. Un forfait compte comme un match joué : 3 points à
  l'adversaire, 0 à l'équipe forfait, score **0–0** en manches.
- **Statut** : Décidée.

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
- **Statut** : Décidée.
- **Appliquée par** : `/staff match forfeit` ; le bot compte les forfaits de l'équipe dans la
  saison à chaque fois, ajoute l'avertissement puis prononce l'exclusion dans la même opération.

### 7.2 Exclusion

- L'exclusion est **automatique** au seuil de forfaits. Le manager et le staff de l'équipe
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
- **Statut** : Décidée. Le format et la date des barrages restent à fixer (O-15).
- **Appliquée par** : l'image du classement colore ces places (champion, montée, barrage,
  relégation). Les montées et descentes elles-mêmes seront appliquées en fin de saison
  (phase 6).

## 9. Coupe de France

- Élimination directe, une semaine après la fin des ligues. BO1 avant les 8es de finale, BO3 en
  8es et quarts, BO5 en demies et finale. Le vainqueur est Champion de France.
- 7 jours pour convenir d'un horaire, sans prolongation ; à défaut, dimanche 21:00. Une équipe
  absente est disqualifiée ; si les deux sont absentes, les deux le sont et l'adversaire du tour
  suivant passe.
- Le staff désigne l'équipe qui choisit le côté de départ ; l'autre choisit le côté en
  prolongation ; les équipes conviennent de l'hôte.
- **Statut** : Règlement S3 ; qui participe reste à confirmer (O-25), ainsi que le tirage et la
  règle de choix des côtés (O-17). Pas encore appliquée par l'outil (phase 6).

## 10. Divers

- **MOSS** obligatoire pour chaque match ; les fichiers MOSS ne sont jamais publics.
- Un membre du staff de la ligue ne joue pas dans le championnat.
- Un joueur banni pour triche l'est sur toutes les ligues du groupe (LFR, LFV, LFRL).
- **Statut** : Règlement S3. MOSS et replays sur le site en phase 5.

---

## À trancher avant la Saison 4

| Question | Sujet                                            | En attendant                                |
| -------- | ------------------------------------------------ | ------------------------------------------- |
| O-11     | Ordre des bans (nouvelle règle BLAST 2026 ?)     | Bans alternés en BO1, séquences R6 usuelles |
| O-12     | Côtés entre deux équipes à égalité               | Tirage au sort par le bot                   |
| O-13     | Moment où l'horaire automatique est fixé         | Dès le début de la prolongation             |
| O-15     | Format et date des barrages                      | Non appliqué                                |
| O-16     | Taille maximale d'une division                   | Aucune limite                               |
| O-17     | Coupe de France : choix des côtés, tirage        | Non appliqué                                |
| O-24     | Horaire hors de la semaine et de la prolongation | Seul le staff peut le fixer                 |
| O-25     | Qui entre en Coupe de France                     | Toutes les équipes inscrites                |
