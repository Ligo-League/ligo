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

#### O-02 · Teams that stopped playing

- **Question:** Nightwolves (8 forfeits, no match played), Outsouki (6 forfeits) and Nova 1 Esport
  (7 forfeits) have forfeits entered on score7 for weeks that are not played yet. Have these teams
  left the league? If so, were they excluded by the staff or did they withdraw, and does the
  league treat the two cases differently?
- **Why it matters:** decides how an exclusion or a withdrawal is recorded, and what happens to
  the matches the team already played (see O-04).
- **Until answered:** each of those matches is an ordinary forfeit: 3 points for the opponent, no
  rounds.
- **Answer (partial, maintainer, 14 November 2026):** Nightwolves and Outsouki are excluded.
  Nothing official has been said about Starly or Nova 1 Esport, and the rules are enforced
  loosely, so no conclusion is drawn for them. (On the maintainer's local database, Ligo excluded
  Starly automatically at its 3rd recorded forfeit; staff can undo it with
  `/staff exclusion reinstate`.) Still open: are Starly and Nova 1 excluded?

#### O-27 · The score of a forfeit made by the 50% rule

- **Question:** a no-show is 7–0 (answered below). What score does a forfeit get when the 50% rule
  creates it for an excluded team: 7–0 as well, or 0–0?
- **Why it matters:** the score feeds rounds won and lost, so the difference that breaks ties.
- **Until answered:** the same as a no-show, 7–0. It is its own season setting,
  `exclusion_forfeit_score`, so a different answer is a change of setting, not of code.
- **Answer (partial, maintainer, 14 November 2026):** a team that does not show up loses 7–0, in
  Season 3 and probably in Season 4: the team that showed up must not lose on difference. It is a
  setting (`forfeit_score`). The maintainer was wrong on 13 November ("no rounds").

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

#### O-34 · Which R6 rank the league reads

- **Question:** from Season 4, R6 has two ranked queues, Solo/Duo and Flex. Which one does the LFR
  read at registration and in its eligibility rules: Solo/Duo, Flex, the higher of the two, or
  whichever the player chooses to show?
- **Why it matters:** registration copies a rank onto the roster entry (design doc section 4), and
  any rank limit in the rulebook needs to name a queue.
- **Until answered:** players may fill both on `/me` and pick the one shown; registration copies
  the shown one. No rank limit is enforced.
- **Answer:**

#### O-35 · The mercato's moves

- **Question:** the rulebook gives 3 moves per team per window and a one-day block, but not:
  1. what counts as one move: is a swap (one player in, one out) one move or two? Do a starter
     becoming a substitute, or a change of captain, count?
  2. what the one-day block blocks: the transferred player playing any official match for 24 hours
     after the move is approved?
  3. whether the incoming player must accept the move with their own account (as with a roster's
     invitation link), or whether the official's request is enough;
  4. who opens a window and for how long, and whether the schema's `lock_hours` is the one-day
     block or something else;
  5. whether a team can change a player outside a window at all, for example with an exception
     granted by staff.
- **Why it matters:** the mercato (phase 3f) counts moves against the window's limit, blocks
  players and decides what the request form asks.
- **Until answered:** the mercato is not built; the moves between rosters of one club are M-22.
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

#### M-38 · Standings for a title scored in games

- **Question:** for a title with no round or goal score (score unit `games`, such as League of
  Legends), what do F and C count: games won and lost across the season, so a BO1 win is 1–0?
  And which tie-breakers make sense when every BO1 difference is 1?
- **Why it matters:** the standings engine reads F, C and D from the score unit (design doc
  sections 5 and 12).
- **Until answered:** no such league exists; nothing is built. R6, Valorant (rounds) and Rocket
  League (goals) are unchanged.

#### M-37 · The MVP of a round

- **Question:** how is a round's MVP chosen?
- **Options:** (a) most kills, ties broken by the opening kill, then a plant or defuse, then
  survival; (b) a weighted score of kills, opening kill, clutch won, plant or defuse and trades;
  (c) the impact rating of design doc section 9 (win probability added), once it exists.
- **Until answered:** the design mockups use (b) as a stand-in, to be replaced by (c) when the
  impact rating exists. Nothing is built.

#### M-36 · Stats in the Privacy Policy: the edge cases

- **Decided (16 November 2026):** sharing player stats is in Ligo's Privacy Policy and terms of
  use, which every account must accept. It is a hard requirement, not a per-player setting.
- **Questions left:** (1) can a player withdraw it, and does that close the account or only hide
  the stats (GDPR treats consent as withdrawable; another legal basis, such as the contract, may
  fit better, to check with whoever writes the policy); (2) players seen in a replay or a lineup
  who have no account yet: are their stats stored and hidden until they sign up, or not stored;
  (3) accounts created before the policy: asked to accept at next login, stats hidden until then;
  (4) does a new policy version need a new acceptance.
- **Until answered:** `stats_consent_at` keeps its role, set when the policy is accepted; a player
  without it shows no stats; nothing is withdrawn automatically.

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
- **Answer (partial, maintainer, 14 November 2026):** three levels: tier (division) staff,
  competition staff, and group staff (MBL Group, every competition). Each level can do what the
  levels below it can. Still open: how tier and group staff are held. Proposal: a Discord role
  per level in each competition's server (a division's role, the competition's role), and for the
  group a list of people kept in Ligo, since the group spans several servers.

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
- **Answer (maintainer, 14 November 2026, partial):** formats are settled: one design rendered in
  every frame (square, portrait 4:5, landscape 16:9, link preview, and stories later). Posting
  to social networks is a mode per network that each competition sets, `manual` by default
  (design doc section 11). Still open for the owner: which images the bot posts in Discord on
  its own (the day's matches each morning, the week's schedule, "game on"), and whether LFR
  wants any network in `approve` or `auto`.

#### M-20 · Who opens the admin panel

- **Question:** who may open each level of the admin panel (design doc section 7)? A
  competition's staff, from their Discord role, for the competition and its leagues? And for
  the organisation level (MBL Group: its competitions and Discord servers), a list of
  organisation admins kept in Ligo, or the owners of the Discord servers?
- **Why it matters:** the staff role itself is a setting of the panel, so someone must be able
  to set it without already holding it, and a new competition needs someone to create it.
- **Until answered:** nothing; the panel is the last step of phase 3.
- **Answer (partial, maintainer, 14 November 2026):** it follows the staff levels (M-05): tier
  staff open their division, competition staff their competition and its divisions, group staff
  everything. Teams likewise: roster officials their roster, club officials the club and every
  roster. Still open: who holds group staff first, so that someone can set the other roles.
- **Answer (partial, maintainer, 15 November 2026):** a league's Discord settings (its server,
  staff role and invitation link) are changed by whoever may manage its current server in
  Discord: the owner, or the Manage Server permission. A competition created on the website is
  linked to a server by its creator first, so the bot must be installed before.

#### M-22 · Rosters of one club in the same league

- **Question:** in Season 3, Greed has two rosters in Ligue 1 and Nova two in Ligue 2. Is there a
  limit on rosters of one club per division? May a player move between rosters of the same club
  during a season, and does that count as a mercato move? In a match between two rosters of one
  club, may a club official report the result for one side and confirm it for the other?
- **Why it matters:** registration checks, the mercato, and the permission check on match
  actions: today someone acting for both sides counts for side A.
- **Until answered:** no limit per division (a setting, empty by default). A move between rosters
  of one club is an ordinary mercato move. In a match between two rosters of one club, club
  officials may act for neither side: each roster's own officials report and confirm.
- **Answer (partial, maintainer, 14 November 2026):** several rosters of one club in a division
  must be possible (Greed Academy won Ligue 2 in Season 3 and was promoted next to Greed), with
  the limit as a setting. Moves between rosters of one club must be settings too, to cover the
  possible cases: a move like any other mercato move, a player of the academy standing in for some
  matches of the main roster, or a promotion from the academy to the main roster. A season of
  almost three months is long for a grassroots team to keep the same five. Still open: those
  settings' exact values, designed with the mercato (phase 3f). The intra-club match rule is kept.

#### M-23 · The Ubisoft account at registration

- **Question:** R6 players are identified by their Ubisoft `profileID`, but a player knows their
  Ubisoft name, not that ID, and Ubisoft offers no login other sites can use. How does a player's
  `profileID` get into Ligo?
- **Why it matters:** the registration form (phase 3d), and matching players in replays (phase 5).
- **Options:** (a) the player types their Ubisoft name; the first replay of their roster in which
  that name appears pins the `profileID` (phase 5), and staff confirm it. (b) Ligo looks the name
  up through Ubisoft's unofficial web API, which needs a Ubisoft account for the server and can
  break without notice. (c) The player uploads one of their own replays to prove the account.
- **Until answered:** (a): the Ubisoft name is stored as declared, unverified, with no
  `profileID`.
- **Answer (partial, maintainer, 14 November 2026):** option (a) as the base: it takes a while to
  run, then works on its own. Names change, often to add a team tag (Nivalem → Nivalem.RCK), so a
  player may also give their `profileID` directly: Ubisoft Connect shows it. Option (c) is a
  fallback, too tedious to require. Still open: how other Discord bots and tracker sites find a
  `profileID`, to look at before phase 5. Until then the form asks for the Ubisoft name, and the
  `profileID` when the player has it; neither is verified before a replay confirms it.
- **Settled for registration (maintainer, 14 November 2026):** each player enters their own
  Ubisoft name, `profileID` and rank on `/me`; the filer of a registration declares nobody.

#### M-24 · Funding: sponsors, legal structure and licences

- **Question:** is there a sponsor for Ligo itself? Which legal structure receives the money
  (an ASBL in Belgium, a loi 1901 association in France)? Do French law on paid video game
  competitions and each publisher's community competition licence (Riot's for LFV above all)
  allow a paid tier and donations to fund prize pools?
- **Why it matters:** the paid tier and donations of design doc section 18; no money can be taken
  before these are answered.
- **Until answered:** nothing is built; Ligo is free and takes no money.
- **Answer (partial, maintainer, 14 November 2026):** Ligo becomes a Belgian ASBL with a second
  founder once the platform runs well enough; the ASBL receives all the money, pays the
  maintainer for the work, and gives the rest to partnered leagues as sponsorship. If donations
  cover everything, there is no paid tier. Prize pools are funded only in titles whose licence
  allows it. Still open: a sponsor; the licence of each title (R6, Valorant, Rocket League),
  and whether Ligo supports titles whose licence forbids funding prizes; whether French law on
  paid competitions applies when a Belgian ASBL funds prizes in a French league; which public
  funding to apply for (design doc section 18).

#### M-25 · Automatic social posting in the paid plan

- **Question:** does the league plan of design doc section 18 unlock automatic posting (`approve`
  and `auto`) for X only, or for every network? Or does it stay free, since the league already
  pays X itself through its own developer app?
- **Why it matters:** the rule is that users pay for what costs money. Posting to X costs money
  for each post, but that money goes to X from the league's own app, not from Ligo; what Ligo
  carries is building and keeping the adapters working (X and Meta change their APIs and token
  rules often). Charging for X only follows the rule; charging for every network charges for
  posts that cost nothing to send.
- **Until answered:** nothing is built (phase 9). The `manual` mode, the images page and the
  share button are free in every case.
- **Answer (partial, maintainer, 14 November 2026):** leaning towards the plan unlocking X only.
  Still open: whether to charge at all while the league pays X itself, and the price.

#### M-26 · A post whose result changes

- **Question:** when a result already posted to a social network is corrected or voided, what
  does Ligo do: delete the post, post a correction that replies to it, or leave it and only tell
  staff?
- **Why it matters:** results are never hard-deleted in Ligo, but a public post with a wrong
  score stays visible on the network. Deleting is quiet but loses the post's likes and replies; a
  correction is honest but adds a post, which costs money on X.
- **Until answered:** Ligo never deletes or posts anything by itself after a correction. The
  waiting time of `auto` lets staff cancel a post before it goes out, and when a posted result
  changes, staff are told with a link to the post.
- **Answer:**

#### M-27 · Who answers a club's request

- **Question:** a club may have rosters in several competitions (LFR and LFV, say). A request
  about the club itself (handing it over, adding or removing a club manager) is filed through one
  of its rosters: which staff answer it? The staff of that roster's competition, the group staff
  (M-05), or should club changes apply at once, since they are the club's business?
- **Why it matters:** the request is stored with one competition, and that competition's staff
  approve it; the others may not hear of it.
- **Until answered:** the request belongs to the competition of the server where it is filed,
  and its staff answer it, with the approval settings of club changes being those of team changes.
- **Answer:**

## Answered

#### M-35 · A roster's players during a season under way

- **Question:** a roster playing a season under way changes its lineup only in a mercato window
  (M-29). Is its own list of players, which prepares its next registration, closed too? Closed,
  a Season 3 roster could not gather its Season 4 players before Season 3 ends.
- **Answer (decided by Claude at the maintainer's request, 15 November 2026; open to change):**
  the roster's own players stay open all year: the list is a preparation and changes nothing
  being played. Only a season's lineup (`roster_entry`), who may play its matches, follows the
  mercato. A player joining a roster during a season does not play for it that season.

#### M-34 · How many players a roster in no competition may have

- **Question:** a roster in no competition has no league setting for its size. How many players
  may it have before registering (the filer then picks the lineup among them)?
- **Answer (maintainer, 15 November 2026):** a setting of the group, 10 players by default.

#### M-33 · A club and its rosters before any competition

- **Question:** people must be able to create a club and a roster that belong to no competition,
  and set them up for the next season before asking a league to approve them (maintainer,
  15 November 2026). Today the club and roster only exist once staff approve a registration. What
  can be set up before (officials, players), and does a registration then enter an existing
  roster with its players?
- **Why it matters:** the registration flow (3d-4 to 3d-7) creates the club and the roster at
  approval; this moves their creation earlier, and changes what approval does.
- **Answer (maintainer, 15 November 2026):** anyone logged in creates a club and rosters on the
  website, in no competition, and sets up each roster's officials and players; players join
  through an invitation link and complete their own profile, as today. No mercato limit applies
  to a roster in no competition. The registration form then offers the rosters the filer leads
  (or a new one); the roster's players are the registration's lineup, checked as today, and the
  filer sets starters and the captain. Any official who may register the roster (not the
  coach) may change the lineup or withdraw the registration, not the filer only (maintainer,
  15 November 2026). Approval adds the slot and the season's roster entries; it
  no longer creates the club and roster. Built right after 3e-2.

#### M-32 · Telling the other team about what is done on the website

- **Question:** when a team acts on the website (proposes a time, reports a result, starts a
  veto), there is no Discord channel to reply in, as there is for a bot command. How does the
  other team hear about it on Discord, until phase 4 brings match channels?
- **Answer (maintainer, 15 November 2026):** a post in the league's schedule channel, mentioning
  the other side's officials and captain, with the same buttons as the bot's own messages.

#### O-30b · The captain for one match

- **Question:** when a team's captain cannot play a match, another player is captain for that
  match (O-30). Who names that player, and does the usual captain keep acting for that match?
- **Answer (maintainer, 15 November 2026):** the team's officials or its usual captain name a
  starter or a substitute of the roster, until the result is reported. The usual captain keeps
  acting too; the stand-in is added for that match only.

#### O-32 · When lineups lock before the season

- **Question:** how many days before Season 4 starts are LFR lineups locked? From then on, a
  lineup changes only during a mercato window.
- **Answer (maintainer, 15 November 2026):** 0 days: lineups may change until the season starts
  (`lineup_lock_days`, a setting).

#### O-33 · How the minimum age is checked

- **Question:** LFR requires players to be 16 or older (O-31). On which date must they be 16, and
  is a birth date needed, or is a declaration enough?
- **Answer (maintainer, 15 November 2026):** each player gives their birth date on `/me`; nobody
  else sees it (staff see only whether the player is old enough); the age counts on the season's
  first day.

#### M-31 · Eligibility settings other leagues need

- **Question:** the Benelux league needs players aged 18 or older, at least 3 starters living in
  the Benelux, PC only, and a club based in the Benelux (O-31). Are these built with LFR's age
  check, or when the Benelux league comes to Ligo?
- **Answer (maintainer, 15 November 2026):** only the minimum age is built now, as a setting; the
  design document lists the others as settings to come.

#### O-29 · One player in two registrations

- **Answer (maintainer, 14 November 2026):** a player may be on rosters of several teams only if
  those rosters do not play in the same competition. Every division of a competition counts as
  one, since promotion and relegation join them. Playing the same game in two competitions of
  the group is allowed. This is a hard rule, not a setting. Joining a registration is refused
  for it, and staff refuse a team's entry for it at approval.

#### O-30 · Who may be captain

- **Answer (maintainer, 14 November 2026):** only a starter may be captain, since the captain is
  part of the main roster. When the captain cannot play a match, another player of the match's
  lineup becomes a temporary captain for it (with M-19, in the match steps).

#### O-31 · Conditions on players

- **Answer (maintainer, 14 November 2026):** LFR requires players aged 16 or older, nothing else.
  Other leagues have other conditions, so they are settings. The Benelux league, for example,
  requires players aged 18 or older, at least 3 starters living in the Benelux, PC only, and a
  club based in the Benelux. How age is checked: O-33. When the other settings are built: M-31.

#### M-29 · When staff see a registration, and changes after it

- **Answer (maintainer, 14 November 2026):** staff see a registration as soon as it is filed,
  without a notification. Its lineup may change until a set number of days before the season
  starts (`lineup_lock_days`, a setting; LFR's number: O-32), then only during mercato windows. A
  league without mercato windows changes lineups only between seasons; that period is always
  open.

#### M-30 · Membership of the league's Discord server

- **Answer (maintainer, 14 November 2026):** yes. A player who is not a member of the league's
  Discord server cannot join a registration: Ligo says so, with the server's invitation link, and
  accepts them once they have joined.

#### M-28 · Looking a player's rank up

- **Question:** could Ligo read each player's R6 rank from a tracker (R6 Tracker Network), stored
  and refreshed whenever someone looks at it?
- **What was found:** scraping r6.tracker.network is against its terms and behind Cloudflare;
  Tracker Network's public API does not clearly cover R6; R6 tools read Ubisoft's unofficial API,
  which needs a Ubisoft account login on the server and can change without notice; hosted
  services (r6data) need a key and have unknown terms. All of them need the player's `profileID`.
- **Answer (maintainer, 14 November 2026):** not worth it if it is not reliably possible. Each
  player declares their rank on `/me` and keeps it up to date themselves.

#### O-28 · Both teams forfeit

- **Question:** two teams that are not excluded both fail to show up. What is recorded: a forfeit
  loss for both (0 points each, counted as played and as a forfeit for each, towards the warning
  and the exclusion), the match cancelled, or something else?
- **Why it matters:** Ligo records one team per forfeit. score7 has the same limit, which is why
  staff typed a 0–0 draw for two excluded teams (O-01).
- **Until answered:** staff can record a forfeit for one team only, or leave the match without
  result.
- **Answer (maintainer, 14 November 2026, leaving the choice to Ligo "as long as it is fair"):**
  each team gets a forfeit loss, exactly what it would get had it forfeited alone: 0 points, the
  losing side of the forfeit score (0–7 in LFR), a match played, and a forfeit that counts
  towards its warning and exclusion. Nobody wins the match. Both teams failed in the same way, so
  each is treated like any team that does not show up, and no other team gains or loses from it.
  Staff record it with `/staff match forfeit`, `team` set to both teams.

#### O-01 · Nightwolves against Outsouki, week 5

- **Question:** score7 shows this match as a 0–0 draw with one point each. A draw cannot happen,
  so this is an entry error. Which team forfeits? If neither team played, what should be
  recorded: a loss for both, no result at all, something else?
- **Why it matters:** it is the only difference left between Ligo's tables and score7's. Giving
  either team the win awards 3 points to a team that seems to have left.
- **Until answered:** the match has no result in Ligo. Both teams show one match and one point
  fewer than on score7.
- **Answer (maintainer, 14 November 2026):** both teams had been excluded, and score7 cannot
  record a forfeit by both sides, so staff typed a 0–0 draw. The match has no result in Ligo:
  under the 50% rule, a match between two excluded teams counts for neither. Two teams that are
  not excluded and both forfeit each get a forfeit loss (O-28).

#### O-26 · Where a new roster starts

- **Answer (maintainer, 14 November 2026):** a newly registered roster usually starts in Ligue 2.
  When too many teams leave Ligue 1, staff may place new rosters directly in Ligue 1. A roster
  that does not come back loses its division's place: returning, it registers again like a new
  roster. It is a grassroots league: strong teams leave for higher levels and others split up, so
  the rules must expect places to free up between seasons.

#### M-19 · What the captain may do

- **Question:** from phase 3, each team has one captain, who must be a player. May the captain
  act for the team in matches (propose a time, run the veto, report and confirm a result) like
  its officials, or is the captain only a title on the roster?
- **Why it matters:** the permission check on match commands, and the roster form (phase 3).
- **Until answered:** rosters are not in Ligo yet; only the owner, managers and coach act.
- **Answer (maintainer, 14 November 2026):** the captain acts for the roster in matches like its
  officials: proposes and accepts a time, runs the veto, reports and confirms a result. By default
  it is the captain's job, but an official can always do it too.

#### M-21 · Clubs and rosters: what belongs where

- **Question:** a team is a club with one or more rosters (design doc section 4). Which details
  belong to the club and which to each roster: name, tag, logo, colours, city, legal status,
  socials, team Discord, streaming? How is a roster shown in standings: its own name ("GREED
  Academy"), or the club's name and the roster's ("Not Scam Katsuki")? Can one club have rosters
  in several titles (an R6 roster in LFR, a Valorant one in LFV)?
- **Why it matters:** the `club` table and the registration form (phase 3d).
- **Until answered:** the club holds the city, legal status, socials, team Discord, and the
  default logo and colours; each roster has its own name and tag, and may have its own logo and
  colours. A roster is shown by its own name. A club belongs to the group and may have rosters in
  any of its competitions.
- **Answer (maintainer, 14 November 2026):** the defaults, as they are. A club usually has a main
  roster and an academy roster per game, so a club has rosters in several titles.

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
- **Corrected (maintainer, 14 November 2026):** a forfeit is 7–0 in rounds, not "no rounds"
  (O-27).

#### Draws

- **Answer (maintainer, 13 November 2026):** a draw never happens. The one on score7 is an entry
  error (see O-01 for what replaces it).

#### How a map is won

- **Answer (maintainer, 13 November 2026):** 12 rounds, first to 7; at 6–6 a best-of-3 overtime,
  so 8–6 or 8–7. Stored as a setting so other games can differ.

#### Screenshot when staff enter a result

- **Answer (maintainer, 13 November 2026):** optional for staff. It stays mandatory when a team
  reports.
