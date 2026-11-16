# Ligo: design proposals

**Decided (16 November 2026): proposal E is the website's design.** A, B and C stay as older references.
E is a basic design idea, not a final one. Page-by-page decluttering and missing features come later, with feedback from the LFR teams and players.
The mockups also serve as a checklist of the pages and features the website needs.

## Working with the mockups

- **View:** open `index.html` in a browser, or run `npx serve design-proposals`.
- **Rebuild a proposal's HTML** (Node only, no install): `node _build/build.ts e-merged`.
- **Screenshots:** only the thumbnails used by `index.html` are in git. To regenerate the full set (written to `screenshots/`, which git ignores):

  ```
  cd design-proposals
  npm install
  PLAYWRIGHT_BROWSERS_PATH=_tools/browsers npx playwright install chromium-headless-shell
  node _build/screenshots.ts e-merged          # add --fold for first-screen shots
  node _build/overflow.ts e-merged --widths=390,1024,1440
  ```

  The folder has its own `package.json` and is not part of the pnpm workspace, ESLint or Prettier.

## Proposal E (16 November 2026, after the maintainer's review)

The review kept A as the base, simplified with C, and asked for Ligo to be a platform rather than MBL Group’s site. E does that over 19 worked pages and 28 reference pages (the whole shared list); see [e-merged/README.md](e-merged/README.md). The A, B and C sections below are kept as they were.

Shared data added for E:
- **Platform layer** (`_data/platform.ts`): three organisations, seven competitions over three games, other leagues' matches tonight, scrim-only clubs, player photos.
- **Simulator** (`_data/sim.ts`): the kill feed in feed order, operator swaps and a round MVP (a weighted stand-in, M-37). A, B and C keep their numbers because the new values use their own random stream.

# The first three proposals

Static mockups of the public site and the main logged-in pages. All three use one data set:
LFR Season 3 with the real team names, and the mock "now" is Thursday 26 November 2026, 20:40 CET.

Open `index.html` directly in a browser, or run `npx serve design-proposals`.
Rebuild with `node _build/build.ts`, screenshot with `node _build/screenshots.ts <proposal>`.

## State: unfinished (stopped early to save credits)

| Proposal | Real pages (of 42) | Placeholders ("À venir") | README |
| --- | --- | --- | --- |
| A · Site de référence | 40 | workspace, staff | not written |
| B · Ligue officielle | 28 | team (3 tabs), player (2), club (2), cup, leaders, awards, rules, recruitment, workspace, staff | not written |
| C · Application sportive | 36 | leaders, awards, rules, recruitment, workspace, staff | not written |

The anchor pages (home, Ligue 1 standings, played match) exist in all three. They were screenshotted at
1440 and 390 px, with no horizontal overflow at 390. The other pages have not been screenshotted or
reviewed yet, and none of the per-proposal READMEs has been written.

## Comparison (first assessment, from the anchors)

| | A · Référence | B · Ligue officielle | C · App sportive |
| --- | --- | --- | --- |
| Density | Highest: 13 px, three columns, tables everywhere | Lowest: big match hero, condensed caps | Medium: hairline lists, 15 px |
| Mobile | Sidebars stack under the content; usable but desktop-first | Hero stacks well; long pages | Best: designed at 390 px first |
| Theming | One accent strip; the theme barely shows | Strongest: whole fields in the league colours | Header band and active tab |
| Implementation cost | Low: plain tables and panels | Medium: heroes, colour fields, contrast checks per team | Low to medium |
| Fit with the Discord/Satori images | Weak: dense tables don't translate | Best: the hero is the `match-time` image of section 11 | Good for standings and results |
| Risk of looking generic | Low (reads as HLTV/Liquipedia) | Medium (dark esports sites look alike) | Low (reads as Sofascore/BBC) |

## Recommendation

**Use C for the website**, take B's match hero for the images, and A's density for the stats pages.

- **C:** most visitors arrive from a Discord link on a phone. C is the only proposal designed for that first, it is light, and its single tab bar scales to clubs, teams, players and competitions.
- **B's match hero:** the framed date box and the big tags on team colours are exactly LFR's posts. They should become the Satori `match-time`, `result` and `game-day` images, and the hero at the top of C's match page.
- **A's density:** the leaders, team report and staff queue need dense tables with a condensed numeric face. A's 12–13 px tables are the model for those, at desktop width.

## Assumptions to decide

- Ligue 2 has 12 teams, which needs 11 rounds. The seed has 11 weeks, so Ligue 2 shows weeks 1–11, ending 3 January. The brief says 9 weeks for both divisions.
- Display tags are short (GRD, WM, NOV2). The seed's tags are internal codes like NIGHTWOLVES, too long for mobile.
- "NTS kastuki" is kept as the seed spells it.
- `/o/mbl-group` is an assumed route for the organisation page; the design doc names none.
- The Rules page reads `docs/rules-season-4.md` as the rulebook in force, with Ligo's internal notes removed.
- The cup page uses its own mock date (21 January 2027) and projected final ranks.
