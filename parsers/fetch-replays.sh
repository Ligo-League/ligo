#!/usr/bin/env bash
# Downloads the real replays the R6 golden tests read (design doc section 14) into
# fixtures/replays/, which git ignores: they are about 1 GB. To start, the official replays of the
# BLAST R6 Salt Lake City Major 2026 playoffs, which Ubisoft publishes on the R6 Esports website:
# 11 maps in 14 lobbies, with re-hosted maps (Fortress, Chalet) and overtimes. A file already
# there with the right SHA-256 is not downloaded again.
set -euo pipefail

FIXTURES="$(cd "$(dirname "$0")/.." && pwd)/fixtures/replays"
BASE="https://static-dm-3rdp.akamaized.net/rainbowsixsiege/esports/replays/2026%20Match%20Replays/SLC26"

# name, SHA-256, path under BASE
REPLAYS=(
  "BR62026_SLC_DAY7_DZvWC.zip c86d1824bfed317c39bb2d1a32e3cc4e9afb3a5dc137eeb67c174877d6571a53 BR62026_SLC_DAY7_DZvWC.zip"
  "BR62026_SLC_DAY8_DZvFAZE.zip 67be2d19790c4196c8d856337aa4715febc47c7c05405f95864587a4bf4fba00 BR62026_SLC_DAY8_DZvFAZE.zip"
  "BR62026_SLC_DAY8_SRvTM.zip b2d4fe4d73bf2e408560e37b373d5156943644b8feb79fd7ab8737965d78afc2 BR62026_SLC_DAY8_SRvTM.zip"
  "BR62026_SLC_DAY9_DZ_vSR.zip e90d1a04534ef36bf134cf5f49f79f256d9dc4010e031bc8cc944daa96f5833d BR62026_SLC_DAY9_DZ%20vSR.zip"
)

mkdir -p "$FIXTURES/zips" "$FIXTURES/slc"
for entry in "${REPLAYS[@]}"; do
  read -r name sum path <<<"$entry"
  zip="$FIXTURES/zips/$name"
  if [ ! -f "$zip" ] || ! echo "$sum  $zip" | sha256sum --check --status; then
    echo "Downloading $name"
    curl --fail --location --silent --show-error -o "$zip.partial" "$BASE/$path"
    echo "$sum  $zip.partial" | sha256sum --check --status || {
      echo "$name: unexpected SHA-256, not kept" >&2
      rm -f "$zip.partial"
      exit 1
    }
    mv "$zip.partial" "$zip"
  fi
  # Unpacked once; the zips store their folders read-only, so they are made writable.
  if [ ! -f "$FIXTURES/slc/.$name.done" ]; then
    unzip -q -o "$zip" -d "$FIXTURES/slc"
    chmod -R u+w "$FIXTURES/slc"
    touch "$FIXTURES/slc/.$name.done"
  fi
done
echo "Replays in fixtures/replays/slc: $(find "$FIXTURES/slc" -name '*.rec' | wc -l) rounds"
