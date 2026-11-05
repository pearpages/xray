#!/usr/bin/env bash
# Runs the xray CLI from a checkout of pearpages/xray kept in the plugin's data folder.
# Usage: xray.sh <data-dir> <xray arguments...>
#        xray.sh <data-dir> quality <xray-quality arguments...>   (whole repository; -f graph for imports)
# Clones and builds on first use, then follows XRAY_REF (default v0, the latest release) of XRAY_REPO
# (default the GitHub repository), rebuilding only when it moves.
# Without network it keeps using the last build. Build output goes to stderr; xray's output to stdout.
set -euo pipefail

major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)"
if [ -z "$major" ] || [ "$major" -lt 22 ]; then
  echo "xray: needs Node.js 22 or later on PATH (found: ${major:-none}). Install it, or activate it for this project, and run again." >&2
  exit 1
fi

data_dir="${1:?usage: xray.sh <data-dir> <xray arguments...>}"
shift
ref="${XRAY_REF:-v0}"
repo="${XRAY_REPO:-https://github.com/pearpages/xray.git}"
checkout="$data_dir/xray"

if [ ! -d "$checkout/.git" ]; then
  mkdir -p "$data_dir"
  git clone --quiet --depth 1 --branch "$ref" "$repo" "$checkout" >&2
elif git -C "$checkout" fetch --quiet --depth 1 --force origin "$ref" 2>/dev/null; then
  git -C "$checkout" reset --quiet --hard FETCH_HEAD
else
  echo "xray: could not reach GitHub, using the last downloaded version." >&2
fi

head="$(git -C "$checkout" rev-parse HEAD)"
if [ "$(cat "$checkout/.xray-built" 2>/dev/null)" != "$head" ]; then
  (cd "$checkout" && npm ci --silent --no-audit --no-fund && npm run --silent build) >&2
  echo "$head" > "$checkout/.xray-built"
fi

if [ "${1:-}" = "quality" ]; then
  shift
  exec node "$checkout/packages/quality/dist/cli.js" "$@"
fi
exec node "$checkout/packages/cli/dist/index.js" "$@"
