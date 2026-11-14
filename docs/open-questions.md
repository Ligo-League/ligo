# Open questions

Questions that came up while building Ligo, the platform that will replace score7 for LFR. Each
one is something the code cannot decide by itself: a league rule, a fact about the current season,
or a product choice.

How to use this file:

- Write the reply on the **Answer** line, with the date and who gave it.
- Once answered, move the entry to [Answered](#answered) at the bottom. The rule then goes into
  `docs/design.md` and into the code with the next task that touches it.
- **Until answered** says what the platform does in the meantime, so nothing is blocked silently.
- Questions marked `O-` are for the league owner and can be sent as they are. Questions marked
  `M-` are for the maintainer.

Decisions taken before this file existed are in the "Settled" table of `docs/design.md`,
section 16.

## For the owner

### Season 3, right now

#### O-01 · Nightwolves against Outsouki, week 5

- **Question:** score7 shows this match as a 0–0 draw with one point each. A draw cannot happen,
  so this is an entry error. Which team forfeits? If neither team played, what should be
  recorded: a loss for both, no result at all, something else?
- **Why it matters:** it is the only difference left between Ligo's tables and score7's. Giving
  either team the win awards 3 points to a team that seems to have left.
- **Until answered:** the match has no result in Ligo. Both teams show one match and one point
  fewer than on score7.
- **Answer:**

#### O-02 · Teams that stopped playing

- **Question:** Nightwolves (8 forfeits, no match played), Outsouki (6 forfeits) and Nova 1 Esport
  (7 forfeits) have forfeits entered on score7 for weeks that are not played yet. Have these teams
  left the league? If so, were they excluded by the staff or did they withdraw, and does the
  league treat the two cases differently?
- **Why it matters:** decides how an exclusion or a withdrawal is recorded, and what happens to
  the matches the team already played (see O-04).
- **Until answered:** each of those matches is an ordinary forfeit: 3 points for the opponent, no
  rounds.
- **Answer:**

#### O-03 · Ligue 2 calendar

- **Question:** Ligue 2 has 12 teams, so score7 schedules 11 rounds, two more than the season's
  9 weeks. When are rounds 10 and 11 played? With 12 teams, which places go up to Ligue 1, which
  play a barrage, and which go down?
- **Why it matters:** season dates, the end-of-season moves (phase 6) and the weekly channels
  (phase 4).
- **Until answered:** Ligo gives Ligue 2 weeks 10 and 11 after the season's planned end, and
  computes no promotion or relegation.
- **Answer:**

#### O-23 · Replacement teams in Ligue 2

- **Question:** some Ligue 2 teams are newcomers that replaced teams that stopped playing. Which
  teams are replacements, which team did each one replace, and from which week? Did the newcomer
  take over the departed team's remaining fixtures and its results so far, or start from zero?
  Is there a rule for this, or is it decided case by case?
- **Why it matters:** whose points are whose in the standings, whose forfeits count towards a
  warning, the 50% rule (O-04), and how a replacement is recorded from Season 4: as a transfer
  of the departed team's slot (design doc section 4, `slot_transfer`) or as a new slot.
- **Until answered:** on score7 every Ligue 2 team has 11 fixtures from week 1, so the data does
  not show who replaced whom. Ligo treats each name on score7 as one team for the whole season.
- **Answer:**

### Forfeits and exclusion

#### O-04 · The 50% rule

- **Question:** the rulebook says that when an excluded team has played at least half of its
  matches, its results stand, and otherwise all its matches become forfeit wins for its
  opponents. What counts as "played": only matches really played, or forfeits too? Half of what:
  all the team's matches of the season, or those scheduled so far? Nova 1 played 4 of 11 and
  score7 keeps those four results: is that an exception, or is the rule not applied?
- **Why it matters:** it changes the points and round difference of every team that met the
  excluded team. Blocks the exclusion command (phase 2).
- **Until answered:** Ligo has no exclusion. Results of withdrawn teams stand as they are on
  score7.
- **Answer (maintainer, 13 November 2026, the rule for Season 4):** only matches really played
  count as played; forfeits do not, whoever forfeited. Half of all the team's matches of the
  regular season. Less than half played: every match becomes a forfeit win for the opponent,
  except one the opponent forfeited itself. Design doc section 5, "Forfeits and exclusion".
  Still open for the owner: Nova 1 (4 of 11 played, results kept on score7) in Season 3.

#### O-05 · Exclusion at the third forfeit

- **Question:** the rulebook gives a warning at the 2nd forfeit and exclusion at the 3rd. Is the
  exclusion automatic, or does the staff decide each time? Starly Esport Club has 4 forfeits on
  score7 and still has matches to play.
- **Why it matters:** whether the bot may exclude a team by itself. Blocks the exclusion command
  (phase 2).
- **Until answered:** the bot will add the warning automatically at the 2nd forfeit and only
  alert the staff at the 3rd.
- **Answer (maintainer, 13 November 2026):** automatic, with a message to the team. Staff can
  reverse it on appeal, and can switch the automatic exclusion off for a team, always with a
  reason; only staff can. Existing Season 3 forfeits exclude nobody: only a new forfeit that
  reaches the threshold does (Starly Esport Club stays as it is until staff act).

### Results

#### O-06 · Validating a result the opponent has not confirmed

- **Question:** a team reports its result with a screenshot and the opponent is asked to confirm.
  May the staff validate before the opponent has confirmed? Is there a delay after which a report
  counts as confirmed?
- **Why it matters:** an opponent who never clicks would otherwise block the standings. Shapes
  the report flow (phase 2).
- **Until answered:** staff can validate a reported result at any time; the message shows whether
  the opponent confirmed. There is no automatic confirmation.
- **Answer:**

#### O-08 · Which staff roles decide

- **Question:** the LFR Discord server has several staff roles (STAFF LFR, Helper LFR,
  ADMINISTRATION, DIRECTION MLB). Which of them may validate results, record forfeits and give
  sanctions? May helpers do some of it?
- **Why it matters:** the bot checks one staff role today. Needed before the bot joins the real
  server.
- **Until answered:** one role, chosen at setup, can do every staff action.
- **Answer:**

#### O-09 · Rulebook text

- **Question:** can you send the rulebook as text instead of screenshots? Three points need
  fixing in it: "4 weeks × 2 matches" is a Season 2 leftover (the season is 9 weeks, one match a
  week); the tables have no draw column; and score7 gives 3 points per win in Season 3 while the
  text says 1.
- **Why it matters:** the rules page of the website (phase 3) and the rules teams accept when
  they register.
- **Until answered:** Ligo follows score7 for Season 3: 3 points per win, no draws.
- **Answer:**

### End of season and the cup

#### O-17 · Coupe de France: sides and seeding

- **Question:** which team picks the starting side in a cup match (a formal rule was expected for
  Season 4)? Is the bracket drawn at random, or seeded by league and final rank?
- **Why it matters:** the cup bracket (phase 6).
- **Until answered:** not built yet.
- **Answer (maintainer, 14 November 2026, partial):** the bracket is seeded by league and final
  rank. In Season 2 only Ligue 1 played the cup, as a ladder: the 1st went straight to the final,
  the 2nd to the semi-final, the 3rd to the quarter-final; 4th against 7th and 5th against 6th
  opened, and each winner met the next higher-ranked team. Its flaw: the top team played a single
  match and was sure of 2nd place and its prize money, which left no room for upsets. The
  maintainer expects an ordinary seeded bracket instead, with Ligue 1 and Ligue 2 kept apart until
  late rounds (semi-finals or the final). Still open for the owner: the shape of that bracket, and
  who picks the starting side.

#### O-18 · National leagues

- **Question:** when National launches: which regions, and how many teams qualify for its
  playoffs?
- **Why it matters:** only once the owner launches it (phase 9).
- **Until answered:** not built.
- **Answer (maintainer, 14 November 2026, to confirm with the owner):** "national" probably means
  France-wide, with teams from different départements: regional leaderboards inside France rather
  than separate national leagues. There is no clean way to rank regions against each other, so the
  idea needs the owner's own description before anything is designed.

### Season 4

#### O-19 · Start date

- **Question:** when does Season 4 start, and when does registration open?
- **Why it matters:** it sets the deadline for everything teams must be able to do on the
  platform.
- **Until answered:** the roadmap assumes late December or early January at the earliest.
- **Answer:**

### Team tools

#### O-22 · Recruitment board

- **Question:** may a player who is on a roster post that they are looking for a team? Does the
  rulebook say anything about approaching players of another team?
- **Why it matters:** the recruitment board (phase 10).
- **Until answered:** not built; by default only players without a team could post.
- **Answer (maintainer, 14 November 2026, to confirm with the owner):** a team may approach another
  team's players to recruit them in the next mercato window; that does no harm. A player should
  not post themselves as available while they are on a roster, nor while no mercato window is
  open. Until the owner decides otherwise, only a player without a team may post, and only during
  an open window; both are settings.

## For the maintainer

#### M-02 · Forcing an unusual score

- **Question:** should staff be able to force a score the rules make impossible, for example a
  map stopped by a ruling?
- **Why it matters:** `/match result` refuses such scores today.
- **Until answered:** no override; such cases wait for forfeits and sanctions.
- **Answer:**

#### M-03 · Points per season

- **Question:** points per win changed between Season 2 (1) and Season 3 (3), but the setting
  belongs to the competition, not the season. Move it to the season?
- **Why it matters:** only if an older season is ever loaded next to the current one.
- **Until answered:** one value per competition.
- **Answer:**

#### M-04 · Season 2 table

- **Question:** can you give the score7 address or a screenshot of Season 2's final table?
- **Why it matters:** a second real table to test standings against. Today only its tie-break
  case (23 against 21) is tested.
- **Until answered:** Season 3 is the only real table in the tests.
- **Answer:**

#### M-05 · Several staff roles

- **Question:** depending on O-08, should the platform store several staff roles with different
  rights, or keep one?
- **Why it matters:** a schema change before the bot joins the real server.
- **Until answered:** one staff role per server.
- **Answer:**

#### M-06 · Removing a sanction

- **Question:** should a sanction be revocable, or only offset by another one?
- **Why it matters:** the sanction table has no "revoked" state; adding one is a migration.
- **Until answered:** a sanction can only be offset by an opposite one.
- **Answer:**

#### M-08 · Image cache

- **Question:** keep rendered images in memory, or add the stored cache the design doc describes?
- **Why it matters:** memory is lost at each restart; a render takes under a second.
- **Until answered:** in memory, 32 images.
- **Answer:**

#### M-09 · Other titles' score rules

- **Question:** are Valorant (13 rounds, win by two) and CS2 (13 rounds, overtime periods of 6)
  the values the group's leagues use?
- **Why it matters:** only when those leagues are set up; no competition uses them yet.
- **Until answered:** the values exist in the docs and tests only.
- **Answer:**

#### M-10 · Team level formula

- **Question:** how do official results and external results become a level on the 0–10 scale:
  the baseline of each division, the tier of each external event, what a placement is worth, and
  who sees the level?
- **Why it matters:** the last step of phase 10.
- **Until answered:** not built.
- **Answer:**

#### M-11 · Team workspace privacy

- **Question:** confirm that league staff cannot open a team's private workspace, and that
  teammates may see each other's practice statistics without public stats consent.
- **Why it matters:** teams will not upload scrims if rivals' friends can read them (phase 10).
- **Until answered:** the design assumes yes to both.
- **Answer:**

#### M-12 · Awards

- **Question:** which statistic decides the player of the week, with what minimum of rounds, and
  which season awards exist?
- **Why it matters:** phase 10; the owner may want a say.
- **Until answered:** not built.
- **Answer:**

#### M-13 · Team tools before the other leagues

- **Question:** should the practice book and the team report (first two steps of phase 10) be
  built before FRFL and Rocket League (phases 7 and 8)?
- **Why it matters:** the order of work after Season 4 starts.
- **Until answered:** phase 10 comes last.
- **Answer:**

#### M-14 · The stored forfeit counter

- **Question:** forfeits are now counted from the matches, so the `slot.forfeits` column is never
  written. Remove it in a later migration?
- **Why it matters:** an unused column invites someone to trust it.
- **Until answered:** the column stays, always at 0, and nothing reads it.
- **Answer:**

#### M-16 · Several competitions in one Discord server

- **Question:** a side competition, such as a monthly cup, may run in the same Discord server as
  the league and need its own channels. Today a server maps to one competition (`league_guild` is
  keyed by the server). Should one server be able to hold several competitions, and how does a
  command then know which one it is about?
- **Why it matters:** the schema of `league_guild`, and every command that finds the league from
  the server. Divisions of one competition can already have their own results channels.
- **Until answered:** one competition per server. Planned with cups, phase 6.
- **Answer:**

#### M-17 · A design of its own for each league's images

- **Question:** LFR, LFV, FRFL and LFRL may each want images that reflect their game: colours,
  pictures, fonts. Which of these should a league be able to set, and from where (website,
  settings file)?
- **Why it matters:** the image renderer reads its colours from `competition.theme_json` today;
  pictures and fonts would need more settings and stored files.
- **Until answered:** one design, with the colours a league can already override. To settle with
  the owner before the images are styled (phase 9).
- **Answer:**

#### M-18 · Social images: format, and which ones post on their own

- **Question:** the social images (design doc section 11) are square, 1080 × 1080. Does LFR also
  want a portrait format (1080 × 1350, the tallest Instagram allows) or a wide one for X? And
  which images should the bot post on its own, rather than only on request: the day's matches each
  morning, the week's schedule, "game on" at each match's time?
- **Why it matters:** each format is a layout to draw; automatic posts need a channel and must not
  flood it.
- **Until answered:** square only. The bot attaches `match-time` and `result` images to the
  announcements it already posts; the others wait for their phase. Proposed extra images (veto,
  roster move, bracket, season end) are listed in section 11 for the owner to choose from.
- **Answer (maintainer, 13 November 2026, partial):** roster moves, the bracket and the season end
  are wanted; roster moves go to a `#mercato` channel per league without mentions. Still open for
  the owner: other formats, and which images post on their own.

#### M-19 · What the captain may do

- **Question:** from phase 3, each team has one captain, who must be a player. May the captain
  act for the team in matches (propose a time, run the veto, report and confirm a result) like
  its officials, or is the captain only a title on the roster?
- **Why it matters:** the permission check on match commands, and the roster form (phase 3).
- **Until answered:** rosters are not in Ligo yet; only the owner, managers and coach act.
- **Answer:**

## Answered

#### O-11 · Ban order

- **Answer (maintainer, 14 November 2026):** LFR follows BLAST's map-ban process: the [BLAST R6
  global rulebook, Season 2025](https://staticctf.ubisoft.com/J3yJr34U2pZ2Ieem48Dwy9uqj5PNUQTn/53GxmEddEWemHwz8BBbJpZ/96a6decc0ca03defc9c1ae9e06bd0809/BLASTR6_GLOBALRULEBOOK_SEASON_2025.pdf),
  section 5.1.3.2. Its sequences are the ones Ligo already uses (BO1: eight alternate bans; BO3:
  4 bans, 2 picks, 2 bans; BO5: 2 bans, 2 picks, 2 bans, 2 picks). After a coin toss, the winner
  of a BO1 chooses either side selection or who bans first, and the other team makes the other
  choice; in a BO3 or BO5 the winner chooses who bans first. The side of a picked map goes to the
  team that did not pick it, and a new coin toss gives the side of the decider. The team without
  side selection on a map picks its overtime side.

#### O-12 · Side choice between teams of equal rank

- **Answer (maintainer, 14 November 2026):** BLAST's coin toss (O-11), used only between teams of
  equal rank. Teams of different rank keep the ranking rule: the lower-ranked team picks the
  starting side and bans first, the higher-ranked team hosts. When the coin decides, Ligo names no
  host: the two teams agree on it.

#### O-13 · Deadlines

- **Answer (maintainer, 14 November 2026):** confirmed for Season 4. One week of extension; as
  soon as it starts, the bot sets the match to Sunday 21:00 Paris time and says that the teams can
  still agree another time, which then replaces it.

#### O-14 · Re-hosts

- **Answer (maintainer, 14 November 2026):** one re-host per team per map. Staff may allow more,
  at their discretion, when there is a real problem: a game bug, a serious incident at a player's
  home. Built with replays (phase 5).

#### O-15 · Barrages

- **Answer (maintainer, 14 November 2026):** barrages, for a place in the higher division, are
  played before the Coupe de France, as a BO1. The format is a setting (a BO3 is possible).

#### O-16 · Promotion and relegation places

- **Answer (maintainer, 13 and 14 November 2026):** counts from the bottom, never fixed ranks. The
  last 2 teams of a division that has a lower division go down at the end of the regular season;
  the team just above them plays a barrage against the lower division's 3rd, the winner taking the
  higher place; the lower division's first 2 go up. A division with no lower one sends nobody
  down. A division holds at most 12 teams: with one match a week, 12 teams already make a regular
  season of about 2.6 months, which must fit inside an R6 season and leave room for the cup. Every
  number is a setting (`ruleset_json.promotion`, and the division maximum).

#### O-20 · Replays and stats consent

- **Answer (maintainer, 14 November 2026):** uploading replays is mandatory in Season 4, and
  accepting public player statistics is a requirement at registration. Replays (phase 5) are
  therefore needed before Season 4.

#### O-21 · Scouting pages

- **Answer (maintainer, 14 November 2026):** public. Pro teams get the same from paid analysts,
  and it is public information already for anyone who watches every match; most teams have neither
  the time nor the people to do it.

#### O-24 · A time outside the week and its extension

- **Answer (maintainer, 14 November 2026):** only staff can set a time outside the week and its
  extension, when both teams agree to it. Teams cannot propose one themselves.

#### O-25 · Who enters the Coupe de France

- **Answer (maintainer, 14 November 2026):** every team registered in LFR, Ligue 1 and Ligue 2.

#### M-01 · Hosting for the first test with real teams

- **Answer (maintainer, 14 November 2026):** the VPS and the domain are bought the week of
  16 November; development stays on localhost until then. Phase 2's acceptance week, a full week of
  results through teams, runs during the Season 3 shadow run alongside phase 3 instead of blocking
  it.

#### M-07 · Image templates without JSX

- **Answer (maintainer, 14 November 2026):** no JSX and no build step. Website pages are Hono
  `html` tagged templates, which escape every value; images stay plain element trees.

#### O-07 · Who reports for a team

- **Question:** who may report and confirm results for a team: its manager only, or its staff
  members too (the rulebook allows one manager and up to three staff)? May players do it?
- **Why it matters:** the permission check on team commands (phase 2).
- **Until answered:** the manager and the team's staff can; players cannot.
- **Answer (maintainer, 13 November 2026):** a team has an owner, managers and a coach (its
  officials); all of them report, confirm, propose times and run the veto. Players do not; the
  captain comes with rosters in phase 3 (M-19). Design doc section 5, "Team officials".

#### O-10 · Current map pool

- **Answer (maintainer, 13 November 2026):** the official competitive pool of the current Ubisoft
  season: Bank, Chalet, Clubhouse, Nighthaven Labs, Lair, Villa, Kafe Dostoyevsky, Border,
  Fortress. Stored in the season settings by `pnpm seed`.

#### M-15 · Announcing results entered by staff

- **Answer (maintainer, 13 November 2026):** every result that counts is announced in the
  results channel: validated reports, results typed by staff (and their corrections), and
  forfeits.

#### The website and the bot

- **Answer (maintainer, 13 November 2026):** the website is the main tool and every bot action
  can also be done there. The bot is for quick access inside Discord (staff setup, teams
  reporting from their call) and stays feature complete for what it covers. Discord's one-line
  descriptions are not enough, so `/help` explains each command. Design doc section 3.

#### Team commands and staff commands

- **Answer (maintainer, 13 November 2026):** two commands, because Discord can hide a whole
  command only: `/match` for teams, visible to everyone, and a hidden `/staff` for staff.

#### Points per win in Season 3

- **Answer (maintainer, 13 November 2026):** 3 points per win, as score7 is configured.

#### Walkovers on score7

- **Answer (maintainer, 13 November 2026):** a win without a score ("W.O.") is a forfeit by the
  other team. It counts as a match played, a win and a loss, with no rounds.

#### Draws

- **Answer (maintainer, 13 November 2026):** a draw never happens. The one on score7 is an entry
  error (see O-01 for what replaces it).

#### How a map is won

- **Answer (maintainer, 13 November 2026):** 12 rounds, first to 7; at 6–6 a best-of-3 overtime,
  so 8–6 or 8–7. Stored as a setting so other games can differ.

#### Screenshot when staff enter a result

- **Answer (maintainer, 13 November 2026):** optional for staff. It stays mandatory when a team
  reports.
