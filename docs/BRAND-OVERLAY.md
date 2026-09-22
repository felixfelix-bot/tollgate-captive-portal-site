# net4sats as a brand overlay over the upstream TollGate portal

**Rule of record:** TollGate is a *protocol*; net4sats is a *company*. net4sats
depends on TollGate — never the reverse. This repo therefore owns **identity**,
not code: a brand descriptor, logo assets, and build env. The rendering logic
lives in the GPL upstream repo.

```
OpenTollGate/tollgate-captive-portal-site   (GPL-3.0)  ← theme layer + brand slot
        ▲
        │  admin/brand/<id>.json  +  admin/public/assets/brand/<id>/*
        │  VITE_BRAND=<id>
net4sats/captive-portal-site               (this repo) ← descriptor + assets + env
```

The upstream brand slot is documented in the upstream `admin/brand/README.md`:
a build ships exactly one skin, selected by `VITE_BRAND`, and the logo/icon paths
are a convention derived from the id (`logo-colour.png`, `logo-white.png`,
`icon-colour.png`, `icon-white.png`). No forking, no code diff, no vendor names
in the upstream tree.

## What this repo contributes

| Path | Purpose |
| --- | --- |
| `overlay/brand/net4sats.json` | The `BrandDescriptor`: name, domain, tagline, poweredBy, website, version, themeColor, session storage keys. |
| `overlay/assets/*.png` | The four files the upstream slot expects, renamed to the slot convention. |
| `scripts/build-net4sats-portal.sh` | Fetches the pinned upstream ref, drops the overlay into the slot, builds `VITE_BRAND=net4sats`, publishes `dist-net4sats/`. |
| `scripts/verify-branded-build.mjs` | Mechanical proof the artifact is branded: manifest, icon slot, index shell, compiled descriptor. |
| `scripts/overlay-contract.mjs` | The upstream slot contract, in one place: required fields, id alphabet, colour/URL shape, slot file names, PNG magic. |
| `tests/unit/overlay-descriptor.test.js` | Contract test for the descriptor + asset slot (runs with `npm test`). |

## Build

```bash
scripts/build-net4sats-portal.sh            # -> dist-net4sats/
npm test                                    # descriptor contract
node scripts/verify-branded-build.mjs dist-net4sats
```

The script pins upstream by **full commit SHA** (`UPSTREAM_REF`), never a moving
branch: a branded build must be reproducible and must not silently pick up
unreleased upstream work. Bump the pin deliberately when a new upstream release
carries the brand slot.

```bash
UPSTREAM_REF=<sha> scripts/build-net4sats-portal.sh
```

## Verification the build is real

`verify-branded-build.mjs` exits non-zero unless all of these hold:

1. `dist-net4sats/admin/manifest.json` carries the descriptor's `name`,
   `short_name`, `theme_color` and icon paths inside `assets/brand/net4sats/`.
2. All four slot files were copied into `dist-net4sats/admin/assets/brand/net4sats/`.
3. `dist-net4sats/admin/index.html` references `assets/brand/net4sats/icon-colour.png`
   and references **no other** brand directory.
4. The descriptor was compiled into the bundle (its `sessionKey`/`sessionUser`
   strings are present in `dist-net4sats/admin/assets/*.js`).

## Current status / migration

The upstream brand slot is not merged yet (upstream PR: `OpenTollGate/tollgate-captive-portal-site#54`),
so `UPSTREAM_REF` currently pins that PR's head commit. Until it merges, the
legacy hard-coded portal tree stays in this repo and keeps deploying — the
overlay is additive and breaks nothing.

Migration, after #54 merges:

1. Bump `UPSTREAM_REF` to the merge commit on upstream `main`.
2. Switch the fork's deploy job to run `scripts/build-net4sats-portal.sh` and
   publish `dist-net4sats/` — this is the point at which the hard-coded tree stops
   being built.
3. Delete the legacy hard-coded tree (`src/`, `public/`, `index.html`, the
   `net4sats-*` logo files) in a follow-up commit, leaving this repo as a thin
   distribution: descriptor + assets + env + CI + docs.
4. Keep the portal (splash/balance) and the admin board on the same mechanism so
   there is exactly **one** theming scheme, not two.

## GPL note

Env/assets/config only. Shipping proprietary *code* diffs inside a branded build
would trigger GPL source disclosure; all rendering logic stays generic upstream
and in the overlay build recipe.

## Pin and the defect it caught

`UPSTREAM_REF` currently points at the head of upstream PR #54. That commit is
required, not cosmetic: before it, `admin/src/brand.ts` loaded the slot with a
relative `import.meta.glob('../../brand/*.json')`, which resolves against the
importing module and therefore matched nothing. The descriptor never reached the
bundle, `resolveBrand` threw at admin startup, and a distribution build shipped a
branded manifest and favicon with an admin UI that could not start.

The overlay build is what surfaced it: with the older pin,
`scripts/verify-branded-build.mjs` failed on exactly one check -- *descriptor
compiled into the admin bundle* -- while every manifest and asset check passed.
With the fix in place the same build passes all checks. Bump the pin to a `main`
SHA once #54 is merged.
