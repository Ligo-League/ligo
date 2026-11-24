# Setup guide: Discord application, staging server and `.env`

These are the steps only you can do, because they need your Discord account. At the end, the bot is
online in a private staging server and answers `/ping`.

Everything runs on your PC. No domain, public website or VPS is needed for this.

You need: a Discord account, the Discord desktop or web app, Node 26 and pnpm (already installed).

Discord sometimes renames buttons in the Developer Portal. If a label below differs slightly, the
page and section names are the reliable part.

## 1. Create the Discord application

1. Open <https://discord.com/developers/applications> and log in.
2. Click **New Application** (top right).
3. Name it `Ligo Staging`, accept the terms, click **Create**.
4. You are now on the **General Information** page. Under **Application ID**, click **Copy**.
   Keep it somewhere for step 5: this is `DISCORD_CLIENT_ID`.

Use a separate application for staging. The real league bot will be a second application later, so
that a test can never touch the real LFR server.

## 2. Configure the bot

1. In the left menu, open **Installation**. Under **Install Link**, choose **None** and click
   **Save Changes**. (This is required before the bot can be made private in the next step.)
2. In the left menu, open **Bot**.
3. Under **Token**, click **Reset Token**, confirm, then **Copy**. Keep it for step 5: this is
   `DISCORD_TOKEN`. Discord shows it only once; if you lose it, reset it again.
4. Turn **Public Bot** off, so that nobody else can add this bot to a server.
5. Under **Privileged Gateway Intents**, turn **Server Members Intent** on.
   Leave **Presence Intent** and **Message Content Intent** off.
6. Click **Save Changes**.

The token is a password for the bot. Never paste it in a chat, a screenshot, an issue or a commit.
If it ever leaks, come back to this page and click **Reset Token**; the old one stops working at
once.

## 3. Create the staging server

1. In the Discord app, click the **+** button at the bottom of the server list (**Add a Server**).
2. Choose **Create My Own**, then **For me and my friends**.
3. Name it `Ligo Staging` and click **Create**.
4. Turn on Developer Mode so you can copy IDs: **User Settings** (the cog next to your name) >
   **Advanced** > **Developer Mode**.
5. Right-click the `Ligo Staging` server icon and choose **Copy Server ID**. Keep it for step 5:
   this is `DISCORD_GUILD_ID`.

Mirroring LFR's roles and channels in this server is not needed yet. It becomes useful in phase 2
(match workflow) and phase 4 (channels and roles).

## 4. Invite the bot

1. Take this address and replace `YOUR_APPLICATION_ID` with the Application ID from step 1:

   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&scope=bot+applications.commands&permissions=2251800082238480
   ```

2. Open it in your browser.
3. Under **Add to server**, choose `Ligo Staging`, click **Continue**.
4. Check that the permission list matches the table below, then click **Authorize**.

| Permission           | Why the bot needs it                          |
| -------------------- | --------------------------------------------- |
| View Channels        | See the channels it manages                   |
| Manage Channels      | Create weekly categories and match channels   |
| Manage Roles         | Create team roles and set channel permissions |
| Send Messages        | Post fixtures, reminders and results          |
| Embed Links          | Post rich messages                            |
| Attach Files         | Post standings and stat images                |
| Read Message History | Find and update its own control messages      |
| Pin Messages         | Pin the control message of a match channel    |

The two scopes are `bot` (the bot joins the server) and `applications.commands` (it may register
slash commands there).

This is the list of design document section 6, with one difference: **Pin Messages** replaces
**Manage Messages**. Since 23 February 2026 Discord needs the separate Pin Messages permission to
pin, and the bot has no other use for Manage Messages.

Later, when team roles exist: in **Server Settings** > **Roles**, the bot's own role
(`Ligo Staging`) must sit above every team role, or it cannot assign them. Nothing to do today.

## 5. Fill in `.env`

In the repository folder:

```
cp .env.example .env
```

Open `.env` and fill in the three values you kept:

```
DISCORD_TOKEN=the token from step 2
DISCORD_CLIENT_ID=the Application ID from step 1
DISCORD_GUILD_ID=the Server ID from step 3
```

Leave `DATABASE_PATH` and `LOG_LEVEL` as they are, and leave the commented lines commented.
`.env` is ignored by git; never commit it.

## 6. Start everything

Run these from the repository folder, in order:

| Command                 | What you should see                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm install`          | Ends with `Done`                                                                                                |
| `pnpm db:migrate`       | `Migrations applied to …/data/ligo.db`                                                                          |
| `pnpm seed`             | `Created 1 org, 1 competition, 1 season, 2 divisions, 22 teams, 22 slots; …`, then a line for the matches       |
| `pnpm discord:register` | `Registered 6 command(s) in guild …: /ping, /standings, /match, /league, /register, /help`, then the invite URL |
| `pnpm dev`              | A log line containing `"msg":"Discord client ready"`; the command keeps running                                 |

Then, in any channel of `Ligo Staging`, type `/ping` and press Enter. The bot answers, visible only
to you:

```
Pong ! Latence de la passerelle : 42 ms.
```

The number varies. In the member list, `Ligo Staging` shows as online while `pnpm dev` is running
and goes offline when you stop it with Ctrl+C. That is expected until the bot is hosted.

## 7. Put the real teams in the seed file

`fixtures/lfr-s3-teams.csv` contains two example rows. Replace them with the 20 Season 3 teams:

| Column                          | Required | Content                                                                                                                                           |
| ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `division`                      | yes      | Exactly `Ligue 1` or `Ligue 2`                                                                                                                    |
| `name`                          | yes      | Team name; put it in double quotes if it contains a comma                                                                                         |
| `tag`                           | yes      | Short tag, unique per team, e.g. `RCK`                                                                                                            |
| `city`                          | no       | Leave empty if unknown                                                                                                                            |
| `color_1`, `color_2`, `color_3` | no       | A code such as `#1D4ED8`, or one of `noir`, `blanc`, `gris`, `rouge`, `orange`, `jaune`, `vert`, `bleu`, `violet`, `rose`; leave empty if unknown |

Then start again from a clean database, so the example teams disappear:

```
rm -rf data
pnpm db:migrate
pnpm seed
```

A colour name is stored as the standard web colour of that name (`violet` becomes `#800080`), so it
is an approximation until the team gives its exact code. Keep the commas of empty columns: a team
with no city still needs `,,` between its tag and its first colour.

`pnpm seed` never deletes anything. Running it again after an edit updates teams (matched by their
tag) and moves them between divisions; a mistake in the file is reported with its line number and
nothing is changed.

## 8. Optional now, needed in phase 3: the login redirect

The website's Discord login arrives in phase 3. You can register its local address now:

1. Developer Portal > `Ligo Staging` > **OAuth2**.
2. Under **Redirects**, click **Add Redirect** and enter `http://localhost:3000/auth/callback`.
3. Click **Save Changes**.

## 9. Phase 1: the staff role, the matches, `/standings` and `/staff match result`

> **Since 16 November 2026** (step 33): `/staff` and `/team` are gone. Staff enter results, forfeits, sanctions and exclusions on the website (phase 3f). The steps below are kept as a record.

The bot now reads the database, and it needs to know which server is LFR's and who its staff are.

1. In `Ligo Staging`, open **Server Settings** > **Roles** > **Create Role**, name it `Staff` and
   save. Give the role to yourself (right-click your name > **Roles**).
2. Right-click the `Staff` role in the role list and choose **Copy Role ID**.
3. Add it to `.env`:

   ```
   DISCORD_STAFF_ROLE_ID=the Role ID you just copied
   ```

4. Run these, in order:

| Command                 | What you should see                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm seed`             | `Created 2 stages, 22 entries, 111 matches; …` and `Discord server …: link to LFR created.` |
| `pnpm discord:register` | `Registered 6 command(s) in guild …: /ping, /standings, /match, /league, /register, /help`  |
| `pnpm dev`              | `"msg":"Database ready"`, then `"msg":"Discord client ready"`                               |

Then type `/standings` in any channel of `Ligo Staging`: after a second the bot posts one image
per division, visible to everyone. `/standings division:L2` posts one division, and
`/standings format:Texte` posts the tables as text.

The matches come from `fixtures/lfr-s3-matches.csv`, Ligo's own record of Season 3: score7's
results, corrected by staff in Ligo (14 November 2026). `pnpm seed` adds the results it holds
to matches that have none; a result already stored is never rewritten, and one that differs from
the file is listed and left alone. Exclusions are not in the file: on a new database, staff
exclude the teams again with `/staff exclusion exclude`.

`pnpm fixtures:score7` copies score7 into `fixtures/lfr-s3-matches.score7.csv` and
`fixtures/lfr-s3-standings.score7.csv`. They are a snapshot that the Season 3 test compares
Ligo's tables with; the seed does not read them.

To enter a result yourself as staff, type `/staff match result`. In the `match` option, type a team, a division
or a week (`rck`, `l2`, `s5`) and pick the match from the list; then give the rounds won by the
first and by the second team named. A score a map cannot end on, such as 7–6, is refused with
the list of possible scores. The screenshot is optional for staff. The bot confirms in a
message only you see, and `/standings` shows the result at once. Entering a result again on the
same match corrects it; both versions stay in the audit log.

`/staff`, `/team` and `/league` are hidden from everyone except server administrators. That is
only tidiness: the bot itself refuses anyone who does not hold the `Staff` role. To show them to
staff who are not administrators: **Server Settings** > **Integrations** > `Ligo Staging` > the
command > add the `Staff` role. `/match` is the teams' command and is visible to everyone.

`/help` lists the commands a member can use, and `/help command:<a command>` explains one in
detail: options, who may use it, and what happens next. Staff see the staff commands in the list
and the order of setup.

### Team logos in `/standings`

1. Put the logos in `data/assets/logos/`, any of PNG, JPEG, WebP, GIF or SVG, named in lowercase
   letters, digits, `_` or `-` (for example `rck.webp`). `data/` is not committed.
2. `pnpm assets:logos` (needs ImageMagick: `magick -version` should answer). It writes a 128 px
   square PNG of each to `data/assets/render/logos/` and leaves the originals alone.
3. In `fixtures/lfr-s3-teams.csv`, the `logo` column names each team's file without its
   extension. `pnpm seed` stores it on the team.
4. `/standings` then shows the logos. A team whose logo is missing keeps its two colours.

## 10. Phase 2a: a result reported by a team

> **Since 16 November 2026** (step 33): `/team` and `/staff match` are gone: owners are set on `/teams/<slug>/manage` by league staff, and staff decide with the queue's buttons or on the website. The steps below are kept as a record.

Run `pnpm discord:register` again whenever commands change, then restart `pnpm dev`.

One-time setup, as staff:

1. Create two text channels, for example `#validation` (staff only) and `#résultats`.
2. `/league channel kind:File de validation du staff channel:#validation`, then
   `/league channel kind:Résultats validés channel:#résultats`. The bot posts a notice in each
   channel; if it cannot write there, it says so and stores nothing.
   To give a division its own results channel, add `division:` (for example
   `/league channel kind:Résultats validés channel:#résultats-l1 division:Ligue 1`). The same
   command without `channel` gives the division back the league's channel. `/league channels`
   shows what is set.
3. `/team owner member:<a Discord member> team:<a team>` for the two teams of a match that is
   still to play. To test alone, make yourself owner of both. `/team list team:<a team>` shows a
   team.

Then, a result from report to standings:

| Who              | Does                                                         | What you should see                                                                                  |
| ---------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| A team's manager | `/match report` with the match, both scores and a screenshot | A public message with the screenshot, a ping of the other team's manager, and Confirmer / Contester  |
|                  |                                                              | The same report in `#validation`, with Valider / Refuser                                             |
| The other team   | Clicks **Confirmer**                                         | The message loses its buttons and says who confirmed; a line appears in `#validation`                |
| Staff            | Clicks **Valider** in `#validation`                          | The queue message says who validated; the result is announced in `#résultats`; `/standings` shows it |

Things worth trying, each of which the bot must refuse in a message only you see:

- `/match report` by someone who manages neither team, or with a score such as 7–6;
- **Confirmer** clicked by the team that reported (unless you manage both teams);
- **Valider** clicked by someone without the `Staff` role;
- a button under an older report, after staff clicked **Refuser** and the team reported again.
- **Contester**: the other team picks a reason and may add details; "Autre" without details is
  refused. The public message only says the result is disputed; the reason and the details
  appear in `#validation`.

Other staff actions:

- `/staff match validate` validates a reported result without the button, and
  `/staff match void` annuls a match, with a reason.
- `/staff match result` enters or corrects a result directly; it counts at once and is announced
  in `#résultats`, a correction as "Résultat corrigé".
- `/staff match forfeit` records which team forfeited, and announces it in `#résultats`. At a
  team's 2nd forfeit a warning is added by itself; at the 3rd the bot alerts `#validation` and
  leaves the decision to staff.
- `/staff sanction add` gives a team a warning or a change of points (`points:-1` takes one
  away), and `/staff sanction list` shows a team's sanctions.

## 11. Phase 2b: agreeing a match time, and the map veto

> **Since 16 November 2026** (step 33): `/match propose-time` and `/match veto` are gone: times are proposed on the match page (step 26) and the veto runs on its page (step 31). The bot posts both, with the page's link; a proposal keeps its Accept and Decline buttons. The steps below are kept as a record.

Run `pnpm discord:register` again, then restart `pnpm dev` (it applies the new migrations).

1. Create a `#planning` channel, then `/league channel kind:Planning des matchs channel:#planning`.
2. As manager of one team, `/match propose-time`: pick the match, a day from the list, and a
   time such as `21:00`. The message shows the time in your own time zone, with Accepter and
   Refuser for the other team.
3. As the other team, click **Accepter**: the message says who accepted, and `#planning` gets
   "Horaire fixé" with a square picture of the match (logos, date, time) to share on social
   networks. Validated results get their own picture in the results channel.
4. `/staff match schedule` sets any time for a match, even outside its week.

The clock checks every minute. A match still without a time when its week ends gets its
extension: the bot sets it to the Sunday 21:00 of the extension week and posts the notice in
`#planning`, pinging both teams. To see it, pick a match of a week that has just ended and has no
time. A match whose Sunday slot has already passed is left to staff.

### The map veto

Run `pnpm seed` once more: it writes the veto sequences into the league's settings.

1. As manager of one team, `/match veto` and pick the match. The bot answers privately "Veto
   lancé" and posts the veto below, pinging both teams. It says who picks the starting side and
   starts (the lower-ranked team), who picks the overtime side and who hosts. On equal ranks (for
   example before any result) it tosses a coin instead: the winner clicks **Choix du côté** or
   **Qui bannit en premier**, the other team makes the other decision, and the message says the
   teams agree on the host.
2. Click a map to ban it, as the team whose turn it is. Clicking out of turn, or on an old button,
   gets a private refusal. The message updates after each click.
3. After the last ban, the remaining map is shown; the side chooser clicks Attaque or Défense,
   then the other team picks the overtime side. The message ends with "Veto terminé".
4. `/match report` on that match: the game already holds the map and the bans.

To test both teams alone, make yourself owner of both with `/team owner`: you then play
whichever turn is due. To see a timeout, lower `step_seconds` in the league's `ruleset_json`
(at least 30), start a veto and wait: the clock picks a random map and the message says
"temps écoulé".

## 12. Exclusion

> **Since 16 November 2026** (step 33): `/staff exclusion` is gone; exclusions move to the website's sanctions page (phase 3f). The steps below are kept as a record.

Run `pnpm discord:register` again (it adds `/staff exclusion`), then restart `pnpm dev` (it applies
migration `0005`).

1. With a test team you own (`/team owner`), record forfeits against it with
   `/staff match forfeit` until it reaches the season's threshold (3 in Season 3; lower it in the
   season's settings to try it faster). At the 2nd, the bot adds a warning; at the 3rd, it
   excludes the team: you get a direct message, the results channel announces it, the staff queue
   explains the 50% rule's outcome.
2. `/standings`: the team is last, marked "Exclue", and its opponents got their forfeit wins.
3. `/staff exclusion reinstate team reason`: the team is back, the table as before.
4. `/staff exclusion auto team enabled:False reason`: the next forfeit at the threshold only
   alerts the staff queue. `/staff exclusion exclude` still works on that team.

Existing Season 3 forfeits exclude nobody by themselves: only a new forfeit that reaches the
threshold does.

## 13. Team requests

> **Since 16 November 2026** (step 33): `/team` is gone: requests are filed and withdrawn on `/teams/<slug>/manage` (step 25). Staff still approve or refuse them with the buttons of the queue post. The steps below are kept as a record.

Run `pnpm discord:register` again (`/team` changes and is now open to every member), then restart
`pnpm dev` (it applies migrations `0006` and `0007`). Migration `0006` turns each team's manager
into its owner and its staff into managers.

You need two Discord accounts: one league staff member, and one team official without the staff
role (a second account, or a friend in the staging server).

1. As staff: `/team owner member:<the other account> team:<a team>`. The staff queue must be set
   (`/league channel`, step 10.2).
2. As that owner: `/team member add member:<anyone> role:Coach note:Test`. You get a private
   answer with the request's number; the staff queue gets the request with **Approuver** and
   **Refuser**.
3. As staff: **Refuser**, type a reason. The post shows the refusal; the owner gets a direct
   message with the reason. File it again, then **Approuver**: the coach is added, and the owner and
   the new coach get a direct message.
4. As the owner: `/team requests` lists what still waits, each with a **Retirer** button.
5. As the owner: `/team member remove member:<the coach>`. It applies at once, the queue gets a
   notice and the coach a direct message. `/team leave` as the owner is refused.

To see the reminder sooner, lower `requests.answer_within_hours` in the league's `ruleset_json`
(for example to 1, with `remind_before_hours` 0): on the next tick after the deadline, the queue
gets a message pinging the staff role with a link to the request.

## 14. Phase 3a: the public website

`pnpm dev` now also starts the website, on this computer only. Its terminal prints
`Website ready` with the address, `http://127.0.0.1:3000` by default (`HOST` and `PORT` in
`.env` change it).

1. Open `http://127.0.0.1:3000` (or `http://localhost:3000` once login is on, section 15): the
   leagues and their seasons.
2. Click **Saison 3**: the standings of each division, the latest validated results and the
   fixtures by week. A result reported but not validated yet shows "En attente de validation",
   never its score.
3. Click a team name: its officials and matches. Click "contre" between two teams: the match,
   with its map and bans once the veto is over.
4. Validate a result in Discord, then reload the season page: the standings follow at once.

Nobody else can open these pages yet: they are not on the internet until the VPS (design doc
section 13).

To show the site to someone on the same home network (Wi-Fi or cable):

1. Find this computer's address on the network: `ip -4 -br addr` (for example `192.168.1.34`).
2. In `.env`, set `HOST=0.0.0.0` (listen on every network card, not only this computer) and,
   when login is on (section 15), `PUBLIC_URL=http://192.168.1.34:3000`. Otherwise the site
   sends the other computer to `localhost`, which is that computer itself.
3. To log in from there, also add `http://192.168.1.34:3000/auth/callback` under OAuth2 >
   Redirects. Use the same address on this computer too: the login cookie belongs to one address.
4. Restart `pnpm dev` and open `http://192.168.1.34:3000` on the other computer. If it does not
   load, the firewall may block port 3000 (`sudo nft list ruleset`).
5. Afterwards, put `HOST=127.0.0.1` and `PUBLIC_URL=http://localhost:3000` back. The address can
   change when the router restarts.

## 15. Phase 3b: logging in with Discord

1. In the Developer Portal, under OAuth2 > Redirects, add `http://localhost:3000/auth/callback`.
2. In `.env`, fill `DISCORD_CLIENT_SECRET` (OAuth2 > Client Secret) and `SESSION_SECRET` (at
   least 32 random characters, for example from `openssl rand -base64 48`). `PUBLIC_URL` stays
   `http://localhost:3000`.
3. Restart `pnpm dev`. Its terminal prints `Website ready` with `http://localhost:3000`. Without
   the two secrets it prints "Website login is off" instead, and the site works without login.
4. Open `http://localhost:3000` and click **Se connecter avec Discord**. Discord asks to share
   your identity (name and avatar only); accept. You come back logged in, your name in the header.
5. Click your name: **Mon compte** lists your teams, and "Staff de la ligue : LFR" when you hold
   the staff role in the staging server. Remove the role in Discord: within a minute, the line
   goes away.
6. Pick a nationality and save; accept the publication of your statistics, then withdraw it.
   Each change is in the audit log.
7. **Se déconnecter** ends the session. A session also ends by itself after 30 days.

`http://127.0.0.1:3000` now redirects to `http://localhost:3000`: the login cookie belongs to one
address.

## 16. Phase 3c: the staff queue on the website

You need the staff role in the staging server, and a second account managing a team (as in
section 10).

1. With the team account, report a result with `/match report`, and file a request with `/team`
   (section 13). Both appear in the staff queue channel, with their buttons.
2. Log in on the website with your staff account. **Mon compte** now has a link **Ouvrir la file
   du staff** (`http://localhost:3000/staff`). It lists the results to validate, with the
   screenshot shown on the page, the disputes, and the team requests with their deadline. The
   server keeps its copy of each screenshot under `data/storage/evidence/` (`STORAGE_DIR`);
   results reported before this change only link to the Discord post.
3. Click **Valider le résultat**. The page says it is validated, and in Discord the report's post
   in the staff queue now reads "validé par" with your name, without buttons. The result is
   announced in the results channel, as with the button.
4. Refuse the request with a reason. Its post in the queue shows the refusal; the team gets the
   reason in a direct message.
5. Click **Approuver** on something already handled in Discord: the page says it was answered
   already, and nothing changes.
6. Remove your staff role in Discord: within a minute, `/staff` and its buttons answer "Action
   refusée".

## 17. Phase 3d-1: clubs and their rosters

1. Restart `pnpm dev`: migration 0009 runs at start-up and gives each team a club of its own.
2. Run `pnpm seed`. It reads the `club` column of `fixtures/lfr-s3-teams.csv` and groups Greed
   (GREED1, GREED2), Nova (NOVA1, NOVA2) and W Mates (WMATES, SPECTRUM), and moves NTS to Not
   Scam. It prints `clubs: 3` created and `clubs: 6` removed: the clubs the migration made for
   those rosters, now empty.
3. Open a team page, for example `http://localhost:3000/teams/greed-esport`: it names its club
   and the club's other team. The club's page, `http://localhost:3000/clubs/greed`, lists both
   rosters and their division.
4. Standings and images look the same: a roster without colours or a logo of its own wears its
   club's.

## 18. Forfeits at 7–0, and a forfeit by both teams

> **Since 16 November 2026** (step 33): `/staff match forfeit` is gone; forfeits move to the match page's staff panel (phase 3f). The steps below are kept as a record.

1. Restart `pnpm dev`: migration 0012 runs at start-up and lets a game be forfeited by both
   teams. Then run `pnpm discord:register`: `/staff match forfeit` gains a third choice for
   `team`, both teams.
2. Run `pnpm seed`: it moves Season 3's forfeit score from 0–0 to 7–0 and prints `seasons: 1`
   updated. `/standings` then gives each team that showed up 7 rounds won for each forfeit.
3. `/staff match forfeit`, `team`: both teams, on a match to play: each team gets a forfeit loss
   and its forfeit count goes up; the results channel says neither team showed up.
4. The same `pnpm seed` lets the opponent validate (it prints `competitions: 1` updated). Report a
   result with `/match report`, then confirm it as the other team: it counts at once, is
   announced in the results channel, and its post in the staff queue says there is nothing to
   do. A result already confirmed before this change still waits for staff on `/staff`.

## 19. Phase 3d-3: the rulebook page

1. Restart `pnpm dev`: migration 0013 runs at start-up and adds the rulebook versions.
2. Open `http://localhost:3000/mlb-group/lfr/rules`: no rulebook is in force yet. The season page links
   to it.
3. Log in as a member with the `Staff` role of the linked server: the page offers
   **Publier une nouvelle version**. Give the version a name, a date from which it is in force,
   and the text in Markdown, then **Publier**. The draft `docs/rules-season-4.md` works as a
   test text, but it is a draft: it says how Ligo applies each rule and lists open questions.
4. Publish a second version with another name: the page shows it once its date has come, and
   lists the first under **Toutes les versions**, marked as an earlier version. A published
   version cannot be changed; a correction is a new version.

## 20. Phase 3d-4a, first part: registering a team

1. Restart `pnpm dev`: migration 0014 runs at start-up. Then `pnpm seed`: it prints
   `Opened Saison 4 for registration`, with placeholder dates (4 January to 14 March 2027).
2. A rulebook must be in force before anyone can register: publish one at
   `http://localhost:3000/mlb-group/lfr/rules/new` (section 19), dated today or earlier.
3. The home page shows **S'inscrire** next to Saison 4. Log in, fill in the club and the team,
   optionally a transparent PNG logo (1 MB at most), accept the rulebook, and send.
4. The registration's page, `/registrations/1`, shows the invitation link to share. Joining from
   it comes in the next step; until then the page lists no player.
5. On `/me`, the **Compte Rainbow Six Siege** form saves your Ubisoft name, your profileID if you
   have it, and your rank.

## 21. Phase 3d-4a, second part: joining a team

1. Set the staging server's invitation link on the website (section 23).
2. Restart `pnpm dev`: migration 0015 runs at start-up. Then `pnpm seed`: it sets LFR's minimum
   age (16).
3. On `/me`, fill in your **Date de naissance**. Nobody else sees it.
4. Open the invitation link from `/registrations/1` while logged in with a **second Discord
   account** (another browser, or a private window): it is the one that joins. The page lists
   what that player must complete on `/me` first. A player who is not on the staging server is
   told to join it, with the link from step 1.
5. Once joined, the player sees the registration on `/me`, with **Quitter l'équipe**; the filer
   sees them on `/registrations/1`.

## 22. Phase 3d-5: the lineup, and `/register`

1. Run `pnpm discord:register` once: `/register` appears. In the server, it answers with the
   link to the registration form, to you alone.
2. On `/registrations/1`, the filer chooses each player's role and the captain (a starter), and
   clicks **Enregistrer l'effectif**. **Retirer** takes a player out.
3. **Nouveau lien** replaces the invitation link: the old one stops working.
4. **Retirer l'inscription**, with its box ticked, withdraws the registration: its players are
   free to join another team.
5. From the season's first day (lineups locked), the page only shows the lineup.

## 23. Phase 3d-6: the league's Discord server on the website

1. Log in with the account that owns the staging server (or holds **Manage Server** there).
   `/me` shows **Serveur Discord de la ligue : LFR**; open it (`/mlb-group/lfr/discord`).
2. In the staging server, make an invitation that never expires: Server Settings > Invites, or
   right-click a channel > **Invite People** > **Edit invite link** > **Expire After: Never**.
3. On the page, check the staff role, paste the invitation, and click **Enregistrer**. The bot
   checks that the link leads to this server and never expires.
4. To move LFR to another server, add the bot there with the page's **Ajoute le bot** link,
   reload, choose the server, then its staff role and its invitation. Its channels must then be
   chosen again with `/league channel`, and `pnpm discord:register` must register the commands
   there (with `DISCORD_GUILD_ID` set to the new server).
5. `pnpm seed` no longer changes LFR's server once it has one: the website is where it changes.

## 24. Phase 3d-7: staff approve registrations

1. Restart `pnpm dev`: migration 0016 runs at start-up. Then `pnpm seed`: it sets LFR's
   division maximum (12).
2. With the staff role, open `http://localhost:3000/staff`: **Inscriptions** lists each
   registration with its players (Ubisoft name, rank, nationality, whether they are ready), what
   it still lacks, and each division's room.
3. **Valider** with a division creates the club (if new, with the filer as owner), the team, its
   place and its players; the logo is copied to `data/assets/render/logos/`. The team's page
   lists its players, and the filer's registration page says where it plays.
4. **Refuser** needs a reason; the filer reads it on the registration's page.

## 25. Phase 3e-1: managing a team on the website

No restart or seed needed beyond `pnpm dev` picking up the change.

1. As a team's owner, open `http://localhost:3000/me` and click **gérer** next to the team.
2. **Ajouter un responsable**: type the person's exact Discord username (not their display name)
   on the league's server, pick the role, **Demander**. The request appears in the staff queue
   channel and on `/staff`, as with `/team member add`.
3. **Retirer la demande** withdraws it; the staff queue post says so.
4. With the staff role, the same page changes the team at once.

## 26. Phase 3e-2: match times on the website

1. Restart `pnpm dev` if it was not running: migration 0017 (where a proposal was posted) runs at
   start-up.
2. As an official or the captain of one side, open a match still to play,
   `http://localhost:3000/matches/<id>`: **Horaire du match** lists the proposals waiting and
   offers the days left in the match's week and extension.
3. **Proposer cet horaire** posts the proposal in the league's schedule channel (`/league
channel`), mentioning the other side, with **Accepter** and **Refuser**.
4. The other side answers on the page or with the buttons; either way the Discord post shows the
   answer, and an agreed time is announced.

## 27. Phase 3d-9: clubs before any competition

1. Logged in, open `http://localhost:3000/me` and click **Créer un club**: the club, its first
   roster (name, tag, colours, logo), and you as owner. No restart or seed needed.
2. The roster's page (`/teams/<slug>/manage`) says it plays in no competition: officials you add
   by Discord username (on LFR's server) apply at once, without the staff queue.
3. **ajouter une équipe au club** adds another roster with its own colours and logo.

## 28. Phase 3d-10: a roster's own players

1. Restart `pnpm dev` if it was not running: migration 0018 (a roster's players and its
   invitation links) runs at start-up.
2. On a roster in no competition (`/teams/<slug>/manage`), **Créer un lien d'invitation** and
   share it. Each player opens it logged in with their own Discord account, completes their R6
   account and nationality on `/me` if asked, then **Rejoindre**.
3. The roster's page lists its players (10 at most, a group setting); **Retirer** removes one,
   and **Nouveau lien** voids the old link. A player leaves from **Équipes où je joue** on `/me`.

## 29. Phase 3d-11: registering a roster

1. Restart `pnpm dev` if it was not running: migration 0019 marks a registration still pending
   from before (one that carried its club and roster) as withdrawn, with an audit row. Its filer
   registers the roster again.
2. With your roster's players on it (section 28), open `http://localhost:3000/mlb-group/lfr/register`:
   pick the roster, accept the rulebook, **Envoyer l'inscription**.
3. On the registration's page, give each player a role (titulaire, remplaçant, or hors effectif)
   and pick the captain among the starters. The page says what a player still lacks, whether one
   is already in another team of the league, and whether one is not on the league's Discord
   server. Any other manager of the roster finds the registration on their `/me` and may change
   the lineup or withdraw it too; a coach may not.
4. On `/staff`, **Valider** into a division gives the roster its place and the season's lineup;
   the club and roster already exist.

## 30. Phase 3e-3: reporting a result on the website

1. Restart `pnpm dev` if it was not running: migration 0020 (where a report's public post is)
   runs at start-up.
2. Log in as an official or the captain of a team with a match still to play, and open the
   match's page (`/matches/<id>`). Under **Résultat du match**, type each team's rounds, pick the
   scoreboard screenshot (PNG, JPEG or WebP, 20 MB at most) and **Déclarer le résultat**.
3. The staff queue gets the report with its buttons. The schedule channel gets it for the other
   team, with **Confirmer** and **Contester**, mentioning its officials and captain.
4. Log in as the other team (or use the buttons in Discord): the match page shows the score and
   the screenshot, **Confirmer**, and a form to contest with a reason. Answering on the website
   removes the buttons from the Discord post.
5. A report made with `/match report` can be answered on the website too.
6. When staff validate or refuse a report (queue button, `/staff match`, or `/staff` on the
   website), or annul the match, the report's public post loses its buttons too.

## 31. Phase 3e-4: the map veto on the website

1. On the page of a match still to play, as an official or the captain of one of its teams, open
   **Veto des cartes** (`/matches/<id>/veto`). League staff can open it by its address.
2. **Lancer le veto**. The veto is posted in the schedule channel with the bot's buttons,
   mentioning both teams.
3. The team whose turn it is clicks a map (then a side) on the page or in Discord. Keep the page
   open in a second browser as the other team: it updates within 3 seconds, without reloading.
4. Each choice made on the website edits the Discord message; once the veto is over, the page
   stops asking for updates.

## 32. Phase 3e-5: the captain for one match

1. Restart `pnpm dev` if it was not running: migration 0021 (`match_captain`) runs at start-up.
2. On the page of a match still to play, as an official or the usual captain of a team with an
   approved lineup, **Capitaine du match** lists the lineup's starters and substitutes. Pick one
   and **Enregistrer**; **Personne** goes back to the usual captain alone.
3. Log in as that player: the match page offers them the result, time and veto actions for that
   match only, and the bot mentions them for it. They cannot name another captain.
4. Once the result is reported, the captain can no longer be changed.

## 33. The bot becomes mostly a getter

Decided on 16 November 2026 (design doc section 3): everything is done on the website; the bot
posts notifications with a link to their page, keeps the buttons that answer them, takes results
with `/match report`, runs the server's channels and looks things up.

1. Run `pnpm discord:register`: `Registered 6 command(s) … /ping, /standings, /match, /league,
/register, /help`. `/staff` and `/team` disappear, and `/match` keeps only `report`.
2. `/standings` posts its images as before, with a line under them linking the season's page
   (Discord shows no preview for it).
3. `/match report` posts the report as before, with the match page's link under it. A time
   proposed on the match page is posted with the same link and its Accept and Decline buttons.
4. Start a veto on its page: the bot's post shows the steps and whose turn it is, with the veto
   page's link, and no buttons. Each choice made on the page, and each step the clock plays,
   edits the post. A veto post made before this change loses its buttons at the next step.
5. `/help` lists the remaining commands (`/league channel` for staff only), and says the rest is
   on the website.

Until the staff pages of phase 3f exist, staff cannot enter a result directly, record a forfeit,
set a match time, give a sanction or exclude a team. Validating and refusing reports and team
requests still works, with the queue's buttons and on `/staff`.

## 34. Phase 3f-2: the staff panel on the match page

No restart beyond `pnpm dev` picking up the change.

1. With the staff role, open a match page: **Actions du staff** is at the bottom. Without the role,
   it is not there, and its forms answer 403.
2. **Saisir le résultat** on a match to play: the result counts at once and is announced in the
   results channel with its picture. The screenshot is optional; when given, only staff see it.
   On a validated match, the same form is **Corriger le résultat**.
3. Report a result as a team, then come back as staff: **Signalement en attente** offers
   **Valider** and **Refuser**. Entering another score instead closes the report: its posts in the
   staff queue and the schedule channel lose their buttons and say the result was replaced.
4. **Forfait** shows each team's forfeits this season and the thresholds, then records a forfeit by
   one team or both; the warning and the exclusion follow as before.
5. **Annuler le match** needs a reason.

## 35. Phase 3f-3: setting a match time on the website

On a match still to play, the staff panel has **Fixer l'horaire**: any day and time, in the
league's time zone, even outside the match's week. Pending time proposals close (their Discord
posts lose their buttons) and the time is announced in the schedule channel with its picture.

## 36. Phase 3f-4: sanctions and exclusions on the website

1. With the staff role, open `http://localhost:3000/staff/sanctions` (linked from the top of
   `/staff`). Each league you are staff of lists its teams with their status, forfeits this season
   and automatic exclusion, then the season's sanctions.
2. **Donner une sanction**: a warning, or points (`-2` takes two away); `/standings` follows at
   once. A sanction is never removed: correct a mistake with the opposite one.
3. **Exclure une équipe** with a reason: its officials get the reason by direct message, the
   results channel announces it without the reason, and the 50% rule applies.
4. **Réintégrer une équipe** on appeal: the team and the results channel are told.
5. **Exclusion automatique**: switch it off for one team with a reason, or back on.

## 37. Phase 3f-5: competitions under their organisation

1. Restart `pnpm dev` if it was not running: migration 0022 renames the seed's organisation "LFR"
   to MBL Group (`mbl-group`), the only change it makes; migration 0026 then fixes the typo to
   MLB Group (`mlb-group`, section 45). The addresses below are the current ones.
2. The season page is `http://localhost:3000/mlb-group/lfr/saison-3`; the rulebook, the
   registration form and the league's Discord page follow (`/mlb-group/lfr/rules`, `/register`,
   `/discord`). Every link on the site and in the bot's messages uses the new form.
3. An old address such as `http://localhost:3000/c/lfr/saison-3` leads to the new one.

## 38. Phase 3f-6: the bot's channels on the website

1. Log in as a member holding the league's staff role, then open `http://localhost:3000/staff`:
   under **LFR**, follow **Salons du bot sur le serveur Discord**
   (`/mlb-group/lfr/discord/channels`). The league's Discord page links to it too.
2. The table shows each purpose (staff queue, schedule, results, then results per division) with
   the channel in use. Each list holds the text channels of the league's server, with their
   category.
3. Choose a channel and click **Enregistrer**: the bot posts its notice there, as with
   `/league channel`, and the table shows the new channel. For a division, the first choice,
   **celui de la ligue**, gives it back the league's results channel.
4. A channel where the bot cannot write is refused with the same message as in Discord, and
   nothing changes. `/league channel` and `/league channels` still work in Discord.

## 39. Phase 3f-9: the mercato's tables

1. Restart `pnpm dev` if it was not running: migration 0023 adds the `mercato_window` table,
   lets a request be a mercato move (`roster_move`), and gives LFR its mercato settings
   (announced windows, 3 moves per team, 24 hours before an incoming player may play). Requests
   already filed are kept as they are.
2. Nothing changes on the site or in Discord yet: the windows page and the moves come next
   (3f-10 to 3f-12).

## 40. Phase 3f-10: mercato windows

1. Choose the league's `#mercato` channel: on `/mlb-group/lfr/discord/channels` (row **Mercato**)
   or with `/league channel kind:Mercato channel:#mercato`. Run `pnpm discord:register` first, so
   Discord offers the new choice. The bot posts a notice there.
2. As league staff, open `http://localhost:3000/staff` and follow **Fenêtres de mercato**
   (`/staff/mercato`). The form is prefilled with LFR's settings: 3 moves per team, 24 hours.
3. Enter the opening and the close (in Paris time) and click **Ouvrir la fenêtre**. The table
   shows it as **À venir** or **Ouverte**, and `#mercato` announces it with its dates, limit and
   block (Discord shows the dates in each reader's own time zone).
4. **Fermer maintenant** closes an open window early; **Annuler** cancels one still to come. Each
   is announced in `#mercato`. Two windows of a season cannot overlap.
5. Teams cannot file moves yet: that is 3f-11.

## 41. Phase 3f-11: a team's mercato page

1. Log in as an owner or manager of a roster playing Season 3, open its manage page and follow
   **Mercato de l'effectif** (`/teams/<slug>/mercato`). League staff can open it too.
2. The page shows the season's lineup. **Passer remplaçant**, **Passer titulaire** and **Nommer
   capitaine** apply at once: they are no moves.
3. Without an open window (step 40), the move form is hidden. Open a window, then reload.
4. A player who should arrive must first join the roster with its invitation link (manage page),
   complete their profile on `/me` and be on the league's Discord server.
5. Choose who leaves, who arrives (or both, a swap counted once) and click **Demander**. The staff
   queue channel gets a post with a link to the page; the move shows **En attente du staff**.
   **Retirer** takes it back and strikes the post through.
6. Staff cannot approve or refuse moves yet: that is 3f-12.

## 42. Phase 3f-12: deciding mercato moves

1. File a move as in step 41. The staff queue post now carries **Valider** and **Refuser**.
2. As league staff, click **Valider** (or use `/staff`, section **Mouvements de mercato**). The
   post shows who approved; `#mercato` announces the move and when the incoming player may play;
   the team member who asked gets a direct message. The team's mercato page shows the incoming
   player as **peut jouer à partir du …** for 24 hours (LFR).
3. **Refuser** opens a form for the reason, which the team member reads in a direct message.
4. Bring in a player who plays for another team (a transfer): approving it takes the player out
   of that team's lineup, and its officials get a direct message, with a note when the player was
   its captain.
5. On a team's mercato page, staff see **Exception du staff**: the move applies at once, even
   without a window, does not count, and is announced with its reason in the staff queue.
6. The team's page and the season page list the approved moves, without their reasons.
7. A player still blocked after a move cannot be named captain for a match.

## 43. Phase 3g: the stat grid

1. Restart `pnpm dev` if it was not running: migration 0024 adds the `stat` and `stat_sheet`
   tables. Nothing already stored changes.
2. Log in as an official or captain of a team whose match has a result (reported or validated)
   and open the match page: it links **Statistiques des joueurs** (`/matches/<id>/stats`). League
   staff see the link too. Nobody else does.
3. One tab per map. Each side has a grid: rounds played, kills, deaths, assists, and headshots
   (optional). An empty row means the player did not play that map.
4. Type a value the map cannot hold (more rounds than the map had, more deaths than rounds): the
   grid lists the problem under the side within a second, before saving. **Enregistrer** with a
   problem saves nothing, keeps what was typed and outlines the cells.
5. Copy rows from a spreadsheet (the numbers only, without the names) and paste them into the
   first cell: the grid fills right then down.
6. Your own side counts at once. You may also enter the other side while that team has not: it
   then shows **elle compte une fois confirmée par …**, and that team's official sees
   **Confirmer la feuille de …**. Once that team entered or confirmed its side, only staff can
   change it.
7. With both sides entered, a red notice warns when one side's kills and the other's deaths
   differ by more than 3 (`ruleset.stats.kills_deaths_tolerance`). It does not block.
8. `ruleset.stats.entry_days` (none in LFR) closes the grid to the teams that many days after
   validation; staff can still correct.
9. Once the match is validated, its page shows each map's scoreboard to everyone: the sheets that
   count (a side the opponent entered appears once its own team confirms it), with K/D, kills per
   round and headshot rate. A player without stats consent is named without figures. The warning
   of step 7 shows on the match page too, to the two teams and staff only.

## 44. Phase 3h: each season's own points

1. Restart `pnpm dev` if it was not running: migration 0025 copies LFR's points and
   tie-breakers into each season's settings. The standings read the season's from now on, so a
   later change for a new season leaves Season 3's table as it is. Nothing visible changes.

## 45. Phase 3h-2: MLB Group and its owner

1. Restart `pnpm dev` if it was not running: migration 0026 renames the organisation MBL Group
   to **MLB Group** (`mlb-group`), gives it its owner (Discord ID `994597181476569170`) and adds
   its invitation, description and logo, all empty for now.
2. LFR's pages are now under `http://localhost:3000/mlb-group/lfr/...`. An old address such as
   `/mbl-group/lfr/saison-3`, from a Discord message the bot posted before, leads to the new one.
3. Nothing else changes on the site yet: the admin panel's pages come next.

## 46. Phase 3h-3: organisations in the admin panel

1. Log in and open `http://localhost:3000/admin`: your organisations, and the competitions
   where you hold the staff role.
2. **Créer une organisation** (`/orgs/new`) works only if you may manage a Discord server where
   the bot is installed; otherwise the page says so and links to the bot's install address. Give a
   name (and an address, or let Ligo make it from the name), a language and a description. You
   become its owner.
3. On the organisation's page (`/admin/<slug>`), its owner changes the name, language,
   description and Discord invitation (Discord checks that it never expires), uploads a logo
   (the same rules as a team's), and may hand the organisation to someone who has logged in to
   Ligo once, by their Discord user ID. Nobody else opens that page.
4. MLB Group's page, `/admin/mlb-group`, opens only for its owner's Discord account.

## 47. Season 3 fixtures: a forfeit by both teams, and RPV's exclusion

1. In `fixtures/lfr-s3-matches.csv`, `forfeit_by` takes `BOTH` when neither team showed up:
   each gets a forfeit loss and nobody wins (O-28). Nightwolves against Outsouki (week 5) is
   recorded so. This file is the only source of truth for Season 3's matches: score7 is no
   longer kept up to date.
2. `fixtures/lfr-s3-teams.csv` has an `excluded` column: the reason a team was excluded from
   the season, empty for a team that plays on. RPV's says it left the LFR, Nova 1's that it
   stopped playing, Starly's that its roster broke up; Nightwolves and Outsouki were excluded at their third forfeit.
3. Run `pnpm seed`: it prints the number of exclusions once and excludes those teams as the website's staff
   exclusion does (its slot, an `exclusion` sanction and the audit entry), recorded as decided by
   the maintainer's account. No Discord announcement is posted. Running it again changes nothing,
   and an exclusion made on the website is never undone by the seed.

## 48. Phase 3h-4: competitions in the admin panel

1. As an organisation's owner, open `/admin/<org>` and follow **Créer une compétition**
   (`/admin/<org>/new`): the game, a name, an address and whether teams or mixed players take
   part. The game, address and mode do not change afterwards. The competition starts with
   defaults: staff validate every result, 3 points per win, one round a week, Paris time.
2. Its page, `/admin/<org>/<competition>`, links to its Discord page: link its server there
   first, as for LFR (section 26).
3. The same page changes the general settings: the name, how results are validated, scheduling
   (time zone, rounds per week, extension weeks, the automatic time or none), who answers each
   kind of team request and how fast, and how many managers and coaches a team may have. The
   organisation's owner and the competition's staff (its server's staff role) open it. A refused
   value keeps what was typed and says what is wrong; nothing is saved then. Every save is
   audited.
4. `/admin` now leads staff to their competition's page.

## 49. Phase 3h-5: a competition's rules

1. From the competition's admin page, follow **Règles de la compétition**
   (`/admin/<org>/<competition>/rules`). The organisation's owner and the competition's staff
   open it.
2. It holds the points and tie-breakers a **new** season copies (a season's own are changed on
   its page, step 3h-6), how a map is won (empty: any score with a winner), the veto (time per
   step, each format's sequence such as `A_ban B_ban A_pick …`, and the decider's side),
   promotion and relegation, registration, the mercato, the stat grid and the dispute reasons
   (three blank rows to add one; empty a row to remove one).
3. Only the tie-breakers the standings compute are offered: points, round difference, rounds
   won and wins.
4. Anything refused keeps what was typed, says what is wrong on its field (or on its section for
   a rule across fields, such as "a BO3 picks 2 maps"), and saves nothing.

## 50. Phase 3h-6: seasons in the admin panel

1. The competition's admin page lists its seasons, the latest first. Follow **Créer une saison**
   (`/admin/<org>/<competition>/seasons/new`): a name and the first and last days. A name
   already used, or one whose address another season has (`Saison 4` and `saison-4`), is
   refused, and so are `rules`, `register` and `discord`.
2. The new season opens for registration at once. It takes the competition's points and
   tie-breakers and the latest season's forfeit scores, thresholds and maps. It has no divisions
   yet (step 3h-7) and no schedule (phase 4).
3. The season's page (`/admin/<org>/<competition>/seasons/<id>`) changes its name, dates,
   points, tie-breakers, forfeit score (each side's rounds won and lost), the 50% rule's forfeit
   score (all four empty: the usual one), the warning and exclusion thresholds (empty: never)
   and the veto's maps, one per line.
4. Try the lock on Season 3, which has results: as staff, change the points; the page says they
   are locked and saves nothing. Change the maps instead; that saves. As MLB Group's owner, the
   same page asks for a reason, which the audit log keeps.
5. **Statut**: the season moves only forward (registration, in progress, cup, finished), skipping
   any it does not use. Registration is open only in the first. Changing the status posts
   nothing on Discord and creates no schedule.

## 51. Phase 3h-7: divisions in the admin panel

1. A season's admin page lists its divisions, top level first. Follow **Ajouter une division**
   (`/admin/<org>/<competition>/seasons/<id>/divisions/new`).
2. A division has a name, a kind (league or regional), a level (1 for the highest), an optional
   region and a short prefix without spaces (`L1`, `SUD`), which names its Discord categories
   and is what `/standings` accepts. A name or prefix the season already has is refused,
   whatever the case.
3. Its results channel is chosen among the league server's text channels; "the league's" means
   the league's results channel applies. The bot posts a message in a newly chosen channel
   before saving, so a channel it cannot write in is refused at once. When Discord does not
   answer, the page says so and leaves the channel as it is.
4. This is the place to give Season 4's divisions their results channels: the channels page
   (`/<org>/<competition>/discord/channels`) shows only the current season's divisions.
5. A division has no schedule yet (phase 4), and cannot be removed.

## 52. Phase 3h-8: the ways into the admin panel

1. Log in as MLB Group's owner: the header shows **Administration** next to your name, leading
   to `/admin`. The header checks only ownership, from the database; it asks Discord nothing.
2. As league staff (the staff role on the league's server), `/me` shows **Administration** under
   the link to the staff queue, and `/staff` links each competition to its admin page
   (**Administration de la compétition**).
3. A player who owns nothing and is staff nowhere sees none of these links; `/admin` still opens
   for them and offers to create an organisation.
4. From `/admin`: an organisation (`/admin/<org>`), its competitions (`/admin/<org>/<comp>`), the
   rules page, each season (`…/seasons/<id>`) and each division (`…/divisions/<id>`).

## 53. Phase 3i: player pages

1. Every account has a public page at `/players/<slug>`; `/me` links to yours (**Ma page
   publique**), team pages link each player of their lineup, and the match scoreboard links each
   name.
2. The page shows the name, nationality, current teams (role and captain), each game account's
   in-game name and declared rank, and whether stats are public. It never shows the Ubisoft
   profile ID, the birth date, the Discord ID or the email.
3. **Carrière**: one line per season lineup, with the division and the team's rank ("en cours"
   while the season runs; `EX` for an excluded team).
4. **Matchs et stats**: a game gets its tab (`/players/<slug>/r6`) once a stat sheet names the
   player in a validated match, verified (their own team's or staff's entry). To try it, enter
   a sheet on `/matches/<id>/stats` for a validated match. The tab shows totals per season and
   per map, then the match log. A player who has not accepted public stats has their matches and
   team results listed, with no figure.
5. On your local database, most pages show a career only: Season 3 has almost no stat sheets.

## 54. Deploying to the VPS: what to prepare

The deployment (design doc section 13) comes in steps D-1 to D-6; the first start is done
together. These accounts and values can be prepared now. Keep every secret in a password
manager; they go into `deploy/.env` on the VPS only, never in git or in a chat.

1. **The VPS.** Note whether the netcup plan is ARM or x86 (either works: images are built on
   the VPS), its IPv4 and IPv6 addresses, and add your SSH public key to it.
2. **DNS at Porkbun.** For `ligoleague.eu` and `www.ligoleague.eu`: an `A` record to the IPv4
   address and an `AAAA` record to the IPv6 one. Caddy gets the HTTPS certificate once they
   point at the VPS.
3. **A production Discord application** (Developer Portal > New Application, for example
   "Ligo"), separate from your staging one, which `pnpm dev` keeps using:
   - Bot: reset and keep the token; turn on **Server Members Intent**;
   - OAuth2: keep the client ID and secret; add the redirect
     `https://ligoleague.eu/auth/callback`;
   - invite it to the staging server with the permissions of section 6 of the design doc.
4. **Cloudflare R2.** Create a bucket (for example `ligo`) and an API token with **Object Read &
   Write** on that bucket only; keep the account ID, access key ID and secret access key. The
   free tier covers 10 GB.
5. **A session secret** for production: `openssl rand -base64 48`, different from your local one.

## 55. Copies of the database before schema changes

Whenever the server (`pnpm dev`), `pnpm db:migrate` or `pnpm seed` is about to apply new
migrations to a database that already has some, it first copies it to `data/backups/`, named
after the first new migration, for example
`ligo-2026-11-20T09-30-15-250Z-before-0029_match_channels.db`. The log says so. A new, empty
database gets no copy. Ligo never deletes these copies: remove old ones yourself when you no
longer need them. To go back to one, stop the server and copy it over `data/ligo.db`.

## 56. Running Ligo on the VPS

The files are in `deploy/` (its README lists them). Everything below runs on the VPS, except
step 1 and the logo copy in step 5. Replace `<vps>` with `ligoleague.eu` once the DNS points at
the VPS, or with its IPv4 address before.

1. **Push `main`** to GitHub: the VPS deploys what GitHub has.
2. **Your SSH key on root.** If netcup gave you a root password: `ssh-copy-id root@<vps>`, then
   check that `ssh root@<vps>` logs in without asking for it.
3. **Prepare the VPS, once,** as root. Read the script before running it:
   ```
   curl -fsSL https://raw.githubusercontent.com/Ligo-League/ligo/main/deploy/setup-vps.sh -o setup-vps.sh
   less setup-vps.sh
   bash setup-vps.sh
   ```
   It installs Docker, creates the `ligo` user with your key, clones the repository into
   `/opt/ligo`, turns on the firewall (22, 80, 443), turns off password logins and sets up the
   nightly copy of the files to R2. From now on, log in as `ligo@<vps>`.
4. **The secrets:** `cd /opt/ligo/deploy && cp .env.example .env && chmod 600 .env`, then fill
   `.env` in with `nano .env` (the values of section 54). They stay in that file only.
5. **The prepared logos**, from your PC (they are not in git):
   `scp -r data/assets/render ligo@<vps>:/srv/ligo/data/assets/`
6. **Start:** `/opt/ligo/deploy/update.sh`. The first time, it builds the image (a few minutes)
   and Caddy gets the HTTPS certificate. It ends with "Deployed …" once the database and Discord
   answer.
7. **Fill the database** (a new one is empty), in `/opt/ligo/deploy`:
   `docker compose run --rm server node packages/db/src/cli/seed.ts`
8. **The slash commands** on the server of `DISCORD_GUILD_ID`:
   `docker compose run --rm --no-deps server node apps/server/src/discord/register.ts`
9. Open `https://ligoleague.eu` and log in with Discord.
10. **Rehearse a restore** (once now, then once a season): `/opt/ligo/deploy/restore.sh --rehearse`
    restores R2's copy into a new folder of `/srv/ligo/data` and checks it, without touching the
    live database. Delete that folder afterwards.

Every day after that:

- **Deploy a change:** push `main`, then `/opt/ligo/deploy/update.sh`. It refuses if files were
  changed by hand on the VPS.
- **Logs:** `cd /opt/ligo/deploy && docker compose logs -f server` (`caddy`, `litestream` alike).
- **Backups:** Litestream copies each change to R2 within seconds (`backups/db`), one full copy
  a night, kept 30 days; the screenshots, logos and the copies before migrations go each night
  at 03:30 (`backups/files`). `systemctl list-timers ligo-backup-files` shows the next one, and
  `/opt/ligo/deploy/backup-storage.sh` runs one now.
- **A new VPS:** steps 2 to 4, then `/opt/ligo/deploy/restore.sh`, which brings back the
  database and the files and starts Ligo. It refuses if a database is already there.

## 57. A test server of your own for local development

From phase 4, Ligo creates and changes roles and channels in the league's Discord server. Two
Ligos managing one server, each with its own database, would fight over it: production
(`ligoleague.eu`) keeps the staging server, and `pnpm dev` moves to a server of its own. Do this
once, before step 4-5 of phase 4.

1. **Create the server.** In Discord: **+** (Add a Server) > **Create My Own** > **For me and my
   friends**, named for example `Ligo Dev`.
2. **A Staff role:** Server Settings > **Roles** > **Create Role**, named `Staff`; give it to
   yourself (Members > your name > **+**). Copy the server's ID and the role's ID (right-click >
   **Copy ID**, with Developer Mode on, step 3.4).
3. **Invite your staging bot** (the application `pnpm dev` uses, not the production one): on
   your local site, open `/mlb-group/lfr/discord` and follow its install link, or use the invite
   address `pnpm discord:register` prints. Pick `Ligo Dev`.
4. **Local `.env`:** set `DISCORD_GUILD_ID` to the new server's ID and `DISCORD_STAFF_ROLE_ID` to
   the new role's ID. Leave the production values on the VPS as they are.
5. **Commands:** `pnpm discord:register` registers the slash commands on `Ligo Dev`.
6. **Move your local LFR** to the new server: start `pnpm dev`, log in on
   `http://localhost:3000`, open `/mlb-group/lfr/discord`, choose `Ligo Dev` and its Staff role,
   and save. Then pick the bot's channels again on `/mlb-group/lfr/discord/channels`, since moving
   forgets the old server's.
7. **Remove the staging bot from the staging server** (Server Settings > Members > the bot >
   **Kick**), so only the production bot answers there and each command shows once.

## 58. Phase 4-4: a season's schedule

The schedule page draws each division's round robin and creates its matches (design doc
section 5, M-45). On your local database, Season 4 has its divisions and no teams yet, so try
it on a season of your own, or approve a few registrations into Season 4 first (section 24).

1. As the organisation's owner or with the staff role, open the season in the admin panel
   (`/admin/mlb-group/lfr/seasons/<id>`) and follow **Calendrier**.
2. For a division with at least two teams, click **Créer le brouillon**. The preview lists each
   week's matches, with the team that rests when the count is odd, and the regular season's last
   day.
3. Tick **Sans match** for a holiday week, or **Un tour de plus** for a week that holds one
   more round, then **Enregistrer le brouillon**: the play weeks move, and their numbers
   (`w1`, `w2`…) follow. **Nouveau tirage** draws again; the weeks you ticked stay.
4. When the last week ends after the season's last day, the page says so: move the season's
   dates, add a round to a week, or tick the box and publish anyway.
5. **Publier le calendrier** creates the matches; the division then shows how many, over how
   many weeks, and the draft's buttons are gone. A published schedule cannot be drawn again.

## 59. Phase 4-5: syncing the league's server

Ligo can now compare the league's Discord server with what it should hold and put it right:
the team roles (4-6) and match channels (4-7) come next, so for now there
is nothing to create. It acts only for a league whose Discord settings turn it on
(`ruleset.discord.manage`, on the competition's admin page since 4-10, section 64).

- **The sync page:** the competition's admin page links **Synchroniser le serveur Discord**
  (`/admin/mlb-group/lfr/discord/sync`). It shows what a sync would change, and **Synchroniser
  maintenant** does it.
- **In Discord:** `/league sync` (staff), `dry_run: True` to only see what would change. Run
  `pnpm discord:register` once for the new subcommand to appear (on the VPS:
  `docker compose run --rm --no-deps server node apps/server/src/discord/register.ts`).
- **On its own:** once the bot is connected, then every 10 minutes.
- **The bot's role** must sit above every team role it manages (Server Settings > Roles, drag
  it up), with Manage Roles and Manage Channels; Discord refuses the rest, and the sync says so.

Never let two Ligos manage one server (section 57): local development uses its own test server.

## 60. Phase 4-6: team roles

With `ruleset.discord.manage` on, each team of a season not closed yet gets a role in the league's
server, named after it (`team_role_template`, `{name}` by default) and in its first colour. The
team's season lineup, its officials and its club's officials hold it; anyone else holding it loses
it. A player who is not on the server is listed by the sync, not an error.

- **Link an existing role:** on the sync page, **Rôles des équipes** lists each team and its role.
  Pick a role already on the server and **Lier ce rôle**: Ligo deletes the one it had made for
  that team (if any), gives the linked role to the team's members and takes it from others, but
  never renames or deletes it. **Délier** gives it back to you as it is; the next sync makes a new
  role for the team. @everyone and the staff roles cannot be linked.
- **When it happens:** within 30 seconds of a change in Ligo (a lineup, an official, a link),
  and every 10 minutes for changes made by hand in Discord.
- **The bot's role must sit above the team roles** (Server Settings > Roles, drag it up), or
  Discord refuses to give them; the sync page lists what Discord refused.

## 61. Phase 4-6: division staff

A division can have its own staff (M-05): the holders of a role of the league's server, picked
on the division's admin page (`/admin/mlb-group/lfr/seasons/<id>/divisions/<id>`, **Rôle du staff
de la division**). They handle that division's matches, results, disputes, forfeits, times,
sanctions and its teams' requests, on the website and with the bot's buttons; the league's staff
keep everything else. @everyone, the league's staff role and a team's role are refused.

To try it: create a role (say `Staff L1`) in the server, pick it for Ligue 1, give it to a
second account, and log in with it. `/staff` shows Ligue 1 only, a Ligue 1 match page has the
staff panel, a Ligue 2 match page and `/admin` do not. A role taken away in Discord stops counting
within a minute.

## 62. Phase 4-7: match channels

With `ruleset.discord.manage` on, each match of a season not closed gets a private channel in
the league's server (the two teams' roles, the league's staff role, the division's staff role and
the bot):

- **When:** `open_days_before_week` days (2) before its week, in the week's category
  (`category_template`, `L1 · Semaine 3` by default; a full category gets a numbered one). Staff
  open a week earlier with `/league week week:<n>` or the schedule page's **Ouvrir ses salons
  maintenant**.
- **Inside:** the bot pins a control message: the fixture, the week and its extension, the host
  and side choice forecast from today's standings, the steps, and buttons to the match's time,
  veto, result and stats pages. Time proposals, the veto, reports and the result card are posted
  there instead of the schedule channel.
- **Archive:** `archive_hours_after_result` hours (48) after the result counts (validated,
  forfeit or annulled), the channel moves to `Archives · <division>` and the teams can only read.
- A match whose result counted before Ligo ever opened its channel gets none: turning management
  on does not fill the server with old matches.
- **Permissions to check:** the bot's role needs Manage Channels, Manage Roles and Pin Messages.
  Add Reactions is not granted in match channels (the bot is not invited with it).

## 63. Phase 4-9: season end

When staff close a season (on its admin page, **Passer à** `Terminée`, then **Oui, terminer la
saison** on the question that follows; only the website closes a season), within 30 seconds the
reconciler:

1. saves each of its match channels to `STORAGE_DIR/transcripts/<season id>/<match id>.json`
   (the nightly `backup-storage.sh` copies it to R2): every message with its author, text,
   times and attachment names, not the attachments themselves;
2. then deletes the channel, and each archive category left empty;
3. removes the season's team roles, as no roster holds a slot in a season under way.

A channel the bot cannot read (it lost View Channel or Read Message History) is kept and tried
again every 10 minutes; the server log says `Some match channel transcripts could not be saved`.
Give the bot back its access, or delete the channel by hand once you have copied what matters:
Ligo then forgets it. To read a transcript, open the JSON file on the VPS
(`docker compose exec server ls /data/storage/transcripts`); no page shows it.

## 64. Phase 4-10: the Discord server settings

The competition's admin page (`/admin/mlb-group/lfr`) has a **Serveur Discord** section:

- **Ligo gère le serveur de la ligue:** the switch for team roles and match channels. Off by
  default. Before ticking it, open **Synchroniser le serveur Discord**: with management off,
  the page shows what turning it on would create, and has no sync button.
- **Nom du rôle d'une équipe** (`{name}` or `{tag}`) and whether anyone may mention team roles.
- **Ouverture des salons de match:** days before the week (0 to 14, 2 by default).
- **Archivage:** hours after the result counts (0 to 720, 48 by default).
- **Names:** the match channel (`w{week}-{tagA}-{tagB}`), the week category
  (`{division} · Semaine {week}`; without `{week}`, one category per division) and the archive
  category (`Archives · {division}`). A placeholder a name may not use is refused on its field.

Renaming a template renames what Ligo already made on its next sync. Every save is audited.

## 65. Testing phase 4 in production

Production serves the staging Discord server, with LFR seeded: Season 3 active (about 23
matches still to play, 17 teams with a place) and Season 4 open for registration. Each step
says what to expect.

**A. Deploy**

1. Push `main`, then on the VPS: `/opt/ligo/deploy/update.sh`. Migrations 0029 to 0032 run at
   start, after a copy of the database in `backups/` (section 55). The log says
   `Copied the database before migrating`.
2. Register the new `/league week` and `/league sync` subcommands, in `/opt/ligo/deploy`:
   `docker compose run --rm --no-deps server node apps/server/src/discord/register.ts`. Reload
   Discord (Ctrl+R).

**B. Prepare the staging server (Discord)**

3. Developer Portal > the production application > **Bot**: **Server Members Intent** on. It
   should already be, since the bot starts only with it.
4. Server Settings > Roles: drag the bot's role **above** every role it will manage (all team
   roles, so near the top). Check that it holds **Manage Roles**, **Manage Channels**, **View
   Channels**, **Send Messages**, **Embed Links**, **Attach Files**, **Read Message History**
   and **Pin Messages**. If the bot was invited before Pin Messages existed, tick it on the role
   by hand.
5. Create one role for a division's staff (for example `Staff L1`) and give it to a second
   Discord account that does not hold the league's staff role.

**C. Preview, then turn it on**

6. `/admin/mlb-group/lfr/discord/sync`: the page says Ligo does not manage the server yet and
   lists what it would do. Expect about 17 roles to create, 23 channels to create and their
   categories, and members to add to roles. Members with no Discord account in Ligo are left
   out.
7. `/admin/mlb-group/lfr`, **Serveur Discord**: tick **Ligo gère le serveur de la ligue**, and
   set **Archivage** to `0` so you can see archiving at once. Then **Enregistrer**.
8. Within 30 seconds: one role per team, coloured from its team or club; Season 3's unplayed
   matches each get a channel `w<week>-<tag>-<tag>` in a category `L1 · Semaine <n>`. Each
   channel's first message is pinned and mentions both teams. Its buttons open the match's
   time, veto, result and stats pages.
9. Open a match channel as @everyone (or a member with no role): it is hidden. As the league's
   staff: visible. Holders of a team role see only their team's channels.

**D. Team roles**

10. On the sync page, **Rôles des équipes**: link an existing role to a team. The role Ligo made
    for it is deleted, and the linked role gets the team's members. Then **Délier**: the next
    sync makes a new Ligo role and leaves yours alone.
11. Change a team's lineup or an official on the website: within 30 seconds the role's holders
    follow.

**E. Division staff**

12. `/admin/mlb-group/lfr/seasons/<Saison 3>/divisions/<Ligue 1>`: pick `Staff L1` as **Rôle du
    staff de la division**. On the next sync, the Ligue 1 match channels let that role in.
13. Log in as the second account: `/staff` shows "LFR (Ligue 1)" with only Ligue 1's queue. A
    Ligue 1 match page has the staff panel; a Ligue 2 match page does not. Registrations and the
    mercato stay with league staff.

**F. Notifications in the match channel**

14. In one unplayed match: propose a time on the match page, start the veto, and report a
    result. Each notice goes to that match's channel, not the schedule channel.
15. Once the result counts (the opponent confirms, or staff enter it), the result card appears
    in the match channel and the results channel. With **Archivage** at `0`, the next check
    moves the channel to `Archives · L1`: the teams still read it but can no longer write.
    Then set **Archivage** back to `48`.

**G. Opening a week early**

16. `/league week week:3` (or **Ouvrir ses salons maintenant** on the schedule page): the bot
    says week 3 is open, in Ligue 1 and Ligue 2; run it again and it says it already was. Nothing
    changes in Discord: Season 3's weeks are past, so their channels are open already. A week
    opening early for real needs a published schedule with weeks still ahead (Season 4).

**H. `/league sync`**

17. In Discord, `/league sync dry_run: True`: the same counts as the page. Rename a match channel
    or a team role by hand, then `/league sync`: the name comes back.

**I. Season end (do it last: a season never goes back to an earlier status)**

18. `/admin/mlb-group/lfr/seasons/<Saison 3>`: **Passer à** `Terminée`, then **Changer le
    statut**. The page asks first: it gives the season's last day (and says when that is still
    ahead) and how many matches have no result. **Oui, terminer la saison** closes it; **Annuler**
    leaves it as it is. Within 30 seconds every Season 3 match channel is deleted, with its emptied
    categories, and the team roles go (Season 4 has no team with a place yet).
19. On the VPS: `docker compose exec server ls /data/storage/transcripts/<season id>` lists one
    JSON file per channel. The next night's copy puts them in R2 (`backups/files`).
20. If a channel stays, the log says `Some match channel transcripts could not be saved`
    (section 63).

## 66. Phase 5-1: the R6 parser

The replay parser is your r6-dissect fork, now a git submodule in `parsers/r6`.

1. After pulling: `git submodule update --init`. A plain `git pull` does not update the fork's
   folder; `git pull --recurse-submodules` does.
2. `pnpm parsers:build` builds `parsers/dist/r6-<hash>.wasm`. Without Go installed, it runs the
   pinned Go Docker image (the first build downloads it, about 300 MB). It takes about 20 seconds.
3. `pnpm fixtures:replays` downloads the test replays into `fixtures/replays/`, which git ignores:
   about 3 GB of official pro replays, one folder per game season. `slc/` holds the Salt Lake City
   Major 2026 (Y11S1), `ewc/` the Esports World Cup 2026 (Y11S2, with many re-hosts) and `eml/`
   the Europe MENA League 2026 stage 2 (Y11S3): 411 rounds.
4. `pnpm parsers:compare` parses every round with the WebAssembly build and the native CLI and
   reports any difference. It takes about 15 minutes.

Since 23 November 2026 the fork's `main` merges prestonwillis10/r6-dissect, the most complete
fork (Y11S2 and Y11S3 fixes, team kills, a time per event that never goes back at a new phase).
The features it removed as unreliable (cheat detection, positions, rooms, gadget events) are on
the fork's `before-prestonwillis10` branch. To take its next fixes: `cd parsers/r6`, `git fetch
prestonwillis10`, `git merge prestonwillis10/main`, then `pnpm parsers:build` and
`pnpm parsers:compare`.

On the VPS, `deploy/update.sh` fetches the submodule (`git submodule update --init`) and the
image builds the parser in a Go stage of the Dockerfile; the first build after this change takes
a minute more.

A change to the fork is committed and pushed in the fork first (`cd parsers/r6`, then `git
commit` and `git push` to your fork), then the new submodule commit is committed in Ligo.

## 67. Phase 5-6: files in R2

From this step the server keeps score screenshots, uploaded logos, channel transcripts and, later,
replays in R2, in the same bucket and with the same token as Litestream (`deploy/.env` already has
them). Locally nothing changes: without the four `R2_*` variables, every file stays in
`data/storage`, and replay uploads go to the server's own route instead of R2.

1. **Let browsers upload to the bucket.** Cloudflare dashboard → R2 → your bucket → Settings →
   CORS policy → Add, and paste:

   ```json
   [
     {
       "AllowedOrigins": ["https://ligoleague.eu"],
       "AllowedMethods": ["PUT"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Only `PUT` from the website: nothing can be read from the bucket by a browser.

2. **Deploy:** `deploy/update.sh`. The server's log then says `Storage ready` with `storage: r2`.
   Screenshots stored before still open: the server reads from `/data/storage` what R2 does not
   have yet.
3. **Copy what was kept on disk**, first as a dry run, from `/srv/ligo/deploy` (or wherever the
   repository is):

   ```bash
   docker compose exec server node apps/server/src/assets/copy-to-r2.ts --dry-run
   docker compose exec server node apps/server/src/assets/copy-to-r2.ts
   ```

   It prints each key it copies and the counts, never a secret. It deletes nothing, skips files R2
   already has, and can run again. `data/storage` stays as it is; the nightly copy goes on saving
   it under `backups/files/`.

4. **Check:** open a match with a score screenshot as staff; it still shows.

The server can now read and delete anything in the bucket, the database backups under
`backups/` included: R2 tokens cover a whole bucket, not a folder. If you would rather keep the
backups out of the server's reach, create a second bucket for them and a token for each bucket
(Litestream and the nightly copy get the backup one), and tell me: only `deploy/compose.yml`
changes.

## If something goes wrong

| Message or symptom                                                                | Cause and fix                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Invalid configuration: DISCORD_TOKEN is missing …`                               | `.env` is absent or a value is empty. Redo step 5.                                                                                                                                                                    |
| `DISCORD_CLIENT_ID is not valid` or `DISCORD_GUILD_ID is not valid`               | An ID must be 17 to 20 digits. You probably pasted the token or a name. Copy the ID again (steps 1 and 3).                                                                                                            |
| `Discord refused DISCORD_TOKEN`                                                   | The token is wrong or was reset. Reset it again (step 2.3) and paste the new one.                                                                                                                                     |
| `Discord refused the Guild Members intent`                                        | Server Members Intent is off. Redo step 2.5 and click **Save Changes**.                                                                                                                                               |
| `Could not register commands: Missing Access`                                     | The bot is not in that server, or `DISCORD_GUILD_ID` is another server's ID. Redo step 4, check step 3.5.                                                                                                             |
| `Could not register commands: 401: Unauthorized`                                  | Wrong token. Redo step 2.3.                                                                                                                                                                                           |
| `/standings` answers "Ce serveur n'est relié à aucune ligue."                     | The server is not linked. Redo step 9: `DISCORD_STAFF_ROLE_ID` in `.env`, then `pnpm seed`.                                                                                                                           |
| `/match` answers "Cette commande est réservée au staff de la ligue."              | You do not hold the role whose ID is in `DISCORD_STAFF_ROLE_ID`. Give yourself the `Staff` role (step 9.1).                                                                                                           |
| `/match report` answers "La ligue n'a pas encore choisi son salon de validation." | The staff queue channel is not set. Run `/league channel` (step 10.2).                                                                                                                                                |
| `/match report` suggests only "Tu n'es ni capitaine ni responsable d'une équipe…" | You are not an official of any team. As staff, add yourself as owner on `/teams/<slug>/manage` (step 25).                                                                                                             |
| `/ping` does not appear when typing `/`                                           | Run `pnpm discord:register` again, then reload Discord (Ctrl+R).                                                                                                                                                      |
| `/ping` appears but answers "The application did not respond"                     | `pnpm dev` is not running, or it stopped with an error. Look at its terminal.                                                                                                                                         |
| `Could not connect to Discord; the website stays up and the bot tries again`      | Discord or the network is down. The site keeps working without the bot, which tries again (5 s, then longer, at most every 5 minutes) and connects once Discord answers. `/healthz` says `"discord":false` meanwhile. |
