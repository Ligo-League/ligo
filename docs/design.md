# LFR League Platform — Design Document

Nov 12, 2026 · @Higginson Julien

## 1. Scope and glossary

The platform runs LFR's competitions end to end: schedule, Discord match channels, results, standings, stat pages and images. It replaces score7. Replays add detailed stats wherever a parser exists (R6, Rocket League on PC); everything else uses manual entry.

**In scope, in priority order**

1. LFR (R6) results and standings: Ligue 1 and Ligue 2 (10 and 12 teams in Season 3, round robin, BO1), the regional National leagues (BO3), promotion, relegation and barrages, and the Coupe de France knockout cup.
2. A Discord bot in each league's own server: slash commands, match channels, reminders, standings and stat images.
3. Website: public standings, fixtures, brackets and stats; Discord login; team registration with rules acceptance; mercato; replay, MOSS and screenshot uploads; manual stat entry; staff validation and sanctions.
4. R6 replays parsed in the player's browser (WebAssembly), producing per-round stats, with the same parser on the server for verification.
5. The group's other leagues: LFV (Valorant), LFRL (Rocket League) and FRFL (FACEIT mixed-team R6), with manual stats wherever no replay route exists.
6. Team development tools, R6 first: a private practice book for scrims and friendlies, a playbook, team reports, scouting, a recruitment board, external results, a team level and awards (section 17).
7. Other organisations, much later.

**Out of scope for v1:** public self-service signup for other leagues, live in-match tracking (a desktop companion app is a long-term idea if the league grows), mobile apps, fantasy or betting features, and the Valorant API before Riot grants a production key.

**Glossary**

| Term           | Meaning                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Org            | The group running the leagues (LFR, LFV, LFRL, FRFL); the tenant every record belongs to                                        |
| Title          | The video game: `r6`, `valorant`, `rocket_league`; `lol` and `cs` are reserved for later                                        |
| Competition    | One league in one title (LFR, LFV, LFRL, FRFL) with its own rules and its own Discord server                                    |
| Season         | A time-boxed edition of a competition (LFR Season 3 started 19 October 2026)                                                    |
| Division       | A tier or region inside a season: Ligue 1, Ligue 2, a National region                                                           |
| Slot           | The rulebook's SLOT: a team's sporting and administrative place in a division; it can be transferred with staff approval        |
| Stage          | A phase with one format: round robin, National playoffs, barrage, Coupe de France                                               |
| Barrage        | A play-off between a higher-tier and a lower-tier team for a place in the higher tier                                           |
| Match          | A fixture between two lineups                                                                                                   |
| Game           | One map (R6, Valorant) or one game of a series (Rocket League) inside a match                                                   |
| Lineup         | The players who played for one side of one match; linked to a team in team leagues, standalone in mixed leagues                 |
| Segment        | The replays of one lobby, identified by r6-dissect's `matchID`; a re-hosted map has several                                     |
| Round facts    | Per-player, per-round stats derived from R6 replays                                                                             |
| Stitch plan    | The mapping from segment rounds to a game's official round list                                                                 |
| MOSS           | Anti-cheat capture file each team must submit for every match                                                                   |
| Mercato        | A transfer window; the only time rosters may change                                                                             |
| Practice match | A scrim, friendly or cross-league match a team records for itself; private to that team and outside every standing (section 17) |
| Workspace      | A team's private pages: practice book, playbook and team report                                                                 |
| Strat          | A named plan in a team's playbook, tagged on rounds to get its win rate                                                         |

## 2. Constraints and verified facts

Five facts drive most decisions: replays are far too large for Discord, team names inside replays are unreliable, usernames change, the budget is about €5–10 a month, and non-R6 titles need manual stats.

| Fact                    | Value                                                                                                                                                                                                                                                                                               | Consequence                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| R6 round file size      | 6.4–14.4 MB per `.rec` (measured on r6-dissect's test replays); zip saves about 5%                                                                                                                                                                                                                  | A 12-round map is about 100–170 MB. Parse in the browser; upload raw files in the background, straight to object storage |
| R6 local replay storage | The game deletes replays in its folder when they exceed 12 ([source](https://rainbowsix.fandom.com/wiki/File:Match_Replay_Overview_-_6News_-_Rainbow_Six_Siege))                                                                                                                                    | Upload right after the match; never rely on asking for a file weeks later                                                |
| Discord upload limit    | 20 MB per file for free accounts since August 2026; 50 MB at Boost Level 2, 100 MB at Level 3 ([source](https://neowin.net/news/discord-raises-file-size-upload-limit-for-its-non-subscribers/))                                                                                                    | Discord carries links, screenshots and images, never replays                                                             |
| Parsed replay size      | 6–8 KB of JSON per round                                                                                                                                                                                                                                                                            | Keep parsed data forever                                                                                                 |
| Team names in replays   | Typed by the lobby host in custom games (test replay: "JAY" vs "GOHLY"); "YOUR TEAM" / "OPPONENTS" in ranked                                                                                                                                                                                        | Identify teams from players' `profileID`s against lineups, never from names                                              |
| R6 player identity      | `profileID` (Ubisoft account UUID) is in every round header; usernames change                                                                                                                                                                                                                       | Key R6 players by `profileID`                                                                                            |
| Kill-feed clock         | `timeInSeconds` is the in-game clock counting down (feed order 154, 122, 121, 110…); it switches to the defuser countdown after a plant                                                                                                                                                             | Order events by feed position, never by clock value; derive an elapsed time                                              |
| Re-hosts                | A new lobby gets a new `matchID` and folder; round numbers and in-lobby score restart; team indices can swap. The rulebook keeps the score from before the restart                                                                                                                                  | A stitching step rebuilds each map's round list (section 8)                                                              |
| Browser parsing         | Client-side output can be forged                                                                                                                                                                                                                                                                    | Results stay screenshot-backed and staff-validated; raw files are re-parsed on the server (section 8)                    |
| Discord modals          | At most 5 inputs per modal                                                                                                                                                                                                                                                                          | Registration, mercato forms and stat sheets live on the website                                                          |
| Discord channels        | 500 per server, 50 per category                                                                                                                                                                                                                                                                     | One category per week; archive and delete at season end                                                                  |
| Discord servers         | One per league: LFR, LFV, FRFL, LFRL                                                                                                                                                                                                                                                                | One bot instance; each server maps to one competition                                                                    |
| Budget                  | About €5–10 per month                                                                                                                                                                                                                                                                               | One small VPS plus Cloudflare R2 (section 13)                                                                            |
| Valorant replays        | Added in patch 11.06; they expire when the game updates ([Riot](https://support.riotgames.com/ms-my/valorant/gameplay/replays-faq-pro-tips)); custom-game coverage is reported as missing as of November 2026 ([source](https://insights.gg/blog/valorant-replay-system-how-to-watch-save-replays)) | Valorant stats stay manual for league matches                                                                            |
| Valorant API            | Personal and development keys get no VALORANT access; a production key is required ([source](https://www.riotgames.com/en/DevRel/valorant-api-launch))                                                                                                                                              | Apply later with a tournament use case                                                                                   |
| Rocket League replays   | PC only; consoles give no access to replay files ([source](https://ballchasing.com/doc/faq))                                                                                                                                                                                                        | Browser parsing for PC players, manual entry otherwise                                                                   |

## 3. Architecture

One TypeScript server process runs the bot, the website and the league engine. A separate worker process verifies replays and renders images. SQLite holds all state; Cloudflare R2 holds raw replays and database backups.

&#91;embedded content: system architecture · 2 processes, 1 database, R2\]

The server is the only process that talks to Discord. The worker and the server share the SQLite database, and the job table is the only interface between them.

**Processes**

- **server**: the discord.js gateway client (one bot in every league's Discord server), the Hono HTTP server (pages, JSON API, upload signing, Discord OAuth), the league engine and the image renderer. It is the only process that talks to Discord.
- **worker**: polls the `job` table; re-parses raw replay files with the same WebAssembly parsers the browser used, to verify submitted JSON; stitches games; renders images. It is separate so a slow or crashing parse never stalls the bot.
- **caddy**: TLS and reverse proxy in front of the server.
- **litestream**: streams the SQLite write-ahead log to R2 continuously.

Replays are parsed in the uploader's browser by WebAssembly builds of each title's parser. The browser sends compact JSON to the server and uploads the raw files straight to R2 with presigned URLs, so the VPS never receives the 100–170 MB per map.

**Stack**

| Concern               | Choice                                                                                                    | Why                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Language and runtime  | TypeScript on the current Node LTS                                                                        | Best Discord library, Satori is JavaScript-only, one language for bot, web, engine and stats |
| Discord               | discord.js                                                                                                | Most complete coverage of slash commands, buttons, modals, permissions                       |
| HTTP                  | Hono with server-rendered JSX                                                                             | Small, fast, one process with the bot                                                        |
| Browser interactivity | htmx for forms; small Preact islands for the uploader and the stat grid                                   | No SPA framework to maintain                                                                 |
| Replay parsing        | Each title's parser compiled to WebAssembly, run in a Web Worker in the browser and in Node on the server | One parser build, two places; no native binaries on the server                               |
| Database              | SQLite in WAL mode, better-sqlite3, Drizzle ORM and drizzle-kit migrations                                | Zero-ops, fast, typed schema                                                                 |
| Validation            | zod                                                                                                       | One schema for API input, JSON columns, parser output and stat sheets                        |
| Images                | Satori (layout to SVG) and @resvg/resvg-js (SVG to PNG)                                                   | No headless browser; runs on x86 and ARM                                                     |
| Object storage        | Cloudflare R2 through @aws-sdk/client-s3 and its presigner                                                | S3-compatible, 10 GB free, no egress fees                                                    |
| Ratings (mixed mode)  | openskill                                                                                                 | Team-aware rating without TrueSkill licensing questions                                      |
| Tests                 | Vitest and fast-check                                                                                     | Unit and property tests                                                                      |
| Monorepo              | pnpm workspaces                                                                                           | Shared packages without publishing                                                           |
| Deployment            | Docker Compose                                                                                            | The same file runs on any VPS                                                                |

**Repository layout**

```
lfr-league/
  packages/
    core/        pure TS: round robin, standings, tie-breakers, brackets, forfeits, promotion, stitching (no I/O)
    titles/      one folder per title: metric schema, ruleset defaults, consistency checks, replay normalizer
    parsers/     ParserModule interface + loaders for the WASM builds (browser Web Worker and Node)
    db/          Drizzle schema, migrations, query helpers
    render/      Satori templates, fonts, resvg wrapper
  apps/
    server/      discord.js client + Hono site/API + reconciler, one entry point
    worker/      job runner: verify replays, stitch, render
  parsers/
    r6/          your r6-dissect fork (git submodule) + cmd/wasm entry point + build script
    rocket-league/  boxcars or subtr-actor WASM build (later)
  deploy/        compose.yml, Caddyfile, litestream.yml, restore.sh
```

**Dependency rules**

- `packages/core` and `packages/titles` import nothing with I/O. Every rule of the league is testable without a database or Discord.
- Apps depend on packages, never the reverse.
- Bot commands and website routes call the same service functions in `apps/server/services/`. No logic lives in a command handler.

**Website first, bot for quick access** (decided 13 November 2026)

- The website is the main tool. Every action the bot offers can also be done on the website, which has room for more fields, uploads, replays and explanations.
- The bot is a convenience inside Discord: quick lookups, staff setup without leaving the server, and teams reporting and confirming a result from their voice call right after the match.
- The bot stays feature complete for what it covers: an action started in Discord can be finished in Discord. An action that needs more than a command can carry (registration, mercato, replay uploads, the stat grid) is not squeezed into one; the bot links to its website page.
- Because both call the same services, a new action gets both a command and a page, or the plan says why one of them waits. Until the website exists (phase 3) the bot carries every action; phase 3 adds the website side of those built before it.

## 4. Domain model and database schema

Everything hangs off org → competition → season → division → stage → match → game. Matches are played between lineups, stats are one narrow table for every title, and R6 replay detail lives in its own tables attached to a game.

**Conventions**

- Primary keys are `INTEGER` autoincrement; teams, players and competitions also get a URL `slug`.
- Timestamps are `INTEGER` Unix milliseconds in UTC; display in Europe/Paris. Calendar dates (`starts_on`, `ends_on`) are `TEXT` `YYYY-MM-DD`.
- Discord IDs are `TEXT`: snowflakes exceed JavaScript's safe integers.
- `*_json` columns are `TEXT` validated by a zod schema on every read and write.
- Top-level entities carry `org_id`; children reach it through their parent.
- Results are never hard-deleted: a match or game gets `status = 'void'`.

**Schema v1**

```
-- tenancy, people, teams
org            id, name, slug, locale, settings_json
league_guild   guild_id PK, org_id, competition_id, staff_role_id, alerts_channel_id NULL,
               results_channel_id NULL, mercato_channel_id NULL
player         id, org_id, slug, display_name, discord_user_id UNIQUE NULL, nationality NULL,
               stats_consent_at NULL, created_at
game_account   id, player_id, title, external_id, display_name, rank_at_registration NULL, verified,
               UNIQUE(title, external_id)
               -- r6: profileID UUID; valorant: Riot ID; rocket_league: platform:id
team           id, org_id, title, name, tag, slug, city NULL, legal_status NULL, colors_json, logo_key NULL,
               socials_json, discord_url NULL, can_stream, discord_role_id NULL, UNIQUE(org_id, title, tag)
team_staff     team_id, player_id, role ('manager'|'staff'), since, until NULL   -- 1 manager, max 3 staff
org_ban        id, org_id, player_id NULL, external_account NULL, reason, decided_by, at
               -- cheat list shared by every league of the group
accreditation  id, player_id, kind ('commentator'), granted_by, granted_at, revoked_at NULL

-- rules and registration
rules_version  id, competition_id, version, markdown, voted_at, effective_from
registration   id, season_id, team_id, form_json, status ('draft'|'submitted'|'frozen'|'approved'|'rejected'),
               rules_version_id, accepted_by, accepted_at NULL, reviewed_by NULL

-- competition structure
competition    id, org_id, title, name, slug, participant_mode ('team'|'mixed'),
               ruleset_json, points_json, tiebreak_json, scheduling_json, stat_schema_version, theme_json
season         id, competition_id, name, starts_on, ends_on, settings_json, status ('registration'|'active'|'cup'|'closed')
division       id, season_id, name, kind ('league'|'regional'), level, region NULL, category_prefix,
               results_channel_id NULL
slot           id, division_id, team_id, status ('active'|'frozen'|'withdrawn'|'excluded'),
               forfeits, excluded_at NULL
slot_transfer  id, slot_id, from_team_id, to_team_id, requested_by, approved_by NULL, at
roster_entry   id, season_id, team_id, player_id, role ('player'|'sub'|'coach'), valid_from, valid_to NULL
mercato_window id, season_id, opens_at, closes_at, max_moves_per_team, lock_hours
roster_move    id, window_id, team_id, player_id, direction ('in'|'out'), form_json,
               status ('requested'|'approved'|'rejected'), approved_by NULL, effective_at NULL
stage          id, season_id, division_id NULL, ord,
               kind ('round_robin'|'single_elim'|'double_elim'|'barrage'|'ladder'),
               config_json, status ('draft'|'published'|'closed')
stage_entry    id, stage_id, slot_id NULL, player_id NULL, seed   -- match_slot.source_ref points at id

-- matches and results
match          id, stage_id, week NULL, bracket_node NULL, best_of, host_side NULL, side_chooser NULL, ot_side_chooser NULL,
               status ('scheduled'|'reported'|'confirmed'|'disputed'|'validated'|'forfeit'|'void'),
               window_start, window_end, scheduled_at NULL, auto_scheduled, channel_id NULL,
               reported_by NULL, confirmed_by NULL, validated_by NULL, validated_at NULL
match_slot     match_id, side ('a'|'b'), source_kind ('entry'|'seed'|'winner_of'|'loser_of'), source_ref
lineup         id, match_id, side ('a'|'b'), team_id NULL
lineup_member  lineup_id, player_id, role ('starter'|'sub')
veto_step      match_id, seq, side ('a'|'b'), action ('ban'|'pick'|'decider'|'side'|'ot_side'),
               map NULL, start_side NULL, game_n NULL, at, by_player_id NULL, timed_out
game           id, match_id, n, map NULL, bans_json, score_a, score_b, overtime, forfeit_side NULL,
               rehosts_a, rehosts_b, status ('pending'|'final'|'void'),
               stats_source ('none'|'manual'|'replay'|'api')
evidence       id, match_id, game_id NULL, kind ('score_screenshot'|'moss'|'vod_link'|'other'),
               object_key NULL, url NULL, uploaded_by, visibility ('staff'|'teams'|'public'), at
dispute        id, match_id, evidence_id, reason, details NULL, raised_by, at, resolution NULL
               ('validated'|'rejected'|'voided'|'result_entered'|'forfeit'), resolved_by NULL,
               resolved_at NULL
sanction       id, season_id, target_kind ('slot'|'team'|'player'|'staff'), target_id,
               kind ('warning'|'admin_defeat'|'points'|'forfeit'|'suspension'|'exclusion'|'slot_freeze'
                     |'slot_withdrawal'|'accreditation_removal'|'league_ban'),
               points_delta NULL, match_id NULL, starts_at, ends_at NULL, reason, decided_by

-- stats, level 1 (every title)
stat           game_id, player_id, metric, value REAL, source ('manual'|'replay'|'api'),
               entered_by NULL, verified, PRIMARY KEY (game_id, player_id, metric)

-- replays (title-agnostic envelope) and R6 detail (level 2)
replay_file    id, match_id, uploader_player_id, title, file_name, size, sha256 UNIQUE,
               lobby_id, unit_number, parser_version, parsed_json BLOB,
               raw_status ('none'|'uploading'|'stored'|'deleted'), raw_key NULL,
               verified ('unverified'|'verified'|'mismatch'), created_at
replay_segment id, game_id, lobby_id, started_at, team_map_json, status ('ok'|'needs_review'|'ignored')
segment_round  segment_id, local_n, canonical_file_id, complete, winner_idx NULL, win_condition NULL,
               site, roles_json, pov_count, PRIMARY KEY (segment_id, local_n)
round_player   segment_id, local_n, account_id, side_idx, operator, kills, died, left, assists, headshots,
               opening_kill, opening_death, trade_kills, traded, plant, defuse, survived, clutch_vs, clutch_won
kill_event     segment_id, local_n, seq, elapsed_s, killer_account NULL, victim_account, headshot
game_round     game_id, n NULL, kind ('replay'|'awarded'|'void'), segment_id NULL, local_n NULL,
               winner_side NULL, reason NULL, decided_by NULL

-- mixed-team mode (FRFL)
player_rating  competition_id, player_id, mu, sigma, games

-- operations
job            id, kind, payload_json, status ('queued'|'running'|'done'|'failed'),
               attempts, run_after, locked_until NULL, last_error NULL
audit_log      id, actor_player_id NULL, actor_kind ('user'|'bot'|'system'), action, entity, entity_id,
               before_json NULL, after_json NULL, at
image_cache    key PK, object_key, created_at
```

**Invariants**

- Standings are never stored. They are computed from `validated` and `forfeit` matches plus `sanction` point deltas, then cached by a version counter.
- `game.score_a` and `score_b` are the official score. For replay games they equal the count of `game_round` winners per side.
- In LFR a match counts only once staff have validated it (rulebook: screenshot proof, both teams check, administration validates). `ruleset_json.result_validation` can be `'opponent'` for leagues that don't need the staff step.
- Only staff can record a forfeit. A team can never claim a forfeit win itself.
- A player can be on one roster per competition at a time, and staff members cannot be on any roster in a competition they staff.
- Every staff mutation writes `audit_log` in the same transaction.
- Every stored metric is additive. Averages such as Valorant ACS are converted to totals at entry (ACS × rounds = combat score).
- Players without `stats_consent_at` appear in rosters and results, but their stat pages and leaderboard rows stay hidden.

The team development tools add tables and change three existing ones (practice matches, playbook, listings, external results, awards). Those additions are listed in section 17 and are not part of schema v1.

## 5. League engine

`packages/core` is pure TypeScript: schedules, standings, forfeits, promotion and brackets are functions of their inputs, with no database or Discord access. The LFR rules below come from the Season 3 rulebook, in force since 19 October 2026; anything it leaves open is listed in section 16.

**LFR structure (Season 3)**

| Part             | Teams                 | Format                                                                                                      | Match format                                                                                          | Moves at season end                                                                                                          |
| ---------------- | --------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Ligue 1          | 10                    | Round robin, 1 match per week over 9 weeks                                                                  | BO1, one map after bans                                                                               | 1st: Ligue 1 star. 8th: barrage against L2 3rd (format to confirm). 9th–10th: down to L2                                     |
| Ligue 2          | 12 in Season 3        | Same as Ligue 1                                                                                             | BO1                                                                                                   | 1st–2nd: up to L1. 3rd: barrage against L1 8th. 8th: barrage against the National play-in winner. 9th–10th: down to National |
| National (later) | Per region            | Regional round robin, 1 match per week; small regions can be merged. Not needed until the owner launches it | BO3                                                                                                   | Region winners go to playoffs (single elimination, BO5); semi-final winners up to L2                                         |
| Coupe de France  | Every registered team | Single elimination, starting 1 week after the leagues end; replaces L1/L2 playoffs                          | BO1 before the round of 16; BO3 for the round of 16 and quarter-finals; BO5 for semi-finals and final | Winner: Champion de France                                                                                                   |

**Points and standings**

The rules are split by owner: points and tie-breaks belong to the competition, the forfeit score to the season.

`competition.points_json`:

```json
{
    "outcomes": { "win": 3, "loss": 0 },
    "forfeit": { "winner": 3, "loser": 0, "counts_as_played": true }
}
```

`competition.tiebreak_json`:

```json
{ "criteria": ["points", "diff"], "unresolved_tie": "shared" }
```

`season.settings_json`:

```json
{ "forfeit_score": [0, 0], "map_pool": [] }
```

- Each win is worth 3 points in Season 3, as score7 is set (Season 2 gave 1). There are no draws in R6 competitive settings, so score7's N column is not shown.
- **A forfeit in the table** follows `forfeit.counts_as_played` (default true): a match played for both teams, a win for the opponent and a loss for the team that forfeited. score7 shows its walkovers (W.O.) this way, and they are imported as forfeits.
- score7 shows one Season 3 match as a 0–0 draw worth a point each (Nightwolves against Outsouki, week 5). It is an entry error: a draw never happens. Ligo leaves the match without result until it is corrected on score7, and the next export brings the correction in (section 16).
- F counts rounds won, C rounds lost, and D = F − C. Columns: J, V, D, F, C, D, PTS.
- Ranking: points, then D. Season 2 shows it: Vaevictis and Origin's Esport both have 8 points; D 23 beats D 21.
- **Forfeit score** is a season setting, `forfeit_score`: `[0, 0]` (Season 3) or `[7, 0]` (Season 2). It feeds F and C, so it changes D.
- **Unresolved ties** (same points and same D) follow `unresolved_tie`:
    - `shared`: both teams show the same rank (default);
    - `tiebreak_match`: when the tie touches a place that matters (title, promotion, barrage, relegation, cup seeding), the engine creates a BO1 tie-break match after the last week;
    - `staff_decision`: a recorded manual order.
- BO3 and BO5 appear only in knockout stages, where nothing is ranked by rounds. A future National league phase in BO3 will need its own F/C rule.
- Staff corrections are audited result edits or `sanction` rows, never hand-edited tables.
- For other leagues the engine keeps the generic criteria: `h2h_points`, `h2h_diff`, `score_for`, `wins`, `staff_decision`. Head-to-head is computed only among the tied teams and restarts when a tie partly splits.

**Scheduling (`scheduling_json`)**

1. **Round robin by the circle method.** Shuffle with a stored seed; pair position i with n − 1 − i; keep position 0 fixed and rotate the rest each round. `rounds_per_week: 1` gives 9 weeks for 10 teams. The rulebook's "4 weeks, 2 matches per week" is a Season 2 leftover to correct for Season 4.
2. **Date negotiation.** Teams agree a date and time through `/match propose-time`; the other team accepts with a button.
3. **Extension.** No agreement during the planned week: the bot grants one extra week automatically.
4. **Auto-scheduling.** Still no agreement: the bot sets the match to Sunday 21:00 of the second week and announces it (`auto_scheduled = true`).
5. **Coupe de France.** 7 days to agree and no extension; otherwise Sunday 21:00. A team that doesn't show is disqualified; if neither shows, both are, and the next-round opponent gets a bye.
6. **Sides and host.**
    - League: the lower-ranked team at match time picks the starting side and starts the veto; the other team picks the overtime side; the higher-ranked team hosts.
    - Cup: staff designate the team that picks the starting side (a formal rule is expected for Season 4); the other team picks the overtime side; the teams agree on the host.
    - The bot freezes `side_chooser`, `ot_side_chooser` and `host_side` when the veto starts.

**Map veto**

The veto runs on the website at `/matches/:id/veto`, linked from the match channel's control message. It uses the official competitive map pool and the standard competitive ban sequences.

- **Map pool:** stored per season in `season.settings_json`; staff update it when Ubisoft rotates maps. The current pool has 9 maps.
- **Team A** is the team that picks the starting side (section above). Team A starts the veto.
- **Sequences** are data, not code, so staff can follow a rule change without a release:

| Format | Sequence (9-map pool)                                                                    | Sides                                                                                                                                                |
| ------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| BO1    | A ban, B ban, A ban, B ban, A ban, B ban, A ban, B ban, remaining map played             | A picks the starting side, B the overtime side                                                                                                       |
| BO3    | A ban, B ban, A ban, B ban, A pick, B pick, A ban, B ban, remaining map is the decider   | The opponent of the picker picks the starting side, the picker the overtime side; the team with the better round difference picks the decider's side |
| BO5    | A ban, B ban, A pick, B pick, A ban, B ban, A pick, B pick, remaining map is the decider | Same side rules as BO3                                                                                                                               |

These sequences follow common R6 Circuit-based rulebooks ([example](https://www.opleague.pro/styles/media/event/6175/rulebook.pdf)). BLAST adjusted its map-ban process for 2026, so check the BLAST R6 Global Rulebook before Season 4.

- **Engine:** `packages/core/veto.ts` is a state machine: given format, pool and team A, it returns the next step and the valid choices. Each step is stored as a `veto_step` row.
- **Timer:** 4 minutes per step by default (the Six Invitational's value). A timed-out ban picks a random remaining map and is marked `timed_out`.
- **Live view:** both teams and staff watch the same page, updated by htmx polling every 2 seconds.
- **Result:** the bot posts the final maps and sides in the match channel and fills `game.map` and `bans_json`.
- **Later:** the same state machine can drive Discord select menus in the match channel.

**Result lifecycle (LFR)**

1. `scheduled`: channel created, window and deadline set.
2. `reported`: the team's manager or one of its staff runs `/match report` with the score and a screenshot of the final scoreboard (required `evidence`). The bot posts the report in public, pings the other team's manager and staff, and posts it in the staff queue channel.
3. The opponent confirms (`confirmed`) or disputes (`disputed`, staff alerted), with the buttons under the report. Disputing opens a form: a reason from the competition's `dispute_reasons` setting or "other", and details (up to 1,000 characters, required for "other"). The reason and details go to the staff queue only, never to the public message, since a reason can accuse a player. Each dispute is a `dispute` row; the staff action that ends it (validate, reject, void, a direct result or a forfeit) records its resolution in the same transaction.
4. Staff validate (`validated`) with the button in the queue or `/staff match validate`. Only now does the result count; it is announced in the results channel. Staff can instead reject the report: the match goes back to `scheduled`.
5. Staff can set any result (`/staff match result`), forfeit or void directly; everything is audited.

- The steps, and who may take each, are one table in `packages/core` (`match-lifecycle.ts`). With `result_validation: 'opponent'`, the opponent's confirmation validates.
- Staff may validate before the opponent answers; whether they should is an open question (O-06).
- Until R2 (phase 5), the lasting copy of the screenshot is the bot's post in the staff queue, and `evidence.url` is the link to that message: the address Discord gives for an upload expires.
- A button belongs to one report: its ID carries the `evidence` row of that report, so a button under an older report is refused.

**Game score**

Which scores one game (a map) can end on is a competition setting, so an impossible result is refused whatever the title.

`competition.ruleset_json`:

```json
{
    "result_validation": "staff",
    "game_score": { "win_at": 7, "overtime_rounds": 3 }
}
```

- `win_at` is the number of rounds that wins the game in regulation.
- Overtime starts when both teams are one round short of `win_at`. It is played in periods of `overtime_rounds`; a period is won by taking more than half of its rounds, and an even period that ends level is followed by another.

| Title         | `win_at` | `overtime_rounds` | A game ends                                         |
| ------------- | -------- | ----------------- | --------------------------------------------------- |
| R6            | 7        | 3                 | 7–0 to 7–5, or 8–6, 8–7                             |
| Valorant      | 13       | 2                 | 13–0 to 13–11, or 14–12, 15–13 and so on (win by 2) |
| CS2           | 13       | 6                 | 13–0 to 13–11, or 16–12 to 16–14, 19–15 and so on   |
| Rocket League | none     | none              | Any score with a winner (`game_score: null`)        |

- A single deciding round at 6–6 is `overtime_rounds: 1`, which allows 7–6.
- `isPossibleGameScore` in `packages/core` applies the rule. Staff result entry uses it now; team reports, the stat grid and stitching will use the same function.
- Each title's default lives in `packages/titles` (R6: 7 and 3); a league may set its own.
- An import from score7 is not refused on this rule: the shadow run has to mirror score7. A test checks that every Season 3 fixture score is possible.

**Re-hosts**

A restart keeps the score from before the crash. Each team may call one re-host per map, recorded with `/match rehost` in `rehosts_a`/`rehosts_b`; staff can order more and decide when teams disagree. Stitching (section 8) rebuilds the round list from the replays.

**Forfeits and exclusion**

- Only staff record a forfeit (`/staff match forfeit`).
- A team's forfeits are counted from its forfeit matches of the stage, never stored, so an annulled forfeit stops counting. The `slot.forfeits` column is therefore unused.
- `season.settings_json.forfeits` holds the thresholds, `{ "warning_at": 2, "exclusion_at": 3 }` in LFR; either can be null. Reaching `warning_at` adds a `warning` sanction automatically. Reaching `exclusion_at` alerts the staff queue and excludes nobody: exclusion is a staff decision, and its rule is not settled (O-04, O-05).
- `excludeSlot()` (not built yet):
    - if the team played at least 50% of its matches, its results stand and its remaining matches become forfeit wins for the opponents;
    - otherwise every match of the team, past ones included, becomes a forfeit win for the opponents, and the slot is lost. Every changed match is audited and standings are recomputed.

**Sanctions**

The rulebook's list maps to `sanction.kind`: warning, administrative defeat, points removal, imposed forfeit, suspension of a player or staff member, team exclusion, slot freeze or withdrawal, accreditation removal, LFR exclusion.

- Point deltas feed standings.
- Suspensions block lineups through the eligibility check.
- A cheating ban goes into `org_ban` and blocks the player in every league of the group (LFR, LFV, LFRL).

**Promotion, relegation and barrages**

`closeSeason()` reads final standings and produces next season's slots:

- L1 9th–10th go down, L2 1st–2nd go up.
- L2 9th–10th go down to National; National semi-final winners go up.
- Two barrage stages are created: L1 8th against L2 3rd, and L2 8th against the winner of the National semi-final losers' match. Each barrage winner takes the higher-tier slot.

**Brackets**

- A bracket is a graph of matches; each side is a `match_slot` fed by `entry`, `seed(n)`, `winner_of(match)` or `loser_of(match)`.
- Generators: single elimination (byes to top seeds when the count is not a power of two), double elimination, GSL. `best_of` is set per round, so the cup's BO1 → BO3 → BO5 progression is configuration.
- `advance(match)` fills downstream slots when a bracket match is validated.
- National playoffs are seeded from region winners; Coupe de France seeding is an open question.

**Mixed-team mode (FRFL)**

- Lineups are created per match, drafted by staff or proposed by the bot.
- Balanced proposal: try all 126 splits of 10 players into two teams of 5 and keep the one minimising the difference in summed OpenSkill `mu`.
- Ratings update after every validated match.
- Player standings: every member of a winning lineup gets the win points; ties go to win %, then score difference per game, then games played; a minimum games count is required.

## 6. Discord bot

One bot instance joins every league's Discord server (LFR, LFV, FRFL, LFRL). Each server maps to one competition through `league_guild`, so commands never ask which league. The bot is the quick-access side of the platform (section 3): commands call the same services as the website, and all channel and role changes go through one reconciler. Discord limits a command's description to one short sentence, so `/help` explains each command in full.

**Who can do what**

- **Staff:** the staff role configured per server. Staff commands also set `default_member_permissions` so Discord hides them from others. Discord hides a whole command, never one subcommand, so team actions and staff actions are separate commands: `/match` for teams, `/staff` for staff.
- **Team managers and staff:** from `team_staff` (one manager, up to 3 staff), who act for the team.
- **Players:** any Discord user linked to a `player` row.
- **Commentators:** players holding a `commentator` accreditation.
- Every permission is re-checked server-side; Discord's own visibility settings are only cosmetic.

**Commands**

| Command                                          | Who                     | Does                                                                                                    |
| ------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `/help [command]`                                | everyone                | What each command does, who may use it and how; staff commands are listed for staff only                |
| `/standings [division]`                          | everyone                | Standings image for the current season                                                                  |
| `/fixtures [week]`                               | everyone                | The week's matches with times, host, side choice and results                                            |
| `/stats player:<autocomplete>`                   | everyone                | Player card image (consenting players only)                                                             |
| `/stats team:<autocomplete>`                     | everyone                | Team card image                                                                                         |
| `/leaderboard metric:<choice>`                   | everyone                | Top 10 for one metric, with coverage                                                                    |
| `/rules [section]`                               | everyone                | Link to the current rulebook version on the website                                                     |
| `/link`                                          | players                 | Opens the website to link Ubisoft, Riot or Epic accounts                                                |
| `/match propose-time when:<datetime>`            | team managers and staff | Posts a proposal with Accept and Decline buttons                                                        |
| `/match report match score_a score_b screenshot` | team managers and staff | Reports a BO1 result; the screenshot becomes `evidence`. A modal with a score per map comes with series |
| `/match rehost`                                  | team managers and staff | Records the team's re-host for the current map                                                          |
| `/register`, `/mercato`                          | team managers           | Open the website forms (too many fields for a modal)                                                    |
| `/stream title match:<autocomplete>`             | commentators            | Returns the mandatory title, e.g. "LFR Ligue 1 – RCK Esport VS Greed Esport"                            |
| `/staff match validate\|result\|forfeit\|void`   | staff                   | Validation and direct changes, audited                                                                  |
| `/staff sanction add\|list`                      | staff                   | A warning or a change of points for a team; its sanctions this season                                   |
| `/team manager`, `/team staff add\|remove\|list` | staff                   | Who acts for each team, until registration fills it in                                                  |
| `/league channel`, `/league channels`            | staff                   | Staff queue and results channels, results also per division; the list                                   |
| `/season create\|schedule\|publish\|close`       | staff                   | Season setup; `schedule` previews, `close` runs promotion and relegation                                |
| `/week publish week:<n>`                         | staff                   | Creates that week's channels now instead of on schedule                                                 |
| `/accreditation grant\|revoke`                   | staff                   | Commentator accreditations                                                                              |
| `/admin sync [dry_run]`                          | staff                   | Runs the reconciler; dry run prints the diff                                                            |
| `/admin reparse game:<id>`                       | staff                   | Re-runs replay verification and stitching for a game                                                    |

**Interaction rules**

- Answer within 3 seconds or defer. Defer every reply that renders an image or touches R2.
- Errors and private information go in ephemeral replies.
- Button `custom_id` format: `action:entityId:nonce`. The server re-checks permissions and the entity's current state on every click.

**Match channel lifecycle**

1. **Publish.** A scheduled job runs a configurable number of days before each week. It creates the category `Semaine N` if missing and one channel per match named from `channel_template` (default `w{week}-{tagA}-{tagB}`).
2. **Permissions.** @everyone is denied View Channel; team role A, team role B, the staff role and the bot are allowed.
3. **Control message**, pinned:
    - fixture, play window and deadline;
    - host team and side chooser, from live standings;
    - buttons: Propose time, Map veto, Report result, Upload replays and MOSS, Enter stats.
4. **Deadlines.** At the end of the planned week with no agreed time, the bot posts the one-week extension. At the end of the extension it posts the automatic Sunday 21:00 slot.
5. **Result.** After staff validation, the bot posts the result card in the channel and in the results channel.
6. **Archive.** A configurable number of days after validation, the team roles lose Send Messages and the channel moves to an archive category.
7. **Season end.** The transcript is exported as JSON to R2, then the channel is deleted.

**Other managed channels**

- `moss-<tag>`: one private channel per team (team role and staff only), replacing the rulebook's "Moss-\[équipe\]". The bot posts a receipt there when a MOSS file is uploaded on the website.
- `#mercato`: the bot posts each approved transfer using the rulebook's form fields.
- Results channel: every result that counts (validated reports, staff entries and corrections, forfeits). A division can have its own (`division.results_channel_id`), else the league's applies; several divisions may share one. A new season copies each division's channel from the previous season's division of the same level (phase 4).
- Mixed-team matches (FRFL): each lineup member is allowed individually, and the channel is named `m{n}-{yyyy-mm-dd}`.

**Reconciler**

- **Desired state** comes from the database: team roles, role membership (rostered players and team staff with linked accounts), categories, match and MOSS channels with their permission overwrites, archive state.
- **Actual state** is fetched from the guild. The diff produces ordered operations: create roles, categories and channels, edit overwrites, add or remove member roles, move or archive channels.
- It runs on startup, after any change to desired state, and through `/admin sync`.
- Every created object's ID is stored and names are never used for lookup, so manual renames or deletions are repaired on the next run.

**Bot setup**

- Permissions: Manage Channels, Manage Roles, View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Pin Messages (a separate permission since 23 February 2026; Manage Messages no longer allows pinning).
- Gateway intents: Guilds and Guild Members. Guild Members is privileged: enable it in the Developer Portal so the reconciler can read role membership.
- The bot's role must sit above every team role in each server.

**Notifications**

- Reminders in the match channel when no time is agreed by mid-week, and 24 h before the deadline.
- A staff alerts channel per server receives results waiting for validation, disputes, replay mismatches, stitch reviews, unregistered players in replays and reconciler errors.

## 7. Website

The website is the main tool of the platform (section 3): the public face of every league (standings, fixtures, brackets, stats, rules), the workbench for everything Discord can't carry (registration, mercato, uploads, stat sheets), and a second way to do every action the bot offers, such as reporting and confirming a result, validation, forfeits, sanctions, team staff and league channels.

**Authentication**

- Discord OAuth2, scope `identify`. The callback maps the Discord user ID to `player.discord_user_id`, creating the player if needed.
- Session: signed, `httpOnly`, `SameSite=Lax` cookie holding the player ID; 30-day expiry. POST forms also carry a CSRF token.
- Roles come from the database (staff list, `team_staff`, roster entries), never from the client.

**Pages**

| Route                          | Who                     | Content                                                                                                                        |
| ------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `/`                            | everyone                | The group's leagues and their current seasons                                                                                  |
| `/c/:comp/:season`             | everyone                | Standings per division and region, fixtures by week, latest results                                                            |
| `/c/:comp/:season/bracket`     | everyone                | National playoffs, barrages, Coupe de France                                                                                   |
| `/c/:comp/:season/leaders`     | everyone                | Leaderboards per metric, with coverage                                                                                         |
| `/c/:comp/rules`               | everyone                | Current rulebook version, with history                                                                                         |
| `/teams/:slug`                 | everyone                | Roster, staff, results, team stats                                                                                             |
| `/players/:slug`               | everyone                | Season stats, splits by map, side and operator, game log (consenting players only)                                             |
| `/matches/:id`                 | everyone                | Score per game, scoreboards, round timeline when replays exist                                                                 |
| `/register`                    | team managers           | Team registration form                                                                                                         |
| `/teams/:slug/manage`          | team manager            | Team staff, slot transfer request, mercato moves                                                                               |
| `/matches/:id/upload`          | match players and staff | Replay uploader (browser parsing), MOSS and screenshot uploads; the map veto lives next to it at /matches/:id/veto             |
| `/matches/:id/stats`           | team staff and staff    | Manual stat grid                                                                                                               |
| `/matches/:id/games/:n/stitch` | team staff and staff    | Re-host review                                                                                                                 |
| `/me`                          | logged-in player        | Linked accounts, nationality, stats consent                                                                                    |
| `/staff/*`                     | staff                   | Validation queue, registrations, mercato approvals, sanctions, forfeits, accreditations, unknown players, jobs, rules versions |

The team workspace, recruitment and awards pages are listed in section 17.

**Registration** (replaces the rulebook's form posted in the registration channel)

- **Team:** name, city, status (association, association 1901, company, amateur), transparent PNG logo, at least 2 colours, manager, up to 3 staff, social links, team Discord, whether the team can stream on its own.
- **Players:** 5 players and up to 2 substitutes, each with Ubisoft ID, Discord account (by login or invitation link), competitive rank and nationality.
- **Rules acceptance:** the manager accepts the current rulebook version ("lu et approuvé"), stored with `rules_version_id` and a timestamp, replacing the signed page.
- **Stats consent:** each player gives it from their invitation link; it can be made mandatory by competition setting.
- **Status:** incomplete submissions are `frozen` until fixed, as the rulebook says; staff approve, which creates the team, its slot and roster entries.

**Mercato**

- Moves can only be requested inside an open `mercato_window`.
- Each team gets at most 3 moves per window. A player can't be on two rosters in the same competition, and a transferred player is blocked for 1 day.
- The form carries the rulebook's fields: Ubisoft ID, Discord account, nationality, rank, old team, new team.
- Staff approve each move. Approval posts it in `#mercato` and updates rosters and Discord roles through the reconciler.

**Manual stat grid**

- One tab per game. Rows are lineup members; columns are the title's manual metrics (section 9).
- Pasting tab-separated rows from Excel or Google Sheets fills the grid.
- Live validation: types and ranges, then the title's consistency checks (section 12).
- Each team submits its own side, or one submits both and the other confirms; staff can override; everything is audited.
- Replay data always wins over manual data for the same game.

**Performance and privacy**

- Public pages render on request and are cached by a data version counter (ETag), invalidated on validated results.
- The rulebook's image-rights clause covers results, standings, team names and logos, but not individual player stats. Publish player stats only with `stats_consent_at`, and honour deletion or anonymisation requests from `/me` (GDPR).

## 8. Replay pipeline

Replays are parsed in the uploader's browser by a WebAssembly build of the title's parser. The browser sends compact JSON right away and, for R6, uploads the raw files in the background so the server can re-parse them with the same module and verify the JSON.

**Why parse in the browser**

- 100–170 MB per R6 map becomes 6–8 KB of JSON per round before anything leaves the PC.
- Instant feedback: map, lobbies, players and round winners show before any upload, and wrong folders are rejected on the spot.
- The server does almost no parsing work.

**Trust model** (the browser's output is under the uploader's control)

1. **The result of record** is the reported, confirmed and staff-validated score with its screenshot. Replays add stats and cross-check the score; they never decide a result alone.
2. **Cross-checking:** two recordings of the same lobby, one per team, must produce the same kill feed and round winners. A difference flags the game.
3. **Raw verification:** every JSON carries the SHA-256 of its source file.
    - For R6, raw files upload in the background (`raw_upload: 'always'`), because the game deletes replays beyond 12 and a later request often fails.
    - The worker re-parses each raw file in Node with the same WebAssembly module: equal output → `verified`; different → `mismatch` and a staff alert.
    - Until then, the game's stats show as unverified.
4. **Pinned parser version:** the WebAssembly file name carries the parser's build hash. The server only accepts JSON from versions it lists, and the page reloads the module otherwise.

**Upload flow**

1. The player selects their `MatchReplay` folder or drags in `Match-*` folders. The page preselects folders whose name timestamp falls inside the match window.
2. A Web Worker loads the title's parser and handles the files one at a time:
    - `File.arrayBuffer()`;
    - parse;
    - SHA-256;
    - normalise with the same TypeScript code the server uses (`packages/titles/<title>`).
3. The page shows the lobbies found, map, players matched to lineups, unknown players and round winners. The player confirms.
4. `POST /api/replays` sends the normalised JSON, hashes and parser version. The server stores `replay_file` rows (`unverified`) and runs grouping and stitching at once; they are cheap on JSON.
5. `POST /api/replays/sign` returns presigned R2 PUT URLs. The browser uploads raw files 3 at a time with progress, and warns before the tab is closed. Each completed file enqueues `verify_replay`.
6. The same page takes the MOSS file and score screenshots, stored under `evidence/` in R2. MOSS is visible to staff only.

**Server jobs**

| Job             | Trigger                            | Does                                                                          |
| --------------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| `stitch_game`   | segments of a game changed         | Build or rebuild the stitch plan, run checks, commit or request review        |
| `verify_replay` | raw file stored                    | Re-parse in Node with the WebAssembly module, compare with the submitted JSON |
| `render_images` | game committed or result validated | Match card, refreshed standings                                               |
| `reparse_game`  | staff command or parser upgrade    | Re-parse every stored raw file of a game and re-stitch                        |

The worker claims jobs with `UPDATE job SET status='running', locked_until=now+5min WHERE id = (SELECT id … WHERE status='queued' AND run_after <= now LIMIT 1) RETURNING *`. Failures retry with backoff up to 3 times, then alert staff.

**From files to a game** (server, TypeScript, on JSON)

1. **Validate:** game mode Bomb; a match type other than a custom game is accepted with a warning.
2. **Group into segments:** a segment is (game, `lobby_id`), assigned to a game by map, or by time order if one match plays the same map twice.
3. **Merge recordings:** for each (segment, round number), keep one canonical file. A complete round (winner set) beats an incomplete one.
4. **Resolve teams per segment:**
    - look up each side's `profileID`s in `game_account` and match them against the match lineups, or the season rosters;
    - a side is resolved when at least 3 known players agree, and the two teams must be the match's two sides;
    - unknown or ineligible players (not on the roster, suspended, banned) go to the staff alerts channel, since playing with an unregistered player is an irregularity under the rulebook.
5. **Facts:** the normaliser has already produced per-round facts (section 9); they are written to `segment_round`, `round_player` and `kill_event`.

**Stitching re-hosted games**

A restart keeps the score, so the official map is the lobbies joined in order.

1. Order the game's segments by the timestamp of their first round.
2. Draft the plan:
    - every complete round counts, in time order;
    - a round with no winner is void as `interrupted`;
    - rounds after the map was decided are void as `after_end`.
3. Run the checks:
    - same map in every segment;
    - no overlap in time;
    - the winner reaches the win condition exactly on the last counted round;
    - the side sequence fits the ruleset;
    - the number of lobbies minus one is at most the recorded re-hosts;
    - the plan's score equals the reported score.
4. All checks pass: apply the plan and post a summary in the match channel, for example "Re-host detected: 2 lobbies, 4–2 then 3–3 → 7–5, 1 interrupted round voided".
5. Any check fails: mark the game `needs_review` and open `/matches/:id/games/:n/stitch`. That page offers a timeline of segments, a count or void toggle with reason per round, segment reordering, and "awarded round" entries (score only, no stats) for staff rulings.

Re-stitching rewrites only `game_round`; facts stay keyed by (segment, local round). The score inside a replay header is never used across segments.

**Retention**

- Raw R6 files stay in R2 for at least one season after the match (re-parse after a parser fix, disputes, investigations); then delete them.
- Parsed JSON and facts are kept forever; duplicate files are rejected by `sha256`.

**Isolation**

WebAssembly modules have no file or network access unless given one. The server runs them in a Node worker thread with a memory cap and a 60 s timeout, so a malicious file can at worst kill that thread.

## 9. Stats

Stats live at two levels. Level 1 is one row per player, per game, per metric, for every title. Level 2 is round facts for R6 games with replays. Leaderboards read only level 1, and always sum first and divide last.

**Metric schema (in `packages/titles`)**

```ts
type Metric = {
    key: string; // 'kills'
    label: { fr: string; en: string };
    manual: boolean; // shown in the stat grid
    requiresRounds?: boolean; // only from R6 replays (KOST, SRV, entries...)
    min?: number;
    max?: (ctx: GameCtx) => number; // validation, e.g. kills <= rounds * 5
};
type Derived = {
    key: string;
    label: { fr: string; en: string };
    needs: string[]; // metric keys
    compute: (s: Record<string, number>) => number | null;
    format: "ratio" | "percent" | "signed";
};
```

Every stored metric is additive. Values shown as averages in game (Valorant ACS) are converted to totals at entry.

**R6 metrics**

| Key                               | Manual   | Replay | Meaning                                          |
| --------------------------------- | -------- | ------ | ------------------------------------------------ |
| `rounds_played`                   | yes      | yes    | Rounds the player was in                         |
| `kills`                           | yes      | yes    | Kills                                            |
| `deaths`                          | yes      | yes    | Deaths, including non-kill deaths                |
| `assists`                         | yes      | yes    | Assists from the scoreboard                      |
| `headshots`                       | optional | yes    | Headshot kills                                   |
| `rounds_kost`                     | no       | yes    | Rounds with a kill, objective, survival or trade |
| `rounds_survived`                 | no       | yes    | Rounds alive at the end                          |
| `opening_kills`, `opening_deaths` | no       | yes    | First kill and first death of a round            |
| `trade_kills`, `traded_deaths`    | no       | yes    | Trades given and received                        |
| `clutch_attempts`, `clutch_wins`  | no       | yes    | Last-alive situations and wins                   |
| `plants`, `defuses`               | no       | yes    | Defuser plant and disable completed              |

**R6 derived metrics:** K/D = kills / deaths (kills when deaths = 0) · KPR = kills / rounds · HS% = headshots / kills · SRV = rounds_survived / rounds · KOST = rounds_kost / rounds · entry = opening_kills − opening_deaths · trade diff = trade_kills − traded_deaths · clutch % = clutch_wins / clutch_attempts.

**Round fact definitions (R6)**

- **Event order** is the kill-feed array order. `elapsed_s` is the round length minus the clock before the plant, and the plant's elapsed time plus the defuser length minus the clock after it. Round and defuser lengths come from the ruleset.
- **Opening kill / death:** the first `Kill` event of the round. A first `Death` event without a killer counts as an opening death only.
- **Died:** the player is the target of a `Kill` or the subject of a `Death` event. **Left:** a `PlayerLeave` event. Both remove the player from the alive count.
- **Survived:** neither died nor left.
- **Traded:** the player's killer is killed by one of the player's teammates within W seconds of elapsed time. W is a parameter (default 10) recorded in the facts output.
- **KOST round:** kill ∨ plant ∨ defuse ∨ survived ∨ traded.
- **Clutch attempt:** the moment a team drops to exactly one player alive while the opponents have at least one, the survivor gets an attempt against that count. The attempt is won if the team wins the round.

**Other titles' metrics** are in section 12.

**Aggregation**

```sql
SELECT s.player_id, s.metric, SUM(s.value) AS total, COUNT(DISTINCT s.game_id) AS games
FROM stat s
JOIN game g   ON g.id = s.game_id
JOIN match m  ON m.id = g.match_id
JOIN player p ON p.id = s.player_id
WHERE m.stage_id IN (:stages)
  AND m.status = 'validated'
  AND g.status = 'final'
  AND p.stats_consent_at IS NOT NULL
GROUP BY s.player_id, s.metric;
```

Derived metrics are computed in TypeScript from these totals.

**Coverage**

- Metrics with `requiresRounds` are computed only over games with `stats_source = 'replay'`. Their denominator is that subset's `rounds_played`, never the player's total rounds.
- Leaderboards show coverage ("KOST: 14/18 maps") and hide players below a threshold (default 60% of their maps).
- Minimum sample to appear on a leaderboard: 30% of the team's rounds (configurable).

**Later: impact rating**

Replace the hand-weighted rating with a win-probability model.

- A round state is (attackers alive, defenders alive, planted, time bucket). P(attack wins) for each state is estimated from all league rounds, smoothed and pooled across seasons, since one season is only about 1,000 rounds.
- Each kill's value is the change in win probability it causes: the killer gets the gain, the assister a share, the victim the loss.
- Rating = the sum of those values per round.

## 10. Parsers

Each title gets one parser module: an existing parser compiled to WebAssembly, plus a TypeScript normaliser that turns its output into one shared format. The same module runs in the browser and in the server's Node worker. Atlas77 is dropped: all stat logic lives in TypeScript.

**Module interface (`packages/parsers`)**

```ts
interface ParserModule {
    title: "r6" | "rocket_league" | "valorant";
    version: string; // build hash of the .wasm file
    accepts(name: string, head: Uint8Array): boolean; // extension + magic bytes
    parse(bytes: Uint8Array): Promise<unknown>; // WASM call, the parser's own JSON
    normalize(raw: unknown, ctx: { tradeWindowS: number }): ParsedUnit; // TS, same in browser and server
}
```

**Shared output (`ParsedUnit`)**, one per file (an R6 round, a Rocket League game):

```json
{
    "schema": 1,
    "title": "r6",
    "parser": "r6-dissect-fork@<sha>",
    "file_sha256": "…",
    "lobby_id": "…",
    "unit": { "kind": "round", "number": 0 },
    "started_at": "2026-11-10T20:31:05Z",
    "map": "Chalet",
    "mode": "Bomb",
    "complete": true,
    "sides": [
        { "idx": 0, "role": "Attack", "won": false },
        {
            "idx": 1,
            "role": "Defense",
            "won": true,
            "win_condition": "KilledOpponents"
        }
    ],
    "players": [
        {
            "account": "ee63564b-…",
            "name": "GohlyBVG.a5",
            "side": 1,
            "stats": {
                "kills": 1,
                "deaths": 0,
                "assists": 0,
                "headshots": 0,
                "rounds_survived": 1,
                "rounds_kost": 1
            },
            "detail": {
                "operator": "Frost",
                "opening_kill": false,
                "opening_death": false,
                "trade_kills": 1,
                "traded": false,
                "left": false,
                "plant": false,
                "defuse": false,
                "clutch_vs": 0,
                "clutch_won": false
            }
        }
    ],
    "events": [
        {
            "seq": 0,
            "type": "kill",
            "elapsed_s": 26.0,
            "actor": "<account>",
            "target": "<account>",
            "headshot": false
        }
    ],
    "params": { "trade_window_s": 10 }
}
```

`stats` keys are the title's metric keys (section 9), so level-1 rows come straight from them; `detail` and `events` feed level 2 where a title has it. `lobby_id` is r6-dissect's `matchID` for R6 and the replay ID for Rocket League.

**Parsers per title**

| Title         | Parser                                    | To WebAssembly                                                                                                                                                                                                    | State                                                                                            | Plan                                                               |
| ------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| R6            | Your r6-dissect fork                      | Go: `GOOS=js GOARCH=wasm`; Go replay parsers already run in browsers this way ([demoinfocs-golang](https://pkg.go.dev/github.com/markus-wa/demoinfocs-golang/v4))                                                 | Maintained by you for the current season                                                         | First                                                              |
| Rocket League | boxcars, or subtr-actor for derived stats | Rust; boxcars already parses in a browser Web Worker ([rl-web](https://github.com/nickbabcock/rl-web)) and subtr-actor publishes WebAssembly bindings ([npm](https://www.pkgstats.com/pkg:rl-replay-subtr-actor)) | Mature and fuzzed                                                                                | After R6; replaces the ballchasing dependency                      |
| Valorant      | ValorantReplayParser                      | .NET; in a browser only through the heavy .NET WebAssembly runtime                                                                                                                                                | 0.1.0-alpha, experimental ([NuGet](https://www.nuget.org/packages/ValorantReplayParser.Unreal/)) | Wait: league matches are custom games, which replays may not cover |
| CS2 (if ever) | demoparser2                               | Rust, with an official WebAssembly package ([repo](https://github.com/LaihoE/demoparser))                                                                                                                         | Mature                                                                                           | Not needed now                                                     |

The C# Rocket League parser you found (jjbott) is MIT-licensed and current, but .NET makes it a poor browser fit; boxcars covers the same ground in Rust.

**R6 build**

- Add `cmd/wasm/main.go` to the fork. It exports `parseRound(bytes)` through `syscall/js`: it wraps the bytes in `bytes.NewReader`, calls `dissect.NewReader` and `Read()`, and returns the round JSON as a string. Import only the `dissect` package, so the Excel export dependency stays out of the binary.
- Build with `GOOS=js GOARCH=wasm go build -o r6-<sha>.wasm ./cmd/wasm`, and ship Go's `wasm_exec.js` with it. Serve it Brotli-compressed with immutable caching.
- The same `.wasm` runs in Node for verification. The native CLI build stays as the reference in CI: both builds must produce identical JSON on every stored replay.

**Pitfalls the R6 normaliser must handle** (found in the old Atlas77 code)

1. **Event order:** the kill feed's `timeInSeconds` is a countdown clock; sorting by it reverses the round. Keep feed order and derive `elapsed_s`.
2. **Identity:** match players by `profileID`, never by username.
3. **Deaths and disconnects:** handle `Death` events (falls, suicides) and `PlayerLeave`, not only `Kill`. Otherwise those players count as survivors and clutch detection breaks.
4. **Assists:** take them from r6-dissect's per-round `stats[].assists` (scoreboard).
5. **Trade window:** one parameter, recorded in every output (r6-dissect's own `Trades()` uses 3 s; the old code used 10 s).

**Atlas77**

Dropped from the plan. If it returns as a side project, it fits behind the same `ParserModule` interface (C output → Emscripten → WebAssembly) without touching the rest.

## 11. Image rendering

Images are rendered on the server with Satori (layout to SVG) and resvg (SVG to PNG), from the same data the website shows, and cached by a hash of their inputs.

**Templates v1**

| Template      | Content                                                                                                                         | Used by                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `standings`   | Division table with up to 12 rows: rank, logo, name, J, V, D, F, C, D, PTS (columns from the competition's settings), form dots | `/standings`, weekly post |
| `player-card` | Name, team, key stats for the season, percentile bars against the division, top operators                                       | `/stats player`           |
| `team-card`   | Record, map win rates, attack and defense round %, top players                                                                  | `/stats team`             |
| `match-card`  | Score per game, scoreboard per side, best rated player                                                                          | Result post               |
| `leaderboard` | Top 10 for one metric, with coverage                                                                                            | `/leaderboard`            |

**Rules**

- Width 1200 px, height follows content; PNG output.
- Fonts are bundled as TTF or OTF files, because Satori does not accept WOFF2.
- Team logos are fetched once from R2, resized to 128 px and embedded as data URLs.
- Colours and logo come from `competition.theme_json`, so every title and league can have its own look.
- Cache key: SHA-256 of template ID, template version and the input JSON. The PNG is stored in `image_cache` and on disk; a Discord message attaches it as `attachment://<name>.png`.
- Templates are JSX components in `packages/render`; the website reuses them for link-preview images.
- Snapshot tests render each template with fixture data, and a reviewer compares the PNGs when a template changes.

## 12. The group's other leagues

Every league gets results, standings, channels and manual stats from the shared core, in its own Discord server. Replay stats exist only where a parser and a replay file both exist: R6 everywhere, Rocket League for PC players, Valorant not yet.

| League | Title         | Mode        | Player identity                 | Stats now                                                           | Later                                                                                           |
| ------ | ------------- | ----------- | ------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| LFR    | R6            | Teams       | Ubisoft `profileID`             | Browser-parsed replays; manual grid as fallback                     | Mandatory replays (at least one team) if the league decides                                     |
| FRFL   | R6 on FACEIT  | Mixed teams | Ubisoft `profileID`             | Same replay pipeline; teams resolved against each match's lineups   | FACEIT Data API, if it ever returns R6 match stats                                              |
| LFRL   | Rocket League | Teams       | Platform and ID (Epic or Steam) | Browser-parsed `.replay` (boxcars); manual grid for console players | —                                                                                               |
| LFV    | Valorant      | Teams       | Riot ID typed by the player     | Manual grid                                                         | Replays once they cover custom games and a stable parser exists; Riot API with a production key |

**Valorant (LFV)**

- Replays arrived with patch 11.06. They expire when the game updates, and as of November 2026 custom games are reported as not covered; league matches are custom games.
- The only parser found is a .NET alpha. Revisit both points each season.
- The Riot API needs a production key (personal keys get no VALORANT access) and Riot Sign On is production-only ([Riot docs](https://developer.riotgames.com/docs/valorant)). Apply with a tournament use case once the platform is live; Riot's European tournament-organizer policies apply.
- Manual metrics: `rounds_played`, `kills`, `deaths`, `assists`, `combat_score` (ACS × rounds), `first_kills`, `first_deaths`, `plants`, `defuses`. Derived: ACS, K/D, KPR, first-kill difference.
- Consistency checks: one side's kills ≈ the other side's deaths (±3), kills ≤ rounds × 5, the score matches the win condition (first to 13, win by 2 in overtime: `game_score` 13 and 2).

**Rocket League (LFRL)**

- `.replay` files parse in the browser with boxcars (section 10). Ballchasing's upload API ([docs](https://ballchasing.com/doc/api)) stays an optional fallback.
- Gaps fall back to the manual grid: console players have no replay files, and replays only keep stats for players who finished the game.
- Metrics: `goals`, `assists`, `saves`, `shots`, `score`, `demos` (replay only). Derived: shooting % = goals / shots, goals per game.
- Consistency check: a side's goals sum to its game score. Series are best of N games; the standings score is goals.

**FACEIT mixed R6 (FRFL)**

- `participant_mode = 'mixed'`: lineups per match, OpenSkill ratings, player standings (section 5).
- Replays work unchanged; team resolution matches `profileID`s against the match's two lineups.

**Shared across the group**

- One Discord account = one `player` across all leagues, with one `game_account` per title.
- `org_ban` blocks a player caught cheating in every league, as the rulebook states for LFR, LFV and LFRL.

**Adding a title** = one folder in `packages/titles/<title>/` exporting:

- the metric schema and derived metrics;
- ruleset defaults (win condition, overtime and side rules);
- the stat grid's consistency checks;
- the score unit (rounds or goals);
- the account type and its validation;
- the replay normaliser if a parser exists;
- the default image theme.

## 13. Hosting and operations

One VPS at €5–9 a month runs everything with Docker Compose. R2 holds raw replays and continuous SQLite backups. A restore from nothing must take under an hour.

**Provider options** (prices before VAT, checked November 2026)

| Option                                                                                             | Specs                                             | Price per month            | Catch                                                                                                                  |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [OVHcloud VPS-1](https://www.itechguides.com/?p=708588)                                            | 2 vCores, 4 GB RAM, 40 GB NVMe, unlimited traffic | from $4.54 (12-month term) | Support has a weak reputation                                                                                          |
| [netcup VPS 500 ARM G12.5](https://notes.nicolasdeville.com/helpers/netcup/)                       | 2 vCores, 4 GB RAM, 64 GB NVMe                    | from €8.26 (12-month term) | ARM, Linux only (fine for this stack)                                                                                  |
| [Hetzner CX23 / CAX11](https://agentdeals.dev/digest/2026-w25)                                     | 2 vCPU, 4 GB RAM, 40 GB                           | €5.49 / €5.99              | Listed as not available to order in September 2026                                                                     |
| [Oracle Always Free A1](https://standardcompute.com/guides/run-openclaw-on-oracle-cloud-free-tier) | 2 OCPUs, 12 GB RAM                                | free                       | Reclaimed when 95th-percentile CPU, network and memory all stay under 20% for 7 days, which matches an idle league bot |

Recommended: OVHcloud VPS-1 plus R2. R2's free tier covers 10 GB of storage a month, then $0.015 per GB-month, with no egress fees ([pricing](https://upstash.com/kb/cloudflare-r2-pricing-in-2026-storage-operations-and-real-monthly-bills)). A season of raw replays is about 9–15 GB at one map per match.

**Compose services**

| Service      | Image                    | Notes                                                                                              |
| ------------ | ------------------------ | -------------------------------------------------------------------------------------------------- |
| `caddy`      | caddy                    | Automatic HTTPS; reverse proxy to `server:3000`; serves the `.wasm` parsers with immutable caching |
| `server`     | built from `apps/server` | Bot in every league server + website; runs migrations at start                                     |
| `worker`     | built from `apps/worker` | Re-parses raw replays with the WebAssembly parsers; CPU and memory limits, no inbound ports        |
| `litestream` | litestream               | Replicates `/data/league.db` to `r2://lfr/backups/db`                                              |

Volume `/data` holds the SQLite database and the image cache.

**Configuration** (`.env` on the server only, never committed)

`DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, `PUBLIC_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `DATABASE_PATH`.

**R2 bucket layout:** `replays/<match_id>/<sha256>.rec` (raw files, kept one season), `evidence/<match_id>/` (screenshots, MOSS; staff-only access through the server), `backups/db/`, `transcripts/<season_id>/`, `logos/`. The bucket is private; CORS allows only `PUT` from `PUBLIC_URL`.

**Deploy**

1. GitHub Actions runs tests, builds both images and pushes them to GitHub Container Registry.
2. A deploy job connects over SSH and runs `docker compose pull && docker compose up -d`.
3. The server takes a SQLite backup (`VACUUM INTO`) before applying migrations.

**Backups and restore**

- Litestream replicates continuously. A nightly job also uploads a full snapshot.
- `deploy/restore.sh` provisions a fresh VPS: installs Docker, pulls images, restores the database from R2, starts Compose.
- Rehearse the restore once per season.

**Monitoring**

- `/healthz` reports database, Discord gateway and queue depth; an external uptime monitor pings it.
- Structured JSON logs with pino, rotated by Docker.
- Errors, failed jobs and reconciler problems also go to the staff alerts channel.

**Security**

- Firewall open on 22, 80 and 443 only. SSH keys only, no password login. Unattended security upgrades.
- Presigned URLs only; rate limits on upload signing (per user and per match).
- The worker parser sandbox from section 8.
- Least-privilege bot permissions (section 6). Rotate the bot token if it ever leaks.

## 14. Testing strategy

Pure league logic gets exhaustive unit and property tests. Replay handling gets golden tests on real LFR replays. Discord and R2 sit behind interfaces with in-memory fakes, so almost everything runs without network access.

| Area                   | Tests                                                                     | Must cover                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Round robin            | fast-check properties over 2–20 entries and random seeds                  | Every pair meets exactly once; one match per entry per round; same seed gives the same schedule; `rounds_per_week` grouping                                                     |
| Scheduling deadlines   | Clock-injected tests                                                      | Extension week granted; Sunday 21:00 auto-scheduling; cup's 7-day rule with no extension                                                                                        |
| Standings              | Table-driven cases, including Season 2's real table                       | Points per win from the settings, F/C/D, ties broken by D, `sanction` point deltas, forfeit score setting (0–0 or 7–0), shared ranks and tie-break matches                      |
| Tie-breakers           | Hand-built tables                                                         | D tie-break; generic criteria: 3-way cycle, partial split with restart, `staff_decision`                                                                                        |
| Forfeits and exclusion | Scenario tests                                                            | Warning at 2 forfeits, exclusion at 3, the 50% rule both ways with retroactive forfeits                                                                                         |
| Promotion and barrages | `closeSeason()` on fixture standings                                      | L1 9th–10th down, L2 1st–2nd up, both barrage pairings, National promotions                                                                                                     |
| Brackets               | Generated brackets for 4–64 seeds                                         | Byes to top seeds, `advance`, BO1 → BO3 → BO5 by round, cup no-show disqualifications                                                                                           |
| Mercato                | Rule tests                                                                | Window only, 3 moves per team, 1-day block, one roster per competition                                                                                                          |
| R6 normaliser          | Golden files: real replays checked once against the in-game replay        | Opening kills, trades, KOST, clutches, plant/defuse, non-kill death, disconnect, overtime                                                                                       |
| Parser builds          | Every stored replay through the WASM build and the native CLI             | Identical JSON; any difference blocks a parser release                                                                                                                          |
| Verification           | Tampered JSON fixtures                                                    | Server re-parse flags edited kills, scores and players as `mismatch`                                                                                                            |
| Stitching              | Synthetic segment fixtures                                                | Single lobby; crash mid-round; full restart; swapped team indices; extra rounds after the end; more lobbies than recorded re-hosts                                              |
| Stat grid              | Validation per title                                                      | Range checks, kills/deaths consistency, goals = score                                                                                                                           |
| Reconciler             | Fake guild states                                                         | Fresh server, renamed channel, deleted role, missing permission, archived week, MOSS channels                                                                                   |
| Database               | Migrations                                                                | From empty, and from the previous release's snapshot                                                                                                                            |
| End to end             | Staging Discord server and staging bucket                                 | Publish a week, report, confirm and validate a result, upload a re-hosted map, see standings update                                                                             |
| Map veto               | State-machine tests per format                                            | BO1/BO3/BO5 sequences on a 9-map pool, wrong-team and already-banned choices refused, timeouts, side and overtime-side assignment, decider side by round difference             |
| Practice privacy       | Query and route tests on a database holding official and practice matches | No practice match, game, stat or round in standings, public stats, leaderboards, awards, scouting or the team level; workspace routes refuse non-members, league staff included |
| Practice grouping      | Synthetic segment fixtures                                                | Owning side resolved from 3 roster accounts; a folder matching neither side refused; rounds after the map is decided still counted; lobbies grouped by opponent and day         |
| Team report            | Hand-built round facts                                                    | Win % per map, side, site and strat; opening duel and player-count states; plants; minimum sample hiding; sum first, divide last                                                |
| Team level             | Table-driven cases and fast-check properties                              | Anchors move the whole group without reordering it; forfeits ignored; a level hidden under the minimum matches; same inputs give the same level                                 |

**Acceptance for standings:** a shadow run against score7 for the rest of the current season, with identical tables every week.

## 15. Roadmap

The work is eleven phases; phase 1 alone replaces score7's standings. Season 3 runs 9 weeks from 19 October, so weeks 5–9 (16 November to 20 December) and the Coupe de France are available for a shadow run against score7. Season 4 starts late December or early January at the earliest, which leaves about 6–7 weeks; the Season 4 cut below says what must be ready by then.

0. **Foundation.** Monorepo, tooling, schema v1, Discord application, staging server, seed data. Done when `pnpm test` passes in CI, migrations create an empty database, and the bot comes online in the staging server.
1. **Results and standings.** Staff result entry, standings (points per win, F/C/D, D tie-break, forfeit score setting, shared ranks), `/standings` as text, then as an image. Done when Season 3's results reproduce score7's tables every week from week 5.
2. **Match workflow.**
    - `/match propose-time`, the map veto, `/match report` with screenshot, opponent confirmation, the staff validation queue;
    - deadlines with extension and Sunday 21:00 auto-scheduling, side, overtime side and host;
    - forfeits, sanctions, audit log. Done when a full week of results comes in through teams and is validated by staff with no manual table edits.
3. **Website.** Discord login; public standings, fixtures, team, player and match pages; the rulebook page; registration with rules acceptance and stats consent; mercato; the manual stat grid; the website side of every bot action of phases 1 and 2 (result reports and confirmation, the validation queue, result entry, forfeits, sanctions, team staff, league channels). Done when Season 4 registrations are taken on the website, and every bot action of phases 1 and 2 can also be done there.
4. **Schedule and channels.** Round-robin generation, `/season publish`, weekly channels, MOSS channels, the reconciler across the league servers, team roles. Done when Season 4's weeks are generated, published, run and archived automatically.
5. **R6 replays.** WebAssembly build of the fork, browser uploader, normaliser, raw upload and server verification, stitching and review, match cards. Done when a re-hosted map uploaded by both teams stitches automatically and verifies, and a tampered JSON is caught.
6. **Season end and cups.** `closeSeason()` with promotion, relegation and barrages (format pending); Coupe de France bracket with BO1 → BO3 → BO5; tie-break matches. Done when Season 4 closes and the cup runs to a final on the platform.
7. **FRFL mixed mode.** Lineups per match, balanced proposals, OpenSkill, player standings, per-user channels. Done when one FRFL week runs end to end.
8. **LFRL Rocket League.** boxcars WebAssembly build, RL normaliser, metric schema and images. Done when a PC series' stats arrive from replays with no manual typing.
9. **Polish and expansion.** Styled images, leaderboards with coverage, impact rating, National regions and playoffs, LFV replays and the Riot API once possible, other organisations.
10. **Team development tools (R6, section 17).** In this order:
    - the practice book (replay upload and manual entry) and the team report;
    - the playbook and round tags;
    - the tendencies tab and the match preview;
    - external results and the results tab;
    - the recruitment board;
    - awards;
    - the team level, once its formula is agreed. Done when a team uploads a week of scrims and reads its site and strat win rates next to the division average, and no practice data is visible outside that team. The first two steps need only phases 3 and 5, so they can move ahead of phases 7–9.

**Season 4 cut**

| Priority                                  | Scope                                                                                                                                     | Deadline                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Blocking                                  | Phases 0–2, phase 4, and from phase 3: Discord login, public standings and fixtures, registration with rules acceptance and stats consent | Season 4 registration opens                                                                                  |
| Blocking only if replays become mandatory | Phase 5, tested on Season 3 replays                                                                                                       | Mid-December go/no-go: not verified by then means replays stay optional in Season 4, but are still collected |
| Before first use                          | Mercato pages (first Season 4 window); phase 6 (Season 4 end and cup)                                                                     | When each is first needed                                                                                    |
| Later                                     | Phases 7–10                                                                                                                               | After Season 4 runs smoothly                                                                                 |

**Start here today**

- [ ] Create the `lfr-league` repository: pnpm workspace, TypeScript strict mode, Vitest, a formatter and linter, GitHub Actions running tests
- [ ] Scaffold `packages/core`, `packages/titles`, `packages/db` and `apps/server` with the dependency rules from section 3
- [ ] Create the Discord application: bot user, Guild Members intent enabled, OAuth2 redirect for `http://localhost:3000/auth/callback`
- [ ] Create a staging Discord server mirroring LFR's roles and channels, and invite the bot with the permissions from section 6
- [ ] Write the Drizzle schema for org, league_guild, player, game_account, team, team_staff, competition, season, division, slot, roster_entry, stage, stage_entry, match, match_slot, lineup, lineup_member, game, evidence, sanction and audit_log; generate the first migration
- [ ] Implement the round-robin generator in `packages/core` with its property tests
- [ ] Implement standings: points per win, F/C/D, D tie-break, sanction deltas; test against Season 2's table
- [ ] Write a seed script loading LFR's Season 3 teams, fixtures and results from a CSV typed from score7
- [ ] Add `/standings` returning a monospace text table for each division
- [ ] Compare with score7 and fix every difference before moving to phase 2

## 16. Decisions and open questions

Most configuration is now settled by the Season 3 rulebook and your answers. Most questions left change settings, not architecture; the ones that block a phase say so in `docs/open-questions.md`.

**Settled**

| Topic                 | Decision                                                                                                                                  | Source        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Season length         | 9 weeks, 1 match per team per week; the rulebook's "4 weeks × 2" is a Season 2 leftover                                                   | You           |
| Division size         | Not fixed. A division has as many teams as it has slots (10 in Ligue 1, 12 in Ligue 2 in Season 3); any limit is a setting                | You           |
| Points                | 3 points per win in Season 3, as score7 is set (1 in Season 2); F rounds won, C rounds lost, D = F − C; no draws                          | score7, you   |
| Tie-break             | D; then a setting: shared rank (default), a BO1 tie-break match, or staff decision                                                        | Rulebook, you |
| Forfeit score         | Season setting: 0–0 (Season 3) or 7–0 (Season 2)                                                                                          | You           |
| L1/L2 matches         | BO1, one map after bans; teams pick date and time                                                                                         | Rulebook, you |
| Scheduling            | One extra week if no agreement, then Sunday 21:00 of the second week                                                                      | Rulebook      |
| League sides and host | Lower-ranked team picks the starting side and bans first; the other picks the overtime side; higher-ranked team hosts                     | Rulebook, you |
| Map veto              | Official competitive pool; alternate bans down to one map (BO1); standard R6 sequences for BO3 and BO5                                    | You           |
| Coupe de France       | All teams, single elimination; BO1 before the round of 16, BO3 for the round of 16 and quarter-finals, BO5 for semi-finals and final      | Rulebook, you |
| Cup sides and host    | Staff designate the starting-side team; the other picks the overtime side; teams agree on the host                                        | You           |
| Results               | Screenshot proof, both teams check, administration validates                                                                              | Rulebook      |
| Map score             | A map is won at 7 rounds out of 12; at 6–6 a best-of-3 overtime ends it 8–6 or 8–7. Stored as the `game_score` setting                    | You           |
| Re-host               | Score kept; one per team, staff may order more                                                                                            | Rulebook, you |
| Forfeits              | Staff only; warning at the 2nd, exclusion at the 3rd; the 50% rule on exclusion                                                           | Rulebook      |
| Promotion             | L1 9th–10th down, L2 1st–2nd up; barrages L1 8th vs L2 3rd and L2 8th vs National                                                         | Rulebook, you |
| National              | Later; not needed until the owner launches it                                                                                             | You           |
| Rosters               | 5 players and up to 2 substitutes; one manager and up to 3 team staff                                                                     | Rulebook form |
| Mercato               | Announced windows only, 3 moves per team, 1-day block for a transferred player                                                            | Rulebook      |
| MOSS                  | Mandatory for every match                                                                                                                 | Rulebook      |
| Replays               | Likely mandatory, ideally from Season 4 (late December or early January at the earliest)                                                  | You           |
| Staff                 | 3–5 people; staff cannot play in the championship                                                                                         | You, rulebook |
| Discord               | One server per league: LFR, LFV, FRFL, LFRL                                                                                               | You           |
| Cheating              | A ban covers LFR, LFV and LFRL                                                                                                            | Rulebook      |
| Team tools            | Private practice book, playbook, team report, scouting, recruitment board, external results, team level and awards (section 17); R6 first | You           |
| Team obligations      | None: no team is required to upload scrims or enter external events; external results are shown on team pages and never worth points      | You           |
| Match volume          | FRFL and the cup provide the extra matches; the league stays at one BO1 per week                                                          | You           |
| Team level scale      | The 0–10 rubric of section 17                                                                                                             | You           |

**Still open**

Open questions are kept in `docs/open-questions.md`: one entry per question, with what the platform does until it is answered. Questions marked `O-` are for the league owner, those marked `M-` for the maintainer. An answered question moves to the end of that file, and its rule into this document.

**Sources**

- LFR Season 3 rulebook (screenshots supplied by you)
- [r6-dissect](https://github.com/redraskal/r6-dissect) and [r6-replay-stats](https://github.com/Gipson62/r6-replay-stats)
- [R6 replay folder rotation](https://rainbowsix.fandom.com/wiki/File:Match_Replay_Overview_-_6News_-_Rainbow_Six_Siege)
- [Discord upload limit change](https://neowin.net/news/discord-raises-file-size-upload-limit-for-its-non-subscribers/)
- [Riot VALORANT API launch notes](https://www.riotgames.com/en/DevRel/valorant-api-launch), [Riot VALORANT docs](https://developer.riotgames.com/docs/valorant), [Riot replays FAQ](https://support.riotgames.com/ms-my/valorant/gameplay/replays-faq-pro-tips), [Valorant replay limits (insights.gg)](https://insights.gg/blog/valorant-replay-system-how-to-watch-save-replays)
- Parsers: [ValorantReplayParser](https://www.nuget.org/packages/ValorantReplayParser.Unreal/), [rl-web / boxcars](https://github.com/nickbabcock/rl-web), [subtr-actor WASM](https://www.pkgstats.com/pkg:rl-replay-subtr-actor), [demoparser2](https://github.com/LaihoE/demoparser), [demoinfocs-golang](https://pkg.go.dev/github.com/markus-wa/demoinfocs-golang/v4)
- [ballchasing.com API](https://ballchasing.com/doc/api) and [FAQ](https://ballchasing.com/doc/faq)
- [Cloudflare R2 pricing](https://upstash.com/kb/cloudflare-r2-pricing-in-2026-storage-operations-and-real-monthly-bills)
- VPS prices: [OVHcloud](https://www.itechguides.com/?p=708588), [netcup](https://notes.nicolasdeville.com/helpers/netcup/), [Hetzner](https://agentdeals.dev/digest/2026-w25), [Oracle Always Free](https://standardcompute.com/guides/run-openclaw-on-oracle-cloud-free-tier)

## 17. Team development tools

The league raises its level only if its teams get better, and teams at this level have no analyst and no time to build their own spreadsheets. The platform already collects what they need, so this section turns it into tools a team uses between matches. R6 comes first; nothing here is mandatory for a team, and nothing here changes a standing.

| Tool                    | What a team gets                                                                  | Reads                                      | Visible to          |
| ----------------------- | --------------------------------------------------------------------------------- | ------------------------------------------ | ------------------- |
| Practice book           | Its scrims, friendlies and cross-league matches, with the stats of a league match | Replays the team uploads, or manual entry  | The team only       |
| Playbook and round tags | A win rate for each of its own strats                                             | The team's tags on rounds it played        | The team only       |
| Team report             | Maps, sides, sites and round situations, next to the division average             | Round facts of official and practice games | The team only       |
| Scouting                | What the next opponent bans, picks and plays                                      | Official matches only                      | Competition setting |
| Recruitment board       | Players looking for a team, teams looking for a player                            | Listings posted by players and managers    | Everyone            |
| External results        | A record of results outside the league on the team page                           | Manager submissions approved by staff      | Everyone            |
| Team level              | A position on the 0–10 scale                                                      | Official results and external results      | Competition setting |
| Awards                  | Player of the week and season awards                                              | Official stats                             | Everyone            |

**Rules that hold for all of it**

- **Practice data stays inside the team.** It never reaches standings, public stats, leaderboards, awards, scouting pages, the team level or any image the bot posts. Two guards enforce it: a practice match has no stage (`stage_id IS NULL`) and its own status (`practice`), and every public query selects by stage and by `validated` status.
- **The workspace is private.** It opens for the owning team's current roster (players, substitutes, coach) and `team_staff`, checked on the server on every request. League staff cannot open it by default (`workspace_staff_access: false`): teams will not upload their strats if a rival's friend can read them.
- **No obligation.** No rule requires a team to upload scrims, enter external events or post a listing. External results are shown, never worth points, seeding or promotion.
- **Access follows the roster.** A player who leaves a team loses access that day; the data stays with the team.
- **Opponents stay anonymous outside the match.** Accounts seen in a practice replay that belong to no platform player are stored as unclaimed `game_account` rows and shown only inside that practice match.

**Practice book**

A practice match is a scrim, a friendly or a cross-league match that one team records for itself. It reuses `match`, `game` and the replay tables, so the pipeline of section 8 produces the same round facts; the differences are below.

|                 | Official match (section 8)                                  | Practice match                                                                                                                  |
| --------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Raw files       | Uploaded to R2 and re-parsed by the worker                  | Not uploaded (`raw_upload: 'never'`); only the parsed JSON is sent                                                              |
| Trust           | `unverified` until the re-parse matches                     | Always `unverified`, which is acceptable for data only the uploader's team reads                                                |
| Team resolution | Both sides must be the match's two lineups                  | One side must hold at least 3 accounts of the owning team's roster; the other side is the opponent                              |
| Round list      | Stitched to the win condition and checked against the score | Every complete round counts, in time order; no win-condition check, since scrims often play on or play a fixed number of rounds |
| Result          | Reported, confirmed and validated by staff                  | The rounds are the result; nobody validates                                                                                     |
| Unknown players | Staff alert                                                 | Stored as unclaimed accounts                                                                                                    |
| Deletion        | Never; status `void`                                        | The team manager can delete it for good                                                                                         |

- **Upload:** the uploader of section 8, opened from the workspace. A folder where neither side matches the team's roster is refused on the spot.
- **Grouping:** one game per lobby (`lobby_id`); lobbies against the same opponent on the same day form one practice match. The team can merge or split them afterwards.
- **Opponent:** linked to a platform team when at least 3 of its accounts are on that team's roster; otherwise a name typed by the uploader.
- **Stats:** level 1 `stat` rows are written for the owning team's players only. Round facts cover both sides, as in any replay.
- **Storage:** one recording per round is kept, at 6–8 KB of JSON per round, so a 12-round map is under 100 KB. A per-team quota (`practice_quota_mb`) protects the database.
- **Manual entry:** date, opponent, map, score and starting side, for sessions without replays. A manual round sheet (side, site, strat, won) comes later.
- **File already used:** a replay whose `sha256` belongs to an official match is refused; that match is already in the report.

**Playbook and round tags**

A replay knows the map, the site, the operators and who won the round. It does not know which strat the team called, so the team says so.

- **Playbook:** the team's own list of strats, each with a name, map, side, optional site and notes. Strats are archived, not deleted, so old rounds keep their tag.
- **Round tags:** one strat and an optional note per round, on any round the team played, practice or official. Tags are the team's private data even on an official match.
- **Tagging page:** the round list of a game with side, site, operators and outcome. The team picks a strat per round, and "same as the previous round on this site" fills runs quickly.
- Untagged rounds still count in the map, side and site views.

**Team report**

The report is the workspace's home page. Filters: scope (official, practice or both), dates, map, opponent and the five players on the round.

| View            | Shows                                                                                                           | From                            |
| --------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Map pool        | Games and rounds per map, map win %, attack and defence round win %                                             | `game`, `game_round`            |
| Sides and sites | Defence: how often each site is picked and its round win %. Attack: round win % against each site               | `segment_round.site`            |
| Strats          | Rounds and win % per strat, next to the team's average on the same map, side and site                           | `round_tag`                     |
| Opening duel    | Share of rounds with the opening kill; round win % after winning it and after losing it                         | `round_player`                  |
| Player counts   | Round win % from each (own alive, opponents alive) state reached, the states the impact rating uses (section 9) | `kill_event`                    |
| Trades          | Share of the team's deaths that were traded; trades given                                                       | `round_player`                  |
| Plants          | Attack: share of rounds with a plant and win % after it. Defence: win % after the opponent's plant              | `round_player`, `segment_round` |
| Round endings   | How rounds are won and lost: eliminations, defuser, time                                                        | `segment_round.win_condition`   |
| Operators       | Pick counts and round win % per operator, per side and map                                                      | `round_player.operator`         |
| Players         | The metrics of section 9 per player, on the selected scope                                                      | `stat`, `round_player`          |

- **Benchmark:** each figure sits next to the division's average for the same metric, computed from official matches only.
- **Sample size:** the number of rounds is always shown. A percentage is hidden under a minimum (`report_min_rounds`, default 10), because nine BO1s give about 100 rounds a season and a site may have five.
- **Computation:** pure functions in `packages/core` over round facts. Counts are summed first and divided last, as everywhere else.
- **Players in the report:** teammates see each other's figures inside the workspace. Public pages still follow `stats_consent_at`.

**Scouting**

Preparation is where organised teams separate from the others, and the data is already public in spirit: anyone who played the team has seen it.

- **Tendencies tab on `/teams/:slug`**, from official validated matches only: veto history (bans in order, maps left open), record per map, attack and defence round win % per map, defence sites picked and their win %, operator pick counts per map and side.
- **Match preview on `/matches/:id`** before the match is played: the two teams' tendencies side by side and their past meetings.
- **Team-level figures only.** A split per player appears only for players with stats consent.
- **Coverage** is shown ("7/9 maps with replays"). One team's upload covers both sides of a match, so a team cannot hide by not uploading.
- **Setting:** `scouting` is `'public'`, `'teams'` (logged-in members of registered teams) or `'off'`.

**Recruitment board**

Good players in the lower division should be easy to find, and teams short of a player should not have to fold.

- **Player listing**, from `/me`: roles, availability, languages and a short note. It shows the rank from `game_account`, a link to the player page (stats only with consent) and a link to the Discord profile.
- **Team listing**, from `/teams/:slug/manage`: the role wanted and a short note.
- Listings expire after 30 days unless renewed (`listing_days`). The bot posts new ones in the league's recruitment channel when one is configured.
- **A listing is an advert, not a move.** Every roster change still goes through a mercato window and staff approval (section 7).
- **Who may list:** `listing_requires_free_agent` (default true) limits player listings to players on no roster in that competition. Whether a rostered player may list is a question for the owner (section 16).
- The player page doubles as a CV: seasons, teams, divisions, awards and results (below).

**External results**

Teams are encouraged to play outside the league by showing what they achieve there, in the manner of a Liquipedia results table.

- **Submission:** the team manager picks or creates the event, then enters the placement (3rd, 5th–8th), the number of teams, the date, the players who took part and a link to the bracket or results page as proof.
- **Approval:** staff approve or reject each submission, audited. Nothing appears in public before approval. Staff also set the event's tier.
- **Results tab on `/teams/:slug`:** approved external results together with the team's results on the platform (final ranks, cup runs, titles). Platform results are derived from closed seasons and brackets, never typed.
- **Player pages** show the results a player earned while on the roster.
- The platform calls no external API for this.

**Team level**

The scale is the maintainer's 0–10 rubric:

| Level   | Meaning                                                              |
| ------- | -------------------------------------------------------------------- |
| 0       | High-rank five-stack with no structure or practice                   |
| 1–2     | Very weak organised team, barely above ranked                        |
| 2.5–3.0 | Low amateur, bottom of a local league                                |
| 3.0–3.5 | Typical organised grassroots team, competitive within a local league |
| 3.5–4.0 | Strong side of a local amateur league                                |
| 4.0–5.0 | Top national amateur, regular in decent open qualifiers              |
| 5.0–6.5 | Solid Challenger or tier 2                                           |
| 7.0–8.5 | Regional league standard                                             |
| 9.0–10  | Major and Six Invitational contenders                                |

The formula is not settled (section 16). Its shape follows from one limit: results inside a closed group only rank its teams against each other; they cannot say where the group sits on the scale. So the level has two parts.

1. **Relative strength.** One rating per team and title, updated on every validated official match, carried across seasons and shared by every competition of that title on the instance. OpenSkill is already a dependency (mixed mode). Forfeits do not move it.
2. **Position on the scale.** Anchors place the group:
    - a baseline per division and season, set by staff (`level_baselines`);
    - approved external results: each event tier maps a placement to a level band (`event_tiers`), and a team whose results sit outside its computed level moves toward that band.

- The level is computed from matches, results and settings; it is never stored or edited by hand.
- A cross-league event run on the platform as its own competition is official and counts. A cross-league match a team uploads to its practice book does not.
- **Display:** one decimal with the band's label, hidden until the team has played a minimum number of matches.
- **Setting:** `team_level` is `'public'`, `'teams'`, `'staff'` or `'off'`. It starts at `'staff'` until the formula has been checked against a full season: a public "2.6" can cost the league a team.

**Awards**

- **Player of the week**, per division: the best value of one metric among consenting players, over that week's validated games with replay stats, above a minimum number of rounds. Metric and minimum live in `competition.awards_json`.
- **Season awards** use the same rule over the whole season; the list of awards is a setting.
- An award is computed when the week's last match is validated, posted by the bot with an `award-card` image (section 11), and kept as an `award` row, so the announcement stays true if a later correction changes the numbers.
- Leaderboards (section 9) are unchanged.

**Pages**

| Route                                | Who                  | Content                                                        |
| ------------------------------------ | -------------------- | -------------------------------------------------------------- |
| `/teams/:slug/workspace`             | team members         | Team report                                                    |
| `/teams/:slug/workspace/matches`     | team members         | Practice book: list, replay upload, manual entry               |
| `/teams/:slug/workspace/matches/:id` | team members         | Games, rounds and round tags of one practice or official match |
| `/teams/:slug/workspace/playbook`    | team members         | Strats                                                         |
| `/teams/:slug` (tabs)                | everyone, or setting | Tendencies, results                                            |
| `/c/:comp/recruitment`               | everyone             | Player and team listings                                       |
| `/c/:comp/:season/awards`            | everyone             | Weekly and season awards                                       |
| `/staff/external-results`            | staff                | Approval queue, events and tiers                               |

**Schema additions** (not part of schema v1; each needs its migration)

```
-- changes to existing tables
match           + kind ('official'|'practice'), default 'official'; stage_id becomes NULL for practice;
                status gains 'practice'; CHECK ((kind = 'official') = (stage_id IS NOT NULL))
game_account    player_id becomes NULL          -- an account seen in a replay, with no platform player
league_guild    + recruitment_channel_id NULL

-- practice book and playbook
practice_match  match_id PK, owner_team_id, kind ('scrim'|'friendly'|'cross_league'),
                opponent_team_id NULL, opponent_name NULL, played_at, notes NULL, created_by
strat           id, team_id, title, map, side ('attack'|'defense'), site NULL, name, notes NULL, archived
round_tag       team_id, segment_id, local_n, strat_id NULL, note NULL, tagged_by, at,
                PRIMARY KEY (team_id, segment_id, local_n)

-- recruitment, external results, awards
listing         id, competition_id, kind ('player'|'team'), player_id NULL, team_id NULL, roles_json,
                note, status ('open'|'closed'), created_at, expires_at
external_event  id, org_id, title, name, organiser NULL, url, tier NULL, ended_on
external_result id, event_id, team_id, placement_from, placement_to, teams_count NULL, roster_json,
                proof_url, status ('submitted'|'approved'|'rejected'), submitted_by, reviewed_by NULL, at
award           id, season_id, division_id NULL, kind, week NULL, player_id NULL, team_id NULL,
                metric, value, at
```

The team level adds no table: baselines and event tiers are settings, and the rating is recomputed from matches and cached by the data version counter.

**Other titles**

- The practice book with map and score, the recruitment board, external results, the team level and awards need nothing specific to a title.
- The site, strat and round-situation views need round facts, which only R6 replays produce today. Another shooter gets them when its normaliser emits round facts; its title folder then names its own dimensions (R6's site and operator are another game's bomb site and agent).
