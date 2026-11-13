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
- **Answer:**

#### O-05 · Exclusion at the third forfeit

- **Question:** the rulebook gives a warning at the 2nd forfeit and exclusion at the 3rd. Is the
  exclusion automatic, or does the staff decide each time? Starly Esport Club has 4 forfeits on
  score7 and still has matches to play.
- **Why it matters:** whether the bot may exclude a team by itself. Blocks the exclusion command
  (phase 2).
- **Until answered:** the bot will add the warning automatically at the 2nd forfeit and only
  alert the staff at the 3rd.
- **Answer:**

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

#### O-07 · Who reports for a team

- **Question:** who may report and confirm results for a team: its manager only, or its staff
  members too (the rulebook allows one manager and up to three staff)? May players do it?
- **Why it matters:** the permission check on team commands (phase 2).
- **Until answered:** the manager and the team's staff can; players cannot.
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

### Scheduling, sides and the map veto

#### O-10 · Current map pool

- **Question:** which nine maps are in the pool this season?
- **Why it matters:** the map veto cannot run without it (phase 2b).
- **Until answered:** the pool is empty and there is no veto.
- **Answer:**

#### O-11 · Ban order

- **Question:** BLAST changed its map-ban process for 2026. Does LFR follow the new BLAST order,
  or keep alternate bans down to one map for a BO1?
- **Why it matters:** the veto sequences (phase 2b). They are settings, so a change is cheap, but
  the default must be right for Season 4.
- **Until answered:** alternate bans down to one map for a BO1; the usual R6 sequences for BO3
  and BO5.
- **Answer:**

#### O-12 · Side choice between teams of equal rank

- **Question:** the lower-ranked team picks the starting side and bans first, and the
  higher-ranked team hosts. What happens when both teams have the same rank, for example in
  week 1 when nobody has played?
- **Why it matters:** the bot announces who picks and who hosts for every match (phase 2b).
- **Until answered:** not built yet.
- **Answer:**

#### O-13 · Deadlines

- **Question:** when two teams agree on no date, the rulebook grants one extra week, then sets
  the match to Sunday 21:00 of the second week. Is this still the rule for Season 4, and is
  Sunday 21:00 French time?
- **Why it matters:** automatic scheduling (phase 2b).
- **Until answered:** not built yet; these values will be settings.
- **Answer:**

#### O-14 · Re-hosts

- **Question:** is the allowance one re-host per team per map, and can the staff order more?
- **Why it matters:** the re-host command and the check that rebuilds a map from several lobbies
  (phase 5).
- **Until answered:** not built yet.
- **Answer:**

### End of season and the cup

#### O-15 · Barrages

- **Question:** in which format are the barrages played (BO1, BO3, BO5), and when: before the
  Coupe de France, during it, or after?
- **Why it matters:** season closing (phase 6).
- **Until answered:** not built yet.
- **Answer:**

#### O-16 · Promotion and relegation places

- **Question:** should the places be fixed ranks ("9th and 10th go down") or counts from the top
  and the bottom ("the last two go down"), given that a division's size can change? Is there a
  maximum size per division?
- **Why it matters:** season closing (phase 6); see also O-03.
- **Until answered:** not built yet.
- **Answer:**

#### O-17 · Coupe de France: sides and seeding

- **Question:** which team picks the starting side in a cup match (a formal rule was expected for
  Season 4)? Is the bracket drawn at random, or seeded by league and final rank?
- **Why it matters:** the cup bracket (phase 6).
- **Until answered:** not built yet.
- **Answer:**

#### O-18 · National leagues

- **Question:** when National launches: which regions, and how many teams qualify for its
  playoffs?
- **Why it matters:** only once the owner launches it (phase 9).
- **Until answered:** not built.
- **Answer:**

### Season 4

#### O-19 · Start date

- **Question:** when does Season 4 start, and when does registration open?
- **Why it matters:** it sets the deadline for everything teams must be able to do on the
  platform.
- **Until answered:** the roadmap assumes late December or early January at the earliest.
- **Answer:**

#### O-20 · Replays and stats consent

- **Question:** will uploading replays be mandatory in Season 4 (at least one team per match)?
  Will accepting public player statistics become a rulebook requirement at registration?
- **Why it matters:** whether replay upload must be ready for Season 4 (decision due
  mid-December), and whether every player appears on stat pages.
- **Until answered:** replays are optional and stats need each player's consent.
- **Answer:**

### Team tools

#### O-21 · Scouting pages

- **Question:** may each team's tendencies from official matches (map bans, maps played, sites,
  operators) be shown publicly, only to registered teams, or not at all?
- **Why it matters:** the tendencies page (phase 10).
- **Until answered:** not built; it will be a setting.
- **Answer:**

#### O-22 · Recruitment board

- **Question:** may a player who is on a roster post that they are looking for a team? Does the
  rulebook say anything about approaching players of another team?
- **Why it matters:** the recruitment board (phase 10).
- **Until answered:** not built; by default only players without a team could post.
- **Answer:**

## For the maintainer

#### M-01 · Hosting for the first test with real teams

- **Question:** phase 2 is done when a full week of results comes in through teams. The bot must
  be online that whole week. Your PC left on, or the VPS now?
- **Why it matters:** the first hosting trigger. No domain is needed until the website (phase 3).
- **Until answered:** everything runs on your PC while `pnpm dev` is running.
- **Answer:**

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

#### M-07 · Image templates without JSX

- **Question:** the design doc says image templates are JSX components, but the server runs
  TypeScript directly, which has no JSX. Keep building them as plain element trees, or add a
  build step?
- **Why it matters:** must be decided before the website (phase 3), which wants JSX pages.
- **Until answered:** templates are plain element trees.
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

#### M-15 · Announcing results entered by staff

- **Question:** a result validated from a team's report is announced in the results channel. A
  result typed directly by staff with `/staff match result`, or a forfeit, is not. Should they be?
- **Why it matters:** teams may expect every result in that channel.
- **Until answered:** only validated reports are announced.
- **Answer:**

## Answered

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
