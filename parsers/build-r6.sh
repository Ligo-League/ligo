#!/usr/bin/env bash
# Builds the R6 replay parser (the r6-dissect fork in parsers/r6) for WebAssembly, plus the
# native CLI it is checked against (design doc section 10). Output in parsers/dist/, not in git:
#
#   r6-<hash>.wasm   the parser; <hash> is the start of its SHA-256, so its name is its version
#   wasm_exec.js     Go's loader for it, from the same Go release
#   r6.json          { "version", "wasm" }: which build is current
#   r6-dissect       the native CLI, for parsers/compare-r6.ts
#
# Uses `go` when it is the pinned release, otherwise the pinned Go Docker image.
set -euo pipefail

GO_VERSION=1.27.3
IMAGE="golang:${GO_VERSION}-bookworm"
PARSERS="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$PARSERS/r6/go.mod" ]; then
  echo "parsers/r6 is empty: run git submodule update --init" >&2
  exit 1
fi
mkdir -p "$PARSERS/dist"

# $1: the parsers folder. Same file from the same source: no paths, VCS stamp or build ID.
build() {
  local flags=(-trimpath -buildvcs=false -ldflags=-buildid=)
  cd "$1/r6"
  GOOS=js GOARCH=wasm go build "${flags[@]}" -o "$1/dist/r6.wasm" ./cmd/wasm
  CGO_ENABLED=0 go build "${flags[@]}" -o "$1/dist/r6-dissect" .
  cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" "$1/dist/wasm_exec.js"
}

if command -v go >/dev/null && [ "$(go env GOVERSION)" = "go${GO_VERSION}" ]; then
  build "$PARSERS"
else
  # Go's caches stay in the user's cache folder, so a second build downloads nothing.
  CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/ligo-go"
  mkdir -p "$CACHE/mod" "$CACHE/build"
  docker run --rm --user "$(id -u):$(id -g)" \
    -e HOME=/tmp -e GOCACHE=/go-cache/build -e GOMODCACHE=/go-cache/mod \
    -v "$CACHE:/go-cache" -v "$PARSERS:/work/parsers" \
    "$IMAGE" bash -c "$(declare -f build); build /work/parsers"
fi

HASH="$(sha256sum "$PARSERS/dist/r6.wasm" | cut -c1-16)"
rm -f "$PARSERS"/dist/r6-*.wasm
mv "$PARSERS/dist/r6.wasm" "$PARSERS/dist/r6-$HASH.wasm"
printf '{ "version": "r6-%s", "wasm": "r6-%s.wasm" }\n' "$HASH" "$HASH" >"$PARSERS/dist/r6.json"
echo "Built parsers/dist/r6-$HASH.wasm ($(du -h "$PARSERS/dist/r6-$HASH.wasm" | cut -f1))"
