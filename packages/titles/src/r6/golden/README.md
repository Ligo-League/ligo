# R6 golden rounds

`<name>.round.json` is what the R6 parser build `r6-d9b08239c222f3f9` returned for one round
of the pro replays that `pnpm fixtures:replays` downloads (as `parsers/dist/r6-dissect <file> -f
json` prints it; `pnpm parsers:compare` checks the WebAssembly build returns the same).
`<name>.unit.json` is what `normalizeR6` makes of it: `normalize.golden.test.ts` compares the two
byte for byte, and checks the facts written there by hand.

After a parser or normaliser change, regenerate with `pnpm exec vitest run --project titles -u` and
read the diff before committing it.

Online custom games (EML, Y11S3) carry real profileIDs; LAN builds (SLC Y11S1, EWC Y11S2)
write them as zeros.

| Round | Source, under `fixtures/replays/` |
| ----- | --------------------------------- |
| `online-disabled-defuser` | `eml/1. G2 vs GEEKAY/1. Villa/Match-2026-10-13_17-06-46-22220/Match-2026-10-13_17-06-46-22220-R01.rec` |
| `time-clutch-1v2` | `eml/1. G2 vs GEEKAY/1. Villa/Match-2026-10-13_17-06-46-22220/Match-2026-10-13_17-06-46-22220-R07.rec` |
| `defused-bomb` | `eml/1. SHIFTERS v TM/1. Lair/Match-2026-10-15_17-14-34-10300/Match-2026-10-15_17-14-34-10300-R01.rec` |
| `team-kill` | `eml/1. SHIFTERS v TM/1. Lair/Match-2026-10-15_17-14-34-10300/Match-2026-10-15_17-14-34-10300-R04.rec` |
| `death-event` | `eml/2. FALCONS vs GEEKAY/2. Chalet/Match-2026-10-13_21-08-56-22220/Match-2026-10-13_21-08-56-22220-R09.rec` |
| `interrupted` | `ewc/Day 10/Match 1 - DarkZero vs. Geekay Esports/1 - Nighthaven Labs/Match-2026-08-15_14-16-57-32928/Match-2026-08-15_14-16-57-32928-R03.rec` |
| `clutch-1v3` | `ewc/Day 8/MATCH 1 - Geekay Esports vs. Team Secret/2 - Nighthaven Labs/Match-2026-08-13_17-11-43-54876/Match-2026-08-13_17-11-43-54876-R04.rec` |
| `no-win-condition` | `ewc/Day 9/Match 2 - FaZe Clan vs. Geekay Esports/2 - Consulate/Match-2026-08-14_20-32-33-5320/Match-2026-08-14_20-32-33-5320-R08.rec` |
| `empty-4v5` | `slc/1. DZ v REBELLION/2. Chalet/Match-2026-05-17_17-18-29-14704/Match-2026-05-17_17-18-29-14704-R02.rec` |
