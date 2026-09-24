# REGRESSION.md — what actually runs for the captive portal

The guest SPA is the surface a customer touches: it is the page a phone lands on
after the captive redirect, and it is the bundle the module vendors into the
package it ships. This file is the honest inventory of what is **executed**
against it, where, and by what.

The module repository has the counterpart of this file
(`tollgate-module-basic-go/REGRESSION.md`) and the single statement of the
release gate (`tollgate-module-basic-go/RELEASE-GATE.md`). The portal has no
gate of its own to state: it is the module's gate that consumes this bundle.

## The one command

```bash
make regression        # unit + production build + packaging/branding + browser lane
```

That is the whole portal regression surface, in one command with one exit
status, and it is machine-readable:

```
LANE unit PASS Tests 107 passed (see /var/tmp/tg-portal-regression.3960658/unit.log)
LANE build PASS production bundle built from this commit
LANE packaging PASS no foreign skins, no company-branding references
LANE e2e PASS 11 passed (2.1m) (port 5358) (see /var/tmp/tg-portal-regression.3960658/e2e.log)
LANEINFO visual: 2 passed — a screenshot diff needs a human to judge it
LANES total=4 pass=4 fail=0 skip=0
LANEEVIDENCE /var/tmp/tg-portal-regression.3960658
```

Those numbers are the captured run on this branch (2026-09-24, exit 0); the work
dir and the e2e port are per-run and will differ.

Individual lanes: `make regression-unit`, `make regression-build`,
`make regression-e2e`, `make regression-visual`. `scripts/regression.sh` is the
implementation; `make` is a thin wrapper over it.

## Lane inventory

| Lane | What it runs | Covers |
| --- | --- | --- |
| `unit` | `npx vitest run tests/unit` | the portal's real logic: cashu decode/`validateToken`/`canSubmitAnyway` gating, `submitToken`, mint fee pre-check, i18n keys (including the Lightning-lane strings), branding/themebundle |
| `build` | `node scripts/build-all.mjs` | the production bundle — guest SPA plus admin SPA. A build that only works under the dev server fails at release |
| `packaging` | `sh tests/packaging/foreign-skins-guard.sh .` + the branding-leak grep from `.github/workflows/ci.yml` | the bundle the module vendors carries no foreign skin and no company-branding reference |
| `e2e` | `npx playwright test tests/e2e/{functional,session-expiry,usage-display,prehydrate}.spec.mjs --project=desktop` | the whole portal in a real Chromium, backend stubbed at the network layer (`tests/e2e/helpers/mock-backend.mjs`): token input and the Cashu/Lightning tabs, the "access purchased" card, the expired view, the in-page renewal CTA, usage rendering, and `?token=` prehydration |
| `visual` (informational) | `npx playwright test tests/e2e/visual.spec.mjs` | screenshots, never fatal — a pixel diff needs a human to say whether it is wrong |
| `admin` (not wired) | `npm run test:admin` | the admin board SPA has its own Playwright config (`admin/playwright.config.mjs`). It is a real suite that nothing runs; wiring it is follow-up work, deliberately not claimed here |

Two things about the lane that are not cosmetic:

* **`unit` is the targeted directory, not `vitest run`.** The component suite
  `src/components/__tests__/Cashu.race.test.jsx` hangs against the i18next mock
  in `src/test/setup.js` and takes the whole process with it (OOM), so a full
  `vitest run` proves nothing about the commit under test.
* **`e2e` picks its own port.** `playwright.config.js` now passes the port to the
  dev server (`npm run dev -- --port $PORTAL_TEST_PORT`). Before that, the suite
  always asserted against 5173 while the server it started also bound 5173, so
  with `reuseExistingServer` on, a dev server from *another* checkout was reused —
  a run then tested someone else's tree and failed with an export error that had
  nothing to do with the commit (measured on this fleet, where several checkouts
  run in parallel). The lane defaults to a per-process port for the same reason.

## Where it runs — and the honest answer is "nowhere automatically"

| Engine | State | Evidence |
| --- | --- | --- |
| GitHub Actions (`.github/workflows/ci.yml`: unit, e2e, packaging guard) | **dead** — the last run of this repo's `CI` workflow is 2026-07-28; the org's other repositories have workflow runs sitting `queued` for 17+ hours | `gh run list -R OpenTollGate/tollgate-captive-portal-site`; `gh run list -R OpenTollGate/tollgate-module-basic-go` |
| ngit CI (Nostr) | **does not apply to this repo** — there is no `.ngit/` here; ngit CI runs the *module's* workflows | `ls .ngit`; `.ngit/README.md` in `tollgate-module-basic-go` |
| the module's regression lane | runs the **shipped** bundle in a real browser, from the module side: `tollgate-module-basic-go` → `make regression-module` (`tests/happy-path/`) | `tollgate-module-basic-go/REGRESSION.md` |

So `make regression` runs where a human or an agent runs it — on the release
path, before a portal change is merged, and before the module re-pins and
re-vendors this bundle. That is a real lane with a real exit status, but it is
**not** a merge gate today, and nothing here should be described as
"CI-verified".

### State of the browser lane (2026-09-24)

The `e2e` lane could not run at all before this change, and the reason is worth
recording because it is invisible from the suite's output: the shared helper stub
`tests/e2e/helpers/mock-backend.mjs` replaces `src/helpers/cashu.js` at the
network layer, and it exported only part of that module's surface
(`validateToken`, `submitToken`, `extractProofsFromToken`). `Cashu.jsx` imports
five names from it, so the ES module link failed, the app never hydrated, and
every behavioural assertion died on a selector timeout. Measured on the tree at
`e6fe0e0`, with the stub as it stood:

```
[pageerror] SyntaxError: The requested module '/src/helpers/cashu.js'
            does not provide an export named 'findMintOption'
[dom] {"tabs":0,"root":0,"bodyText":""}          # nothing hydrated
npx playwright test tests/e2e/functional.spec.mjs --project=desktop
  -> 4 failed, 2 passed (exit 1)
```

This branch makes the stub export the full surface the module under test imports
(`canSubmitAnyway`, `normalizeMintUrl`, `findMintOption` copied verbatim from the
real helper; `mintUrlFromToken` deliberately answers `null` and says so, because
the stub exists to keep the cashu-ts decoders out of this lane). Same tree, same
command:

```
npx playwright test tests/e2e/functional.spec.mjs --project=desktop
  -> 6 passed (exit 0)
npx playwright test tests/e2e/{session-expiry,usage-display,prehydrate}.spec.mjs
  -> 5 passed (exit 0)
```

The **unit** lane was red on `main` for the same class of reason: the
`vi.mock('../../src/helpers/cashu.js')` factory in
`tests/unit/renew-after-expiry.test.jsx` also lagged the module's surface, so its
five assertions died with `No "mintUrlFromToken" export is defined on the
"../../src/helpers/cashu.js" mock` (`Test Files 1 failed | 11 passed`,
`Tests 5 failed | 102 passed`). Adding the two missing names to that mock — the
same unfaithful-mock defect, in a second place — makes the lane green:
`Test Files 12 passed (12)`, `Tests 107 passed (107)`.

What this does **not** finish — the remaining half of `REGRESSION-A` (portal
board, under way separately):

* the e2e stub still replaces the module under test instead of stubbing only the
  mint network, so the real decoder path is not exercised here;
* no spec yet *pins* the purchase path (mint list rendered from the module's
  advertisement, a valid v4 `cashuB` note accepted, the purchase affordance
  present) — the assertions exist but not as a named contract.

Until that lands, the lane proves the app hydrates and behaves; it does not yet
prove the purchase path specifically.

## What NOTHING automates

| Not automated | Why | Who owns it |
| --- | --- | --- |
| the portal as served by a real router, with a real captive redirect | needs a device (nodogsplash, uhttpd, the `:2051` stub / `:2050` redirect chain) | operator's hardware pass; `physical-router-test-automation` |
| a real mint and real ecash | the e2e lane stubs the backend and never settles a payment; the module's lane uses an offline stub mint | operator (hardware pass) |
| whether the rendered UI is *right* | the `visual` lane captures screenshots but a human judges them | human reviewer |
| the admin board SPA | its suite exists (`npm run test:admin`) and is not wired to anything | follow-up |
| the release/feed | publishing a shared feed is an operator action; the portal is consumed through the module's pin | operator, per `tollgate-module-basic-go/RELEASE-GATE.md` |
