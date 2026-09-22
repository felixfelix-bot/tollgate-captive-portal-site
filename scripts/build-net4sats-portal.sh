#!/usr/bin/env bash
#
# Build the net4sats-branded TollGate admin UI FROM THE UPSTREAM THEME LAYER.
#
# net4sats is a distribution of the GPL TollGate portal, not a fork of it: this
# repo contributes a brand descriptor + logo assets + env, never a code diff.
# The upstream repo owns the rendering logic; the brand slot owns the identity.
#
#   upstream @ ${UPSTREAM_REF}  +  overlay/brand/<id>.json  +  overlay/assets/*
#        -> build/admin/{manifest.json,index.html,assets/brand/<id>/*}
#
# Usage:  scripts/build-net4sats-portal.sh [output-dir]
# Env:    UPSTREAM_REPO, UPSTREAM_REF, BRAND_ID, WORK_DIR
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

UPSTREAM_REPO="${UPSTREAM_REPO:-https://github.com/OpenTollGate/tollgate-captive-portal-site.git}"
# Pinned, immutable ref: the upstream commit that first ships the brand slot.
# Bump this (and only this) when a new upstream release with the slot is tagged.
UPSTREAM_REF="${UPSTREAM_REF:-d5e022d2217bcc4802805a62ef0c18d4e0cb082c}"
BRAND_ID="${BRAND_ID:-net4sats}"
OUT_DIR="${1:-$REPO_ROOT/dist-$BRAND_ID}"
WORK_DIR="${WORK_DIR:-$(mktemp -d -t branded-portal-XXXXXX)}"

echo "[overlay] upstream=$UPSTREAM_REPO"
echo "[overlay] ref=$UPSTREAM_REF brand=$BRAND_ID"
echo "[overlay] work=$WORK_DIR out=$OUT_DIR"

# fail before cloning/installing if the overlay cannot satisfy the upstream contract
node "$REPO_ROOT/scripts/check-overlay-descriptor.mjs"
if [ ! -f "$REPO_ROOT/overlay/brand/$BRAND_ID.json" ]; then
  echo "[overlay] FATAL: no descriptor at overlay/brand/$BRAND_ID.json" >&2
  exit 1
fi

# 1. fetch the pinned upstream tree (no history needed, no branch guessing)
git init -q "$WORK_DIR/upstream"
# Idempotent: a reused WORK_DIR already has an origin, and `remote add` would fail.
git -C "$WORK_DIR/upstream" remote remove origin 2>/dev/null || true
git -C "$WORK_DIR/upstream" remote add origin "$UPSTREAM_REPO"
git -C "$WORK_DIR/upstream" fetch -q --depth 1 origin "$UPSTREAM_REF"
git -C "$WORK_DIR/upstream" checkout -q FETCH_HEAD

SRC="$WORK_DIR/upstream"

# 2. overlay the brand slot — descriptor + logo/icon assets, nothing else
mkdir -p "$SRC/admin/brand" "$SRC/admin/public/assets/brand/$BRAND_ID"
cp "$REPO_ROOT/overlay/brand/$BRAND_ID.json" "$SRC/admin/brand/$BRAND_ID.json"
cp "$REPO_ROOT"/overlay/assets/*.png "$SRC/admin/public/assets/brand/$BRAND_ID/"

# 3. build with the brand selected
cd "$SRC"
npm ci --no-audit --no-fund
VITE_BRAND="$BRAND_ID" npm run build

# 4. publish + verify
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
cp -r "$SRC/build/." "$OUT_DIR/"

node "$REPO_ROOT/scripts/verify-branded-build.mjs" "$OUT_DIR"

echo "[overlay] done: $OUT_DIR"
