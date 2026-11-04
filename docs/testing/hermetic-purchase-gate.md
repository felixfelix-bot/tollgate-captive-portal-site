# The hermetic purchase-path gate

`tests/e2e/hermetic-purchase.spec.mjs` is the first test in this repo that
exercises the **client-side purchase path** against the origin shape a real
captive portal has, rather than against `localhost` or a route-intercepted mock.
It is the assertion set that later portal work inherits verbatim: re-pointing it
at a serial router's portal (`:2051`) or at the emulator changes only the base
URL.

Run it with:

```sh
npm run build                                  # it tests build/, not src/
npx playwright test tests/e2e/hermetic-purchase.spec.mjs --project=mobile
```

CI runs exactly that command as a mandatory step (`ci.yml`, "Run hermetic
purchase-path gate"). It is a `mobile` (Pixel 7) project only — the buyer is on
a phone, and the desktop project already covers rendering.

## The rig

Three real servers on this host, no router, no emulator, no network:

| leg    | origin                            | why that port                                |
| ------ | --------------------------------- | -------------------------------------------- |
| portal | `http://<lan-ip>:<ephemeral>`     | a bare RFC1918 address is NOT a secure context |
| API    | `http://<page-host>:2121`         | `src/helpers/tollgate.js` derives it from `window.location.hostname` |
| mint   | `http://127.0.0.1:<ephemeral>`    | CORS-open `GET /v1/keysets`, as a real mint is |

`localhost` and `127.0.0.1` are *Potentially Trustworthy* per W3C Secure
Contexts §3.1 steps 4–5, so a suite that only visits them never observes the
constraint that actually bites on a captive portal (§3.1 step 9). Every
secure-context assertion therefore runs as a matched pair whose only variable is
the hostname.

`page.route()` is deliberately NOT used: it bypasses CORS, CSP and the
document's own origin — the three things that actually break a portal — and
would let the suite pass against a portal that cannot reach its own router.

## The trap it pins

On a non-secure origin `navigator.serviceWorker` does not exist at all: the IDL
property is `[SecureContext]`-gated, so it is `undefined`, **not** a rejected
promise and **not** a catchable `SecurityError`:

```js
navigator.serviceWorker.register('/sw.js')
// TypeError: Cannot read properties of undefined (reading 'register')
```

So `try { register() } catch (SecurityError)` crashes instead of degrading. The
negative control asserts the `TypeError` *by name*, because a future browser
that turned it into a `SecurityError` would silently invalidate the guard in
`src/helpers/pwa-install.js` and this test must say so.

## Findings recorded here rather than asserted away

Neither is a purchase-path defect, and neither belongs in this PR's diff:

- the link is `manifest.json`, not `manifest.webmanifest` — the spec mandates
  neither filename, only the `rel`;
- `favicon.ico` declares `sizes: "72x72"` while the ICO actually carries 16x16
  and 24x24 frames. Chrome ignores `.ico` for installability, so this is
  cosmetic — but it is a false claim in a shipped manifest.

The PNG icons **are** asserted against their real pixel dimensions, because
those are what installability is decided on.

## Measured facts worth not re-deriving

- Playwright's **bundled** Chromium ignores
  `--unsafely-treat-insecure-origin-as-secure` (`isSecureContext` stays false),
  so the allowlist arm (3c) runs on `channel: 'chrome'` and skips loudly when
  that binary is absent. It must never quietly pass on the bundled browser.
- `navigator.serviceWorker.ready` resolves while the worker is still
  `activating`, so it is not evidence of `activated`. The spec polls the state
  itself (a page function returning a Promise is truthy at
  `waitForFunction`'s polling layer, so an `async` predicate there waits for
  nothing).
- `qrcode-svg` emits one `<rect>` per module (its `join` option, which would
  emit a single `<path>`, is off by default), so a module count is
  `rect` − 1, never `path`.

## What it does not cover

- The portal's CSP is `connect-src 'self' http: https: ws: wss:` in the built
  document on this branch (it was `'self' http: ws:` before this branch's
  install/CSP fix). An **https** mint is therefore permitted now, but nothing
  here exercises one: the rig serves the mint over http, and proving an https
  mint end to end needs TLS a captive portal cannot offer before the user has
  paid. What CSP coverage *is* asserted is the negative direction — this suite
  fails if a connect is blocked, because a CSP violation is the silent failure
  mode that makes a working purchase path look broken.
- The router itself. Nothing here touches hardware; the same spec re-points at
  `:2051` when a router rail is available.
