# Proposal E · A and C merged

## Direction

E is A, made a platform. It keeps A's frame and density: a charcoal top bar, three columns on desktop, 13 px text and 12 px tables, and summaries on almost every page that double as quick-access menus (tonight, upcoming, standings, latest results, mercato).
From C it takes the components: tabs inside a match (each on its own URL), the clickable round strip, the round pages, and folding the side columns on a phone.
Ligo is the platform, not MBL Group: `/` is Ligo's home, games are entry points, and a competition is a section of Ligo rather than a site inside it.

## Second pass (the maintainer's review of the first E, 16 November 2026)

| Review point | Change |
| --- | --- |
| The calendar had no right column and looked empty | Every page except the private ones has a quick-access column; the calendar, standings, hub, organisation and homes have both (A's left and right). |
| E thinned A's "overcrowded" side columns too much | They are back on almost every page: tonight, upcoming and pending on the left; the standings, latest results and mercato on the right, plus the week's other matches on a match. |
| Side columns work poorly on phones | Each quick-access panel is a `<details>`: open on desktop, folded on phones into a compact menu under the page. Tonight stays in the top bar's "Ce soir" button. |
| Two "Recrutement" links (Ligo's and the competition's) | One: recruitment is a Ligo feature in the top bar, filtered by competition (`/recruitment?comp=lfr`). The competition hub links to it. |
| "A website inside another one" | The competition bar is now a neutral Ligo sub-header: the league shows as a coloured badge, a top rule and the active tab, and "par MBL Group" sits on the right. |
| A's match page was better | The Résumé follows A's order: header with the fact line, veto and match data side by side, the full scoreboard, round by round, then the players of the match. The map is a thin band on top. On phones the scoreboard comes before the veto. |
| A's smaller text was fine | Back to A's sizes: 13 px base, 12 px tables (14 and 13 on phones). |
| Huge empty margins (HLTV) | The page grows to 1720 px and the side columns widen from 1560 px. |
| Some tables overflowed | Panels are CSS containers: when a panel gets narrow (three columns on a laptop), its tables switch to team tags and drop optional columns. `node _build/overflow.ts e-merged --widths=390,768,1024,1280,1440,1920` reports nothing. |

### Which league the quick access follows

A page outside a competition still needs one league for its standings and results. The rule (`templates/quick.ts`):
1. A page inside a competition (hub, standings, calendar, match): that competition, with the match's or page's division first.
2. A team: its division. A player: their current team's division.
3. A logged-in visitor on Ligo's home or a game home: their team's division.
4. Otherwise (logged out on the home, or an organisation page): the leaders of every running competition, and the full tables of the organisation's own.

The reason is named in the panel header ("division du match", "division de GRD", "votre division"), so a visitor knows why they see that table. The focus teams are marked in the table, and their matches and mercato moves come first.

## First pass: what changed since A and C

| Review point | In E |
| --- | --- |
| `/` was MBL Group's home | `/` is Ligo's: today's matches and the running competitions of three organisations, with game tabs. `/r6` is the R6 home. Logged in, "Mes équipes et mes matchs" comes first. |
| The site served MBL and LFR only | Routes are `/:org/:comp/:season`. The competition bar names the organisation, and breadcrumbs start at Ligo. Ligo's name and logo are always in the footer. |
| A's side columns ended up at the bottom of the page on mobile | On a phone, a "Ce soir" button in the top bar opens tonight's matches across Ligo (a `<details>` element, no JavaScript), and the quick-access panels fold (second pass). |
| No images | Map cards in the veto, a map banner on played matches, operator icons in rounds, scoreboards and player pages, player photos with a default image. All are placeholders with the real aspect ratios (see Images). |
| No round breakdown, no operator swaps | A Rounds tab (one row per round: winner, end, site, both teams' operators, MVP) and a page per round: kill feed in feed order, operators with swaps, objective, round MVP. |
| Too much negative space (C) | Three columns from 1280 px, two below, one on phones. Every page fills its width. |

## Pages

47 pages, listed in `index.html` with links to their screenshots (1440 and 390 px, full height, in `../screenshots/e-merged/`).

**Worked pages (19):** the ones reviewed twice.
- **anchors:** Ligo home, Ligue 1 standings, played match;
- **platform:** logged-in home, R6 home, MBL Group;
- **league:** LFR hub and calendar;
- **match to be played:** Aperçu, plus the veto live and finished;
- **played match:** Tableau, Rounds and round 9;
- **team and players:** team, player, player without an accepted policy;
- **private:** workspace and staff queue.

**Reference pages (28):** the rest of the shared list (`_build/pagelist.ts`), so every page has a reference. They use A's templates inside E's frame and are not polished:
- **league:** LFRL and LFV hubs, Ligue 2, German and Dutch standings, FRFL players, team-filtered calendar, cup, leaders, awards, rules;
- **matches:** upcoming seen by a team official, proposed time, BO3 veto, the cup BO3 (one page per map), forfeit, disputed, overtime 8–7, manual stats, unverified replay, replay upload;
- **clubs and teams:** W Mates and Greed clubs, team Tendances and Palmarès;
- **platform:** recruitment, now a Ligo page at `/recruitment?comp=lfr`.

The overtime, manual-stats and unverified matches use E's match page. Forfeit, disputed and cup matches keep A's match header.
A page that leaves a side column empty gets the default quick access.
The old `/c/…` routes resolve to the new pages.

## References and what E takes from each

- **HLTV, Liquipedia, siege.gg (via A):**
  - the dense frame and the panels with small uppercase titles;
  - the infobox on team and player pages;
  - stat tables with abbreviations, a legend and footnotes.
- **Sofascore, FotMob (via C):**
  - the centred match header with the score as the largest thing on the page;
  - tabs inside a match;
  - the round strip as a timeline;
  - single-column phone layouts.
- **VLR.gg:** one sub-page per game and per round, reached from the match header.

## Fonts

IBM Plex Sans (SIL Open Font License 1.1, `fonts/OFL.txt`), one variable TTF with weight and width axes. Its digits are tabular by default, which both the web and Satori need. IBM Plex Mono is for code. Static instances for Satori are in `fonts/satori/`.

Sizes (A's):
- 13 px base, 12 px in tables;
- 14 px on phones (13 px in tables).

## Colours (WCAG contrast, computed with `contrast()` from `_build/lib.ts`)

| Pair | Ratio |
| --- | --- |
| Text #1d2023 on panel #ffffff | 16.37 |
| Muted #5c6268 on panel / on page #e8eaec | 6.17 / 5.12 |
| Top bar text / muted on #222527 | 12.80 / 6.90 |
| Link #1e5aa8 on panel | 6.81 |
| Win #17803d / loss #c22b2b on panel | 5.01 / 5.72 |
| White on LFR #14306b / LFRL #0e4b50 | 12.61 / 9.81 |
| White on the attack / defence operator tiles | 7.04 / 7.84 |
| Ink on the MVP mark #c99a06 | 6.32 |

Results, zones and statuses also carry a letter or a word, so none of them depends on colour alone.

## Theme

A competition sets `--league-primary`, `--league-secondary`, `--league-accent` and `--league-on-primary` (from `competition.theme_json`) on `<body>`. They colour:
- the competition bar and its bottom stripe;
- the active tabs;
- the focus ring.

The Ligo chrome stays neutral. Custom domains and full themes come later (design doc section 18).

## Images

Ubisoft allows its map and operator images on a site that reports matches, paid or not. The maintainer checked this on 16 November 2026: they are forbidden only on merchandise sold and for AI training.

In the mockup, `templates/art.ts` draws placeholders with the production ratios:
- **map art:** 16:9 for veto cards, 4:1 for the banner, a thumbnail in tables;
- **operator icons:** square, warm for attack and cool for defence, ringed when the player swapped operator;
- **player photos:** square, with Ligo's default image when none was uploaded.

In production, each title supplies its images from `packages/titles`, with a text fallback.

## Mobile

- The top bar wraps: games scroll inside their own row, search takes a full row, and "Ce soir" opens tonight's matches.
- Quick-access panels fold into one-line rows under the page; a tap opens one. On desktop a one-line script opens them, and CSS (`::details-content`) keeps them visible without it.
- The page's own side panels (an infobox, the veto sequence) stay open, before the quick access.
- The match header shows tags instead of names.
- Tables keep their priority columns and wrap text rather than scroll.
- The veto cards go to two columns.
- No page scrolls sideways at 390 px; `node _build/overflow.ts e-merged` checks it.

## Hono and htmx

- Each page is one server-rendered `html` template; tabs are links to separate routes.
- **Veto page:** asks the server every 3 seconds with htmx and gets 204 until something changes (design doc section 5). The "Bannir" buttons are forms posting to the veto route.
- **Workspace filters:** a GET form.
- **Round pages:** plain links, so each round has a shareable URL.
- **"Ce soir" panel:** a `<details>` element, no script.
- **Quick-access panels:** `<details>` too. One inline line opens them on desktop; without it, CSS keeps their content visible. A screen reader then hears a collapsed summary over visible content, which the script avoids; production should keep the script.

## Discord and social images

- **Satori:** IBM Plex Sans renders without frozen features, since the default digits are already tabular.
- **Images that take E's look:**
  - `standings`: A's table with the zone letters;
  - `match-card`: the scoreboard with operator icons;
  - `leaderboard`.
- **Images that take B's match header** (big tags on team colours, the framed date and time box): `match-time`, `result` and `game-day`, as decided in the review.

## Weaknesses

- **Placeholders, not artwork:** map and operator art are labelled blocks until real images are wired.
- **Round strip:** it is C's, minus the alive counts. The maintainer will propose a new design when round stats are built.
- **Round MVP:** a weighted stand-in (M-37), not the impact rating.
- **Links to other organisations' pages** (BSL, LLV, LR6) are placeholders: only LFR's pages exist in the mock.
- **Pages from A:** standings, calendar, hub, team and player keep A's templates, with E's frame, sizes, photos and operator icons. Their old `/c/…` links resolve through fallbacks to the new routes.
- **Repetition:** the right column of a match repeats data the calendar and standings already show. That is the point of quick access, but it makes pages long on desktop (the played match is about 1 600 px tall at 1440 px).
- **`::details-content`** needs a 2025 browser (Chrome 131, Safari 18.4, Firefox 143). Older browsers rely on the script.

## Assumptions

- **Route `/r6`** is the R6 game home, and `/rocket-league` and `/valorant` are planned. Global recruitment is at `/recruitment` (filtered with `?comp=`), today's matches at `/matches`. Competitions have no recruitment tab.
- **Search** is a plain GET form; what it searches (teams, players, competitions) is to be decided.
- **"Verified"** is shown on MBL Group only, as an example.
- **The scrim-only teams** (Kraken Five, Les Castors du Jura) are invented, to show clubs with no competition.
