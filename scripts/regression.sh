#!/usr/bin/env bash
#
# Regression lane for the captive portal — ONE entry point for humans, agents
# and CI, deliberately shaped like the module repo's
# scripts/regression-lane.sh so the same mental model works in both repos.
#
#   make regression                 # unit + production build + browser lane
#   bash scripts/regression.sh      # the same thing
#   PORTAL_TEST_PORT=5173 bash scripts/regression.sh
#
# WHAT IT RUNS
#
#   unit   npx vitest run tests/unit
#          The targeted unit directory, NOT the whole `vitest run`: the component
#          suite `src/components/__tests__/Cashu.race.test.jsx` re-runs Cashu's
#          effects for ever against the i18next mock in src/test/setup.js and OOMs
#          the process before the rest of the suite finishes. Running the whole
#          thing therefore proves nothing about the commit under test; running
#          tests/unit covers the portal's real logic (cashu decode/submit gates,
#          i18n keys, branding, mint fee). The leaking component test is tracked
#          separately.
#
#   build  node scripts/build-all.mjs
#           The production bundle the module vendors into the package. A build
#          that only passes under the dev server is a build that fails at release.
#
#   e2e    npx playwright test <behavioural specs> --project=desktop
#           The whole portal in a real browser, backend stubbed at the network
#           layer (tests/e2e/helpers/mock-backend.mjs). This is the lane that
#           catches a module-load regression: an import of a name the helper stub
#           does not export kills hydration and every behavioural assertion times
#           out at once.
#
#   The visual spec is NOT part of the lane: it is informational in CI too
#   (`.github/workflows/ci.yml` runs it with `|| true`), because a screenshot
#   diff needs a human to say whether it is wrong. It is printed as INFO.
#
# PORT. The lane picks its own port (PORTAL_TEST_PORT, or a per-process default)
# and playwright.config.js passes it to the dev server. That matters on this
# fleet: several checkouts run their own dev server, `reuseExistingServer` is on,
# and a lane that silently attached to another checkout's server reported failures
# that had nothing to do with the tree under test (measured 2026-09-24).
#
# OUTPUT: one machine-readable line per lane, then a summary.
#   LANE <unit|build|e2e> <PASS|FAIL|SKIP> <detail>
#   LANES total=N pass=N fail=N skip=N
# Exit status: non-zero when a lane that ran failed.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${PORTAL_TEST_PORT:-$((5300 + ($$ % 200)))}"
OUT="${OUT:-/var/tmp/tg-portal-regression.$$}"
mkdir -p "$OUT" || exit 1

BEHAVIOURAL_SPECS=(
    tests/e2e/functional.spec.mjs
    tests/e2e/session-expiry.spec.mjs
    tests/e2e/usage-display.spec.mjs
    tests/e2e/prehydrate.spec.mjs
)

TOTAL=0; PASSED=0; FAILED_N=0; SKIPPED=0
FAILED_LANES=""

lane() {  # lane <name> <PASS|FAIL|SKIP> <detail>
    local name="$1" status="$2"; shift 2
    TOTAL=$((TOTAL + 1))
    case "$status" in
        PASS) PASSED=$((PASSED + 1)) ;;
        SKIP) SKIPPED=$((SKIPPED + 1)) ;;
        FAIL) FAILED_N=$((FAILED_N + 1)); FAILED_LANES="$FAILED_LANES $name" ;;
    esac
    printf 'LANE %s %s %s\n' "$name" "$status" "${*:-}"
}

echo "PORTAL REGRESSION port=$PORT out=$OUT"

if [ ! -d node_modules ]; then
    lane unit  SKIP "node_modules missing — run npm ci first"
    lane build SKIP "node_modules missing"
    lane e2e   SKIP "node_modules missing"
    printf '\nLANES total=%d pass=%d fail=%d skip=%d\n' "$TOTAL" "$PASSED" "$FAILED_N" "$SKIPPED"
    exit 0
fi

# --- unit ------------------------------------------------------------------
echo "=== lane unit: npx vitest run tests/unit ==="
if npx vitest run tests/unit > "$OUT/unit.log" 2>&1; then
    lane unit PASS "$(grep -E 'Tests +[0-9]+' "$OUT/unit.log" | tail -1 | sed 's/^ *//') (see $OUT/unit.log)"
else
    tail -25 "$OUT/unit.log" >&2
    lane unit FAIL "vitest exited non-zero (see $OUT/unit.log)"
fi

# --- build -----------------------------------------------------------------
echo "=== lane build: node scripts/build-all.mjs ==="
if node scripts/build-all.mjs > "$OUT/build.log" 2>&1; then
    lane build PASS "production bundle built from this commit"
else
    tail -20 "$OUT/build.log" >&2
    lane build FAIL "build failed (see $OUT/build.log)"
fi

# --- packaging / branding gates (the cheap half of the old CI job) ----------
# These are the checks `.github/workflows/ci.yml` ran before GitHub Actions went
# queued-dead for this org. They are cheap, they protect the bundle the module
# vendors, and they must not silently disappear with the CI that used to run them.
echo "=== lane packaging: foreign-skins guard + branding leak check ==="
PACK_FAIL=""
if ! sh tests/packaging/foreign-skins-guard.sh . > "$OUT/packaging-guard.log" 2>&1; then
    tail -10 "$OUT/packaging-guard.log" >&2
    PACK_FAIL="foreign-skins guard failed"
fi
# Same pattern as ci.yml, with the character-class split so this file's own grep
# string does not match the check itself. Generated output (test-results, build,
# node_modules) is excluded: ci.yml ran this on a fresh checkout, and a screenshot
# or a bundled asset is not a branding reference in the source.
if grep -rIni 'net4[s]ats\|felix[f]elix' . \
        --exclude-dir=.git --exclude-dir=node_modules \
        --exclude-dir=test-results --exclude-dir=build \
        > "$OUT/branding-leak.log" 2>&1; then
    cat "$OUT/branding-leak.log" >&2
    PACK_FAIL="${PACK_FAIL:+$PACK_FAIL; }branding reference found"
fi
if [ -z "$PACK_FAIL" ]; then
    lane packaging PASS "no foreign skins, no company-branding references"
else
    lane packaging FAIL "$PACK_FAIL"
fi

# --- e2e -------------------------------------------------------------------
echo "=== lane e2e: playwright ${BEHAVIOURAL_SPECS[*]} --project=desktop (port $PORT) ==="
if PORTAL_TEST_PORT="$PORT" npx playwright test "${BEHAVIOURAL_SPECS[@]}" \
        --project=desktop --reporter=line > "$OUT/e2e.log" 2>&1; then
    lane e2e PASS "$(grep -E '^ +[0-9]+ passed' "$OUT/e2e.log" | tail -1 | sed 's/^ *//') (port $PORT)"
else
    tail -30 "$OUT/e2e.log" >&2
    lane e2e FAIL "playwright exited non-zero (see $OUT/e2e.log)"
fi

# --- visual (informational, never fatal) -----------------------------------
if [ -f tests/e2e/visual.spec.mjs ]; then
    echo "=== informational: visual snapshots (never fatal) ==="
    PORTAL_TEST_PORT="$PORT" npx playwright test tests/e2e/visual.spec.mjs \
        --project=desktop --reporter=line > "$OUT/e2e-visual.log" 2>&1 || true
    echo "LANEINFO visual: $(grep -E '^ +[0-9]+ (passed|failed)|Error' "$OUT/e2e-visual.log" | tail -1 | sed 's/^ *//') — a screenshot diff needs a human to judge it"
fi

printf '\nLANES total=%d pass=%d fail=%d skip=%d%s\n' \
    "$TOTAL" "$PASSED" "$FAILED_N" "$SKIPPED" \
    "$( [ -n "$FAILED_LANES" ] && printf ' failed:%s' "$FAILED_LANES" )"
echo "LANEEVIDENCE $OUT"
[ "$FAILED_N" = "0" ] || exit 1
exit 0
