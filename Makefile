# Captive portal — regression entry point.
#
#   make regression    unit + production build + the browser lane
#
# The same three lanes run from CI where CI exists (see REGRESSION.md: for this
# repo that means a human or an agent running them, not GitHub Actions). Keep
# this file thin: scripts/regression.sh owns the behaviour, and the module
# repository's `make regression` is its counterpart.

.PHONY: regression regression-unit regression-build regression-e2e regression-visual install-dev

# One command, one exit status, machine-readable output:
#   LANE <unit|build|e2e> <PASS|FAIL|SKIP> <detail>
regression:
	@bash scripts/regression.sh

# The targeted unit directory only — the whole `vitest run` OOMs on
# src/components/__tests__/Cashu.race.test.jsx (see scripts/regression.sh).
regression-unit:
	@npx vitest run tests/unit

regression-build:
	@node scripts/build-all.mjs

# Runs on its own port so a dev server from another checkout cannot be reused.
# PORTAL_TEST_PORT is passed to the dev server by playwright.config.js.
regression-e2e:
	@PORTAL_TEST_PORT="$${PORTAL_TEST_PORT:-$$((5300 + $$$$ % 200))}" \
		npx playwright test tests/e2e/functional.spec.mjs tests/e2e/session-expiry.spec.mjs \
		tests/e2e/usage-display.spec.mjs tests/e2e/prehydrate.spec.mjs --project=desktop

# Informational: a screenshot diff needs a human to judge it.
regression-visual:
	@PORTAL_TEST_PORT="$${PORTAL_TEST_PORT:-$$((5300 + $$$$ % 200))}" \
		npx playwright test tests/e2e/visual.spec.mjs --project=desktop || true

# Fresh clone: the lane needs node_modules, and playwright needs its browser.
install-dev:
	@npm ci
	@npx playwright install --with-deps chromium
