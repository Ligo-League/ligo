# parsers

Replay parsers compiled to WebAssembly, one folder per title (design doc section 10).

- `r6/`: the maintainer's r6-dissect fork, as a git submodule
  (`git submodule update --init` after cloning). `r6/cmd/wasm` is Ligo's entry point: it sets a
  global `r6dissect.parseRound(bytes)` that returns one round's JSON (header, kill feed, scoreboard
  stats; no positions).
- `build-r6.sh` (`pnpm parsers:build`): builds `dist/r6-<hash>.wasm`, Go's `wasm_exec.js` and the
  native CLI, with the pinned Go release, from its Docker image when Go is not installed. The
  build is reproducible: the same source gives the same file, so the hash names the version.
- `fetch-replays.sh` (`pnpm fixtures:replays`): downloads the real replays of the golden tests
  into `fixtures/replays/` (not in git): official pro replays of Y11S1, Y11S2 and Y11S3.
- `pnpm parsers:compare` (`tooling/compare-r6.ts`): parses every replay with both builds; any
  difference blocks a parser release.

`dist/` is not in git.
