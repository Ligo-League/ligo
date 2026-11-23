#!/usr/bin/env bash
# Downloads the real replays the R6 golden tests read (design doc section 14) into
# fixtures/replays/, which git ignores: about 3 GB. They are official pro replays Ubisoft
# publishes on the R6 Esports website, one folder per game season:
#
#   slc/  Y11S1  BLAST R6 Salt Lake City Major 2026, playoffs: 11 maps in 14 lobbies
#   ewc/  Y11S2  Esports World Cup 2026, days 8 to 10: 17 maps in 25 lobbies (many re-hosts)
#   eml/  Y11S3  Europe MENA League 2026 stage 2, days 12 to 14: 9 maps
#
# A file already there with the right SHA-256 is not downloaded again.
set -euo pipefail

FIXTURES="$(cd "$(dirname "$0")/.." && pwd)/fixtures/replays"
MAJOR="https://static-dm-3rdp.akamaized.net/rainbowsixsiege/esports/replays/2026%20Match%20Replays"
EWC="https://static-esports.ubisoft.com/esports-platform/r6s/replays/ewc26/StreamA/StreamA"

# folder, file name, SHA-256, address
REPLAYS=(
  "slc BR62026_SLC_DAY7_DZvWC.zip c86d1824bfed317c39bb2d1a32e3cc4e9afb3a5dc137eeb67c174877d6571a53 $MAJOR/SLC26/BR62026_SLC_DAY7_DZvWC.zip"
  "slc BR62026_SLC_DAY8_DZvFAZE.zip 67be2d19790c4196c8d856337aa4715febc47c7c05405f95864587a4bf4fba00 $MAJOR/SLC26/BR62026_SLC_DAY8_DZvFAZE.zip"
  "slc BR62026_SLC_DAY8_SRvTM.zip b2d4fe4d73bf2e408560e37b373d5156943644b8feb79fd7ab8737965d78afc2 $MAJOR/SLC26/BR62026_SLC_DAY8_SRvTM.zip"
  "slc BR62026_SLC_DAY9_DZ_vSR.zip e90d1a04534ef36bf134cf5f49f79f256d9dc4010e031bc8cc944daa96f5833d $MAJOR/SLC26/BR62026_SLC_DAY9_DZ%20vSR.zip"
  "ewc Day_8-20260814T102432Z-1-001.zip ea6f3f2679bddb47249c8cf400ff9aa9f9bbd01c1052aa0086257b447025ead5 $EWC/Day%208-20260814T102432Z-1-001.zip"
  "ewc Day_9-20260817T085114Z-1-001.zip 06fe318ec8c6a5786357288426011a846709948fb586bbcab5df577968fbbc2b $EWC/Day%209-20260817T085114Z-1-001.zip"
  "ewc Day_10-20260817T085159Z-1-001.zip adacc35d9192ef6a8d178c736f92a69a6895c3fc96e4c3856ae896b308e34709 $EWC/Day%2010-20260817T085159Z-1-001.zip"
  "eml BR62026_EML_S2D12_GKvVP.zip e573b3369cd1d276b82970b53a23a712d2cda0afc64b32bbf71ccfd8195a5158 $MAJOR/LEAGUES%2026/BR62026_EML_S2D12_GKvVP.zip"
  "eml BR62026_EML_S2D13_FLCvGK.zip 5b1fca770b1f98d5631955449767ea9f25f45c20d12216ca35b8ba7fd20a02cc $MAJOR/LEAGUES%2026/BR62026_EML_S2D13_FLCvGK.zip"
  "eml BR62026_EML_S2D13_G2vGK.zip fe7758c70a4898964f949340706986a13f246cc1463cd6fd80c828a165ea795c $MAJOR/LEAGUES%2026/BR62026_EML_S2D13_G2vGK.zip"
  "eml BR62026_EML_S2D14_SHIvTM.zip 5fbc5cbc932f7831682320342f39e3e68bab85b29f4dc4d615d820be131b77d2 $MAJOR/LEAGUES%2026/BR62026_EML_S2D14_SHIvTM.zip"
)

mkdir -p "$FIXTURES/zips"
for entry in "${REPLAYS[@]}"; do
  read -r folder name sum url <<<"$entry"
  zip="$FIXTURES/zips/$name"
  if [ ! -f "$zip" ] || ! echo "$sum  $zip" | sha256sum --check --status; then
    echo "Downloading $name"
    curl --fail --location --silent --show-error -o "$zip.partial" "$url"
    echo "$sum  $zip.partial" | sha256sum --check --status || {
      echo "$name: unexpected SHA-256, not kept" >&2
      rm -f "$zip.partial"
      exit 1
    }
    mv "$zip.partial" "$zip"
  fi
  # Unpacked once; the zips store their folders read-only, so they are made writable.
  mkdir -p "$FIXTURES/$folder"
  if [ ! -f "$FIXTURES/$folder/.$name.done" ]; then
    unzip -q -o "$zip" -d "$FIXTURES/$folder"
    chmod -R u+w "$FIXTURES/$folder"
    touch "$FIXTURES/$folder/.$name.done"
  fi
done
for folder in slc ewc eml; do
  echo "$folder: $(find "$FIXTURES/$folder" -name '*.rec' | wc -l) rounds"
done
