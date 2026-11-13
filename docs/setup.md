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

| Command                 | What you should see                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`          | Ends with `Done`                                                                                                    |
| `pnpm db:migrate`       | `Migrations applied to …/data/ligo.db`                                                                              |
| `pnpm seed`             | `Created 1 org, 1 competition, 1 season, 2 divisions, 22 teams, 22 slots; …`, then a line for the matches           |
| `pnpm discord:register` | `Registered 7 command(s) in guild …: /ping, /standings, /match, /staff, /team, /league, /help`, then the invite URL |
| `pnpm dev`              | A log line containing `"msg":"Discord client ready"`; the command keeps running                                     |

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

The bot now reads the database, and it needs to know which server is LFR's and who its staff are.

1. In `Ligo Staging`, open **Server Settings** > **Roles** > **Create Role**, name it `Staff` and
   save. Give the role to yourself (right-click your name > **Roles**).
2. Right-click the `Staff` role in the role list and choose **Copy Role ID**.
3. Add it to `.env`:

   ```
   DISCORD_STAFF_ROLE_ID=the Role ID you just copied
   ```

4. Run these, in order:

| Command                 | What you should see                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm seed`             | `Created 2 stages, 22 entries, 111 matches; …` and `Discord server …: link to LFR created.`    |
| `pnpm discord:register` | `Registered 7 command(s) in guild …: /ping, /standings, /match, /staff, /team, /league, /help` |
| `pnpm dev`              | `"msg":"Database ready"`, then `"msg":"Discord client ready"`                                  |

Then type `/standings` in any channel of `Ligo Staging`: after a second the bot posts one image
per division, visible to everyone. `/standings division:L2` posts one division, and
`/standings format:Texte` posts the tables as text.

The matches come from `fixtures/lfr-s3-matches.csv`, a copy of score7 taken with
`pnpm fixtures:score7`. To follow score7 during the shadow run, run that command and then
`pnpm seed` again: new results are added, and a result already stored is never rewritten. If a
stored result differs from score7, `pnpm seed` lists it and changes nothing.

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
3. `/team manager team:<a team> member:<a Discord member>` for the two teams of a match that is
   still to play. To test alone, make yourself manager of both. `/team staff list` shows a team.

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
   starts (the lower-ranked team), who picks the overtime side and who hosts. On equal ranks it
   says it drew at random.
2. Click a map to ban it, as the team whose turn it is. Clicking out of turn, or on an old button,
   gets a private refusal. The message updates after each click.
3. After the last ban, the remaining map is shown; the side chooser clicks Attaque or Défense,
   then the other team picks the overtime side. The message ends with "Veto terminé".
4. `/match report` on that match: the game already holds the map and the bans.

To test both teams alone, make yourself manager of both with `/team manager`: you then play
whichever turn is due. To see a timeout, lower `step_seconds` in the league's `ruleset_json`
(at least 30), start a veto and wait: the clock picks a random map and the message says
"temps écoulé".

## 12. Exclusion

Run `pnpm discord:register` again (it adds `/staff exclusion`), then restart `pnpm dev` (it applies
migration `0005`).

1. With a test team you manage (`/team manager`), record forfeits against it with
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

## If something goes wrong

| Message or symptom                                                                | Cause and fix                                                                                               |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Invalid configuration: DISCORD_TOKEN is missing …`                               | `.env` is absent or a value is empty. Redo step 5.                                                          |
| `DISCORD_CLIENT_ID is not valid` or `DISCORD_GUILD_ID is not valid`               | An ID must be 17 to 20 digits. You probably pasted the token or a name. Copy the ID again (steps 1 and 3).  |
| `Discord refused DISCORD_TOKEN`                                                   | The token is wrong or was reset. Reset it again (step 2.3) and paste the new one.                           |
| `Discord refused the Guild Members intent`                                        | Server Members Intent is off. Redo step 2.5 and click **Save Changes**.                                     |
| `Could not register commands: Missing Access`                                     | The bot is not in that server, or `DISCORD_GUILD_ID` is another server's ID. Redo step 4, check step 3.5.   |
| `Could not register commands: 401: Unauthorized`                                  | Wrong token. Redo step 2.3.                                                                                 |
| `/standings` answers "Ce serveur n'est relié à aucune ligue."                     | The server is not linked. Redo step 9: `DISCORD_STAFF_ROLE_ID` in `.env`, then `pnpm seed`.                 |
| `/match` answers "Cette commande est réservée au staff de la ligue."              | You do not hold the role whose ID is in `DISCORD_STAFF_ROLE_ID`. Give yourself the `Staff` role (step 9.1). |
| `/match report` answers "La ligue n'a pas encore choisi son salon de validation." | The staff queue channel is not set. Run `/league channel` (step 10.2).                                      |
| `/match report` suggests only "Tu ne gères aucune équipe…"                        | You are not manager or staff of any team. Run `/team manager` (step 10.3).                                  |
| `/ping` does not appear when typing `/`                                           | Run `pnpm discord:register` again, then reload Discord (Ctrl+R).                                            |
| `/ping` appears but answers "The application did not respond"                     | `pnpm dev` is not running, or it stopped with an error. Look at its terminal.                               |
