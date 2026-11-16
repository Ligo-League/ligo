// The pages and states every proposal builds, with the same file names and routes, so the three
// can be compared page by page. A proposal maps each `file` to its own render function:
//
//   export const pages = () => PAGES.map((p) => ({ ...p, render: RENDER[p.file] }))
//
// Routes are the production routes of design doc sections 7 and 17; where the doc names none,
// the route here is an assumption, recorded in each README.

import * as D from '../_data/index.ts';

export interface PageSpec {
  file: string;
  route: string;
  title: string;
  group: string;
  note?: string;
  anchor?: boolean;
  lang?: 'fr' | 'de' | 'nl';
}

const F = D.featured;

export const PAGES: PageSpec[] = [
  // Anchors first.
  { file: 'home.html', route: '/', title: 'Accueil', group: 'Ancres', note: 'Tableau de bord du groupe, jeu. 26 nov. 20:40', anchor: true },
  { file: 'standings-ligue-1.html', route: '/c/lfr/s3/standings/ligue-1', title: 'Classement Ligue 1', group: 'Ancres', note: 'Rang partagé, deux équipes exclues, sanction −3, zones', anchor: true },
  { file: 'match-played.html', route: `/matches/${F.played.id}`, title: 'Match joué (BO1)', group: 'Ancres', note: 'Greed Esport 8–6 Devil Black : prolongation, re-host (2 lobbys), replays vérifiés', anchor: true },

  // Group and competition.
  { file: 'org.html', route: '/o/mbl-group', title: 'Organisation MBL Group', group: 'Groupe et compétitions', note: 'Compétitions par jeu, statut des saisons, Discord, bannissements partagés' },
  { file: 'lfr-s3.html', route: '/c/lfr/s3', title: 'LFR Saison 3 (thème LFR)', group: 'Groupe et compétitions', note: 'Hub de saison, semaine 6' },
  { file: 'lfrl-s1.html', route: '/c/lfrl/s1', title: 'LFRL Saison 1 (thème LFRL)', group: 'Groupe et compétitions', note: 'Même gabarit, thème Rocket League, séries en buts' },
  { file: 'lfv-s2.html', route: '/c/lfv/s2', title: 'LFV Saison 2 (inscriptions)', group: 'Groupe et compétitions', note: 'État vide : pas encore de classement ni de calendrier' },

  // Standings and calendar.
  { file: 'standings-ligue-2.html', route: '/c/lfr/s3/standings/ligue-2', title: 'Classement Ligue 2', group: 'Classement et calendrier', note: 'Montée, barrage, une exclue, pas de descente' },
  { file: 'standings-ligue-1-de.html', route: '/c/lfr/s3/standings/ligue-1?lang=de', title: 'Classement Ligue 1 en allemand', group: 'Classement et calendrier', note: 'Contrôle de longueur des libellés (+30 %)', lang: 'de' },
  { file: 'standings-ligue-1-nl.html', route: '/c/lfr/s3/standings/ligue-1?lang=nl', title: 'Classement Ligue 1 en néerlandais', group: 'Classement et calendrier', note: 'Contrôle de longueur des libellés', lang: 'nl' },
  { file: 'standings-frfl.html', route: '/c/frfl/s1/standings', title: 'Classement joueurs FRFL', group: 'Classement et calendrier', note: 'Facultatif : matchs, victoires, % de victoires, rating' },
  { file: 'calendar.html', route: '/c/lfr/s3/calendar', title: 'Calendrier', group: 'Classement et calendrier', note: 'Semaines 1–11, semaine 6 ouverte, tous les statuts' },
  { file: 'calendar-team.html', route: '/c/lfr/s3/calendar?team=greed-esport', title: 'Calendrier filtré (Greed Esport)', group: 'Classement et calendrier', note: 'Filtre par équipe' },

  // Matches.
  { file: 'match-upcoming.html', route: `/matches/${F.toPlay.id}`, title: 'Match à jouer', group: 'Matchs', note: 'W Mates – GREED Academy ce soir 21:00, veto en cours, aperçu du match' },
  { file: 'match-upcoming-official.html', route: `/matches/${F.toPlay.id}?as=official`, title: 'Match à jouer, vu par un responsable', group: 'Matchs', note: 'Connecté : Houblon (GREED Academy) avec les actions' },
  { file: 'match-proposed.html', route: `/matches/${F.proposed.id}`, title: 'Match avec horaire proposé', group: 'Matchs', note: 'Nova 2 propose ven. 27 nov. 21:30, IGURU n’a pas répondu' },
  { file: 'veto-live.html', route: `/matches/${F.toPlay.id}/veto`, title: 'Veto en cours (BO1)', group: 'Matchs', note: 'Vu par GREED Academy, à elle de bannir, minuteur 4 min' },
  { file: 'veto-done.html', route: `/matches/${F.toPlay.id}/veto?state=done`, title: 'Veto terminé (BO1)', group: 'Matchs', note: 'Bans, ban expiré, carte, côtés' },
  { file: 'veto-bo3.html', route: `/matches/${F.cupBo3.id}/veto`, title: 'Veto BO3 (Coupe)', group: 'Matchs', note: 'Bans, picks, décisive, côtés par carte' },
  { file: 'match-cup-bo3.html', route: `/matches/${F.cupBo3.id}`, title: 'Match de coupe BO3 : carte 1', group: 'Matchs', note: 'Greed Esport 2–1 Panaria Lair, un onglet par carte' },
  { file: 'match-cup-bo3-g2.html', route: `/matches/${F.cupBo3.id}/games/2`, title: 'Match de coupe BO3 : carte 2', group: 'Matchs' },
  { file: 'match-cup-bo3-g3.html', route: `/matches/${F.cupBo3.id}/games/3`, title: 'Match de coupe BO3 : carte 3', group: 'Matchs' },
  { file: 'match-forfeit.html', route: `/matches/${F.forfeit.id}`, title: 'Match forfait', group: 'Matchs', note: 'NTS kastuki forfait contre RCK Esport, 7–0' },
  { file: 'match-disputed.html', route: `/matches/${F.disputed.id}`, title: 'Match contesté', group: 'Matchs', note: 'IGURU déclare 7–5, Click Gaming conteste ; motif jamais public' },
  { file: 'match-overtime.html', route: `/matches/${F.overtime87.id}`, title: 'Match en prolongation 8–7', group: 'Matchs', note: 'ORIGINS LEGION 8–7 Askium Esport' },
  { file: 'match-manual.html', route: `/matches/${F.manual.id}`, title: 'Match avec stats manuelles', group: 'Matchs', note: 'Panaria Lair 7–1 ORIGINS LEGION' },
  { file: 'match-unverified.html', route: `/matches/${F.unverified.id}`, title: 'Match avec replay non vérifié', group: 'Matchs', note: 'Click Gaming 2–7 Lunaria Esport, joueur inconnu dans le replay' },
  { file: 'upload.html', route: `/matches/${F.reported.id}/upload`, title: 'Envoi des replays et du MOSS', group: 'Matchs', note: 'Dossiers, lobbys, joueurs, progression' },

  // Cup.
  { file: 'cup.html', route: '/c/lfr/s3/bracket', title: 'Coupe de France', group: 'Coupe', note: 'Élimination directe, exemptions, disqualification, barrage ; date fictive 21 janv. 2027' },

  // Clubs, teams, players.
  { file: 'club.html', route: '/clubs/w-mates', title: 'Club W Mates', group: 'Clubs, équipes, joueurs', note: 'Équipes en Ligue 1, Ligue 2 et LFRL' },
  { file: 'club-greed.html', route: '/clubs/greed', title: 'Club Greed', group: 'Clubs, équipes, joueurs', note: 'Deux équipes dans la même division' },
  { file: 'team.html', route: '/teams/greed-esport', title: 'Équipe Greed Esport : Aperçu', group: 'Clubs, équipes, joueurs', note: 'Effectif, staff, matchs, stats d’équipe' },
  { file: 'team-tendances.html', route: '/teams/greed-esport/tendances', title: 'Équipe : Tendances', group: 'Clubs, équipes, joueurs', note: 'Scouting : veto, cartes, sites, opérateurs' },
  { file: 'team-palmares.html', route: '/teams/greed-esport/palmares', title: 'Équipe : Palmarès', group: 'Clubs, équipes, joueurs', note: 'Résultats de la plateforme et résultats externes approuvés' },
  { file: 'player.html', route: '/players/vexo', title: 'Joueur Vexo', group: 'Clubs, équipes, joueurs', note: 'Stats, percentiles, splits, journal, carrière' },
  { file: 'player-noconsent.html', route: '/players/pyro', title: 'Joueur sans consentement (Pyrø)', group: 'Clubs, équipes, joueurs', note: 'Profil sans aucune stat' },

  // League pages.
  { file: 'leaders.html', route: '/c/lfr/s3/leaders', title: 'Leaders', group: 'Pages de ligue', note: 'Classements par stat, couverture, échantillon minimum' },
  { file: 'awards.html', route: '/c/lfr/s3/awards', title: 'Récompenses', group: 'Pages de ligue', note: 'Joueur de la semaine, récompenses de saison' },
  { file: 'rules.html', route: '/c/lfr/rules', title: 'Règlement', group: 'Pages de ligue', note: 'Version 3.2, sommaire, historique' },
  { file: 'recruitment.html', route: '/c/lfr/recruitment', title: 'Recrutement', group: 'Pages de ligue', note: 'Annonces de joueurs et d’équipes' },

  // Private.
  { file: 'workspace.html', route: '/teams/greed-esport/workspace', title: 'Espace équipe : rapport', group: 'Pages privées', note: 'Connecté : Vexo (Greed Esport)' },
  { file: 'staff.html', route: '/staff', title: 'File du staff', group: 'Pages privées', note: 'Connecté : Mistral (staff LFR)' },
];
