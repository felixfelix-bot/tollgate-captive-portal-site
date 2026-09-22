# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added
- **Brand overlay:** `overlay/` brand descriptor + logo/icon slot and
  `scripts/build-net4sats-portal.sh`, which builds the branded admin UI from the
  upstream theme layer (`VITE_BRAND=net4sats`) instead of a forked code tree.
  `scripts/verify-branded-build.mjs` mechanically proves the artifact is branded
  (manifest, icon slot, index shell, compiled descriptor);
  `tests/unit/overlay-descriptor.test.js` enforces the upstream descriptor
  contract. See `docs/BRAND-OVERLAY.md`.

### Fixed
- **Clipboard (GPL-port #19):** add `hasClipboardSupport()` feature detection so the
  UI can hide the paste button on plain-HTTP captive portals where
  `navigator.clipboard.readText()` is unavailable (non-secure context). This is a
  reverse-sync of the upstream OpenTollGate fix into the net4sats fork.
- **Bare-"0" render (GPL-port #10):** `AccessOptions` used `pricingInfo.length &&
  pricingInfo.map(...)`, which React evaluates to the literal text `0` when the
  access-option list is empty. Changed to `pricingInfo.length > 0 && ...` so an
  empty list renders nothing. Reverse-sync of the upstream fix.

### Added
- **Test infrastructure:** vitest + jsdom wired up (`npm test` / `vitest.config.js`),
  matching the upstream OpenTollGate portal conventions, with unit tests covering
  the two ported fixes.
