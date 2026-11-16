// UI labels in French, with German and Dutch for the length check (they run about 30 % longer).
// Templates call t('key'); the build renders the standings page once per language to prove every
// label survives. Production will use the message catalog of apps/server instead.

export type Lang = 'fr' | 'de' | 'nl';
let lang: Lang = 'fr';
export const setLang = (l: Lang) => {
  lang = l;
};
export const currentLang = () => lang;

const L = {
  // navigation
  home: ['Accueil', 'Startseite', 'Startpagina'],
  competitions: ['Compétitions', 'Wettbewerbe', 'Competities'],
  standings: ['Classement', 'Tabelle', 'Klassement'],
  calendar: ['Calendrier', 'Spielplan', 'Speelschema'],
  results: ['Résultats', 'Ergebnisse', 'Uitslagen'],
  cup: ['Coupe', 'Pokal', 'Beker'],
  stats: ['Stats', 'Statistiken', 'Statistieken'],
  awards: ['Récompenses', 'Auszeichnungen', 'Prijzen'],
  rules: ['Règlement', 'Regelwerk', 'Reglement'],
  recruitment: ['Recrutement', 'Rekrutierung', 'Rekrutering'],
  overview: ['Aperçu', 'Übersicht', 'Overzicht'],
  matches: ['Matchs', 'Spiele', 'Wedstrijden'],
  roster: ['Effectif', 'Kader', 'Selectie'],
  login: ['Connexion avec Discord', 'Mit Discord anmelden', 'Inloggen met Discord'],
  joinDiscord: ['Rejoindre le Discord', 'Discord beitreten', 'Discord joinen'],
  poweredBy: ['propulsé par Ligo', 'bereitgestellt von Ligo', 'mogelijk gemaakt door Ligo'],
  language: ['Langue', 'Sprache', 'Taal'],
  week: ['Semaine', 'Woche', 'Week'],
  season: ['Saison', 'Saison', 'Seizoen'],
  division: ['Division', 'Division', 'Divisie'],
  updated: ['Mis à jour', 'Aktualisiert', 'Bijgewerkt'],
  // standings columns (section 11: English letters in every language, "played" spelled out)
  colRank: ['#', '#', '#'],
  colMove: ['Évol.', 'Trend', 'Trend'],
  colTeam: ['Équipe', 'Team', 'Team'],
  colPlayed: ['MJ', 'Sp.', 'Gesp.'],
  colPlayedLong: ['Matchs joués', 'Gespielte Spiele', 'Gespeelde wedstrijden'],
  colW: ['W', 'W', 'W'],
  colL: ['L', 'L', 'L'],
  colRW: ['RW', 'RW', 'RW'],
  colRL: ['RL', 'RL', 'RL'],
  colDiff: ['Diff', 'Diff', 'Diff'],
  colPts: ['PTS', 'PTS', 'PTS'],
  colForm: ['Forme', 'Form', 'Vorm'],
  legendW: ['victoires', 'Siege', 'overwinningen'],
  legendL: ['défaites', 'Niederlagen', 'nederlagen'],
  legendRW: ['manches gagnées', 'gewonnene Runden', 'gewonnen rondes'],
  legendRL: ['manches perdues', 'verlorene Runden', 'verloren rondes'],
  legendDiff: ['différence de manches', 'Rundendifferenz', 'rondesaldo'],
  legendPts: ['points', 'Punkte', 'punten'],
  // zones
  zoneChampion: ['Champion', 'Meister', 'Kampioen'],
  zonePromotion: ['Montée en Ligue 1', 'Aufstieg in die Ligue 1', 'Promotie naar Ligue 1'],
  zoneBarragePromotion: ['Barrage de montée', 'Aufstiegs-Relegation', 'Promotiebarrage'],
  zoneBarrageRelegation: ['Barrage de maintien', 'Abstiegs-Relegation', 'Degradatiebarrage'],
  zoneRelegation: ['Descente en Ligue 2', 'Abstieg in die Ligue 2', 'Degradatie naar Ligue 2'],
  excluded: ['Exclue', 'Ausgeschlossen', 'Uitgesloten'],
  shared: ['ex æquo', 'punktgleich', 'gedeeld'],
  sanction: ['Sanction', 'Sanktion', 'Sanctie'],
  formWin: ['Victoire', 'Sieg', 'Winst'],
  formLoss: ['Défaite', 'Niederlage', 'Verlies'],
  formForfeit: ['par forfait', 'kampflos', 'reglementair'],
  noChange: ['Pas de changement', 'Unverändert', 'Ongewijzigd'],
  // match statuses
  stToSchedule: ['À planifier', 'Zu terminieren', 'Te plannen'],
  stProposed: ['Horaire proposé', 'Termin vorgeschlagen', 'Tijdstip voorgesteld'],
  stScheduled: ['Programmé', 'Angesetzt', 'Gepland'],
  stAuto: ['Horaire automatique', 'Automatisch angesetzt', 'Automatisch gepland'],
  stExtension: ['Prolongation', 'Verlängerung', 'Verlenging'],
  stReported: ['Résultat déclaré', 'Ergebnis gemeldet', 'Uitslag gemeld'],
  stDisputed: ['Contesté', 'Angefochten', 'Betwist'],
  stValidated: ['Validé', 'Bestätigt', 'Bevestigd'],
  stForfeit: ['Forfait', 'Forfait', 'Forfait'],
  stVoid: ['Annulé', 'Annulliert', 'Geannuleerd'],
  stNoResult: ['Sans résultat', 'Ohne Wertung', 'Zonder uitslag'],
  stLive: ['En cours', 'Läuft', 'Bezig'],
  stVeto: ['Veto en cours', 'Veto läuft', 'Veto bezig'],
} as const;

export type Key = keyof typeof L;
const IDX: Record<Lang, number> = { fr: 0, de: 1, nl: 2 };

export const t = (key: Key): string => L[key][IDX[lang]];
export const htmlLang = () => lang;
