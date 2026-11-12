# CLAUDE.md — Ligo

Ligo is a league platform for esports competitions: a Discord bot, a website, a league engine
(schedules, standings, brackets) and replay-based stats. First user: LFR (French Rainbow Six Siege
league, Ligue 1 and Ligue 2; 10 and 12 teams in Season 3, and a division's size is data, never a
constant). Later: other leagues (Benelux R6, LFV Valorant,
LFRL Rocket League, FRFL FACEIT mixed R6) on the same instance.

The full specification is `docs/design.md` (the design document). **Read the relevant section
before starting any task.** If this file and the design document disagree, the design document wins;
point out the conflict instead of guessing.

## How we work

The maintainer manages, designs and reviews. You write the code. The process is:

1. **Plan first.** For any task bigger than a small fix, reply with a plan before writing code:
   files to create or change, schema changes, new dependencies, tests, and open questions.
   Wait for approval.
2. **One phase, one feature at a time.** Work only on the roadmap phase or feature you were given
   (design doc section 15). Don't build ahead, don't add "while I'm here" features.
3. **Small changes.** Aim for diffs a human can read in one sitting (roughly under 400 lines,
   excluding generated migrations and fixtures). Split larger work into steps.
4. **Tests first in `packages/core`.** Write or update the tests, show them, then implement.
5. **Ask, don't invent.** League rules come from the design doc and the LFR rulebook. If a rule is
   missing or ambiguous (section 16 lists open questions), stop and ask. Never invent a rule.
6. **Finish with a check.** End every task by running `pnpm typecheck`, `pnpm lint` and `pnpm test`,
   and report the results honestly, including failures.

## Stack

- TypeScript (strict) on the current Node LTS, pnpm workspaces.
- Discord: discord.js. HTTP: Hono with server-rendered JSX; htmx for forms; small Preact islands
  only for the replay uploader and the stat grid.
- Database: SQLite (WAL) with better-sqlite3 and Drizzle ORM; migrations via drizzle-kit.
- Validation: zod everywhere data crosses a boundary (HTTP input, JSON columns, parser output).
- Images: Satori + @resvg/resvg-js. Storage: Cloudflare R2 via @aws-sdk/client-s3 (presigned URLs).
- Replay parsing: each title's parser compiled to WebAssembly, run in a Web Worker in the browser
  and in a Node worker thread on the server. R6 = the maintainer's r6-dissect fork (Go → WASM).
- Tests: Vitest, fast-check for property tests.
- Deployment: Docker Compose (caddy, server, worker, litestream) on one VPS.

Do not add a dependency without saying why in the plan. Prefer the standard library and the
packages above.

## Repository layout

```
packages/core      pure league logic: round robin, standings, tie-breakers, forfeits, brackets,
                   promotion, veto, stitching, stat formulas. NO I/O.
packages/titles    one folder per title: metric schema, ruleset defaults, consistency checks,
                   replay normaliser
packages/parsers   ParserModule interface + WASM loaders (browser and Node)
packages/db        Drizzle schema, migrations, query helpers
packages/render    Satori templates, fonts, resvg wrapper
apps/server        discord.js client + Hono site/API + reconciler (one process)
apps/worker        job runner: verify replays, stitch, render images
parsers/r6         r6-dissect fork (git submodule) + cmd/wasm + build script
deploy/            compose.yml, Caddyfile, litestream.yml, restore.sh
docs/design.md     the design document
```

### Dependency rules (enforced in review)

- `packages/core` and `packages/titles` import nothing that does I/O: no database, no Discord,
  no fetch, no filesystem, no `Date.now()` (pass time in as a parameter).
- Apps depend on packages; packages never import apps.
- Discord commands and HTTP routes are thin adapters. Logic lives in service functions under
  `apps/server/src/services/`, which both adapters call. Never put logic in a command handler.
- Only `apps/server` talks to Discord.

## Commands

```
pnpm install
pnpm dev            # server with watch mode, against the staging Discord server
pnpm worker         # job worker
pnpm test           # all tests
pnpm test:core      # packages/core only
pnpm typecheck
pnpm lint           # ESLint, then Prettier in check mode
pnpm format         # Prettier: rewrite files in place
pnpm db:generate    # drizzle-kit: create a migration from schema changes
pnpm db:migrate     # apply migrations to the local database
pnpm seed           # load fixture data (LFR teams, Season 3 fixtures/results)
pnpm discord:register   # register slash commands to the staging guild only
```

Keep this list in sync with `package.json` when scripts change.

## Domain rules you must not get wrong

These are summaries; the design doc (sections 4, 5, 8, 9) has the details.

- **Standings are computed, never stored or hand-edited.** From matches with status `validated` or
  `forfeit`, plus `sanction` point deltas. LFR: 1 point per win, no draws, F = rounds won,
  C = rounds lost, D = F − C, ranking by points then D, then the `unresolved_tie` setting.
- **Results count only after staff validation** in LFR (`result_validation: 'staff'`). A result
  needs a screenshot `evidence` row.
- **Only staff can record a forfeit.** Forfeit score is a season setting (0–0 or 7–0).
  Exclusion applies the 50% rule (design doc section 5).
- **Every staff mutation writes `audit_log` in the same transaction.**
- **Results are never hard-deleted**; use status `void`.
- **R6 players are identified by Ubisoft `profileID`, never by username.** Teams in replays are
  resolved from players' `profileID`s against lineups, never from team names.
- **R6 kill-feed order is feed order.** `timeInSeconds` is a countdown clock that resets after a
  plant; never sort events by it. Derive `elapsed_s`.
- **Handle `Death` and `PlayerLeave` events**, not only `Kill`.
- **Replays never decide a result on their own**; they add stats and cross-check the score.
  Browser-parsed JSON is untrusted until the server re-parses the raw file and it matches.
- **Stats are additive.** Store totals, sum first, divide last. Never average per-match ratios.
- **Players without stats consent** appear in rosters and results, but not on stat pages or
  leaderboards.
- **Discord objects are found by stored ID, never by name.** All channel/role changes go through
  the reconciler.
- **Avoid set in stone rules.** Whenever possible, as long as it doesn't overly complexify the
  server, propose a way to turn a rules into multiple settings so that different league kinds
  can exist.

## Code conventions

- TypeScript `strict`, no `any` (use `unknown` + zod). No non-null assertions without a comment
  explaining why it's safe.
- Pure functions in `packages/core` take plain data and return plain data. Return a result object
  for expected failures (`{ ok: false, error }`); throw only for programmer errors.
- Timestamps are Unix milliseconds UTC in storage; display in Europe/Paris.
- IDs: integer primary keys; URL slugs for teams, players, competitions.
- Configuration that a league might change (points, tie-breakers, veto sequences, map pool,
  forfeit score, scheduling) lives in competition/season settings validated by zod, not in code.
- User-facing text goes through a message catalog (French first, English second); no hard-coded
  strings in templates or bot replies.
- Names in code are English; comments explain _why_, not _what_.

## Testing expectations

- `packages/core`: every rule has tests. Use fast-check for the round robin and the veto state
  machine. Include the edge cases listed in design doc section 14 (three-way ties, the 50% rule,
  re-host stitching cases).
- Standings must reproduce real LFR tables (Season 2 example, Season 3 shadow run).
- R6 normaliser: golden-file tests on real replays in `fixtures/replays/` (git LFS or a download
  script; never commit large binaries directly).
- Discord and R2 are behind interfaces with in-memory fakes; unit tests never hit the network.
- Don't weaken or delete a failing test to make a change pass. Report it.

## Security

Review these areas line by line and flag anything uncertain in your summary:

- Discord OAuth callback, sessions (signed `httpOnly` `SameSite=Lax` cookies), CSRF tokens on POST.
- Permission checks happen server-side on every command, button click and route, re-reading the
  current state from the database. Discord's own visibility settings are cosmetic.
- Presigned R2 URLs: short expiry, exact key and size, PUT only, rate-limited per user and match.
- Uploaded files are untrusted: size limits, `sha256` dedupe, parsing in a worker thread with a
  memory cap and timeout.
- Never log tokens, cookies, or presigned URLs. Secrets come from environment variables only;
  never commit `.env`.
- MOSS files and other staff-only evidence are never served publicly.

## Hosting and domain: notify the maintainer

The maintainer has **not bought a domain or a VPS yet**. Development runs on localhost.

In every task, check whether the work reaches one of the triggers below. If it does, **say so
explicitly at the start of your plan**, before anything else: which trigger, why a public website,
domain or VPS is now useful or necessary, and the cheapest option that covers it. Never assume
hosting exists, and never bury this in the middle of a plan.

Triggers:

- Discord OAuth login needs a stable public redirect URL (not localhost) for real users (phase 3).
- Teams or staff outside the maintainer's machine need to open pages, e.g. to test registration or
  the veto.
- Browser uploads to R2 need a fixed origin for CORS (phase 5).
- The bot must run 24/7, not only while the maintainer's PC is on (before Season 4, or any shadow
  run with real teams).
- The league announcement, where a public address appears on social media.

Until a trigger is reached:

- Prefer local development: localhost, the staging Discord server, a local SQLite file.
- When something must be reachable briefly, prefer a free temporary option, such as a free
  Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:3000`). Its address changes
  on every run, so it suits a test session, not a redirect URL stored in Discord.

Known cheap options to suggest:

- Domain: `ligoleague.be` or `ligoleague.eu` (about €10 a year); `ligo.gg` later if the league grows.
- Server: the OVHcloud VPS-1 from design doc section 13.

When no trigger applies, one line in the plan is enough: "Hosting: nothing needed for this task."

## Don't

- Don't change the database schema without a migration and a note in the plan.
- Don't regenerate a published schedule; schedule changes are audited match edits.
- Don't add features from later roadmap phases.
- Don't introduce a SPA framework, an ORM other than Drizzle, Redis, or Postgres without approval.
- Don't call external APIs (Riot, FACEIT, ballchasing) unless the task is about that integration.
- Don't touch `parsers/r6` (the fork) unless the task says so.
- Don't guess league rules. Ask.

## When you finish a task

Reply with:

1. What changed (files, schema, behaviour), in a few lines.
2. Test, typecheck and lint results.
3. Anything you're unsure about, especially security or league rules.
4. What's left for the phase, if anything.
