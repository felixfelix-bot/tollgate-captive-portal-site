// GATE (card t_ed88f1d4, WWEB) — the client-side PURCHASE PATH, end to end, on a
// captive-portal-shaped origin. No router, no emulator, no network.
//
// ── What this file is FOR ───────────────────────────────────────────────────
//
// `tests/e2e/helpers/mock-backend.mjs` drives the UI with Playwright route
// interception and a stubbed `src/helpers/cashu.js`. That answers "does the
// component render the right thing", and it CANNOT answer the question this
// project turns on: does the purchase path survive a real plain-HTTP captive
// portal, cross-origin to a real router API on :2121, under the real CSP, with
// a real Cashu token pasted in? Route interception bypasses CORS, CSP and the
// document's own origin — the three things that actually break.
//
// So this spec talks to real sockets, on the origin shape a router really
// serves:
//
//   portal   http://<lan-ip>:<ephemeral>     (not secure — a bare RFC1918 IP)
//   API      http://<lan-ip>:2121            (the port the app derives itself)
//   mint     http://127.0.0.1:<ephemeral>    (CORS-open /v1/keysets, as real)
//
// The assertions below are the set W1/W2 inherit verbatim: pointing them at the
// serial router's portal (:2051) or the emulator changes ONLY the base URL.
//
// ── Why BOTH origins are measured ───────────────────────────────────────────
//
// `localhost`/`127.0.0.1` is Potentially Trustworthy (W3C Secure Contexts §3.1
// steps 4-5); `http://192.168.x.y` is not (§3.1 step 9). A suite that only
// visits localhost measures the one address the constraint does not apply to.
// Every secure-context assertion here therefore runs as a MATCHED PAIR whose
// only variable is the hostname.
//
// ── The trap this card exists to pin ────────────────────────────────────────
//
// On a non-secure origin `navigator.serviceWorker` is NOT a rejected promise
// and NOT a catchable `SecurityError` — the IDL property is [SecureContext]-
// gated, so it does not exist:
//
//     navigator.serviceWorker.register('/sw.js')
//     // TypeError: Cannot read properties of undefined (reading 'register')
//
// So `try { register() } catch (SecurityError)` CRASHES instead of degrading.
// The negative control asserts the TypeError explicitly (not merely "it threw"),
// because a future browser that turned it into a SecurityError would silently
// invalidate the guard in `src/helpers/pwa-install.js` and this test must say so.
//
// ── Findings recorded here rather than asserted away ────────────────────────
//
// Two shipped facts are measured and REPORTED, not turned into red assertions,
// because neither is a defect in the purchase path and neither belongs to a
// test PR's diff:
//
//   * the link is `manifest.json`, not `manifest.webmanifest` — both are valid;
//     the Web App Manifest spec mandates neither filename, only the link rel.
//   * `favicon.ico` declares `sizes: "72x72"` while the ICO actually carries
//     16x16 and 24x24 frames. Chrome ignores .ico for installability, so this
//     is cosmetic — but it is a false claim in a shipped manifest.
//
// The PNG icons ARE asserted against their real pixel dimensions, because those
// are what installability is decided on.
import { test, expect, chromium, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { serveWebroot } from './helpers/portal-origin-host.mjs';
import {
  createPortalState,
  startStubTollGateApi,
  startStubMint,
  mintToken,
  recordRequests,
  recordConsole,
  findLanAddress,
  TOLLGATE_API_PORT,
} from './helpers/hermetic-harness.mjs';

// ── the tree under test ─────────────────────────────────────────────────────
//
// `build/`, not the source tree: what ships is the built document (splash.html,
// the stamped sw.js, the generated manifest), and a test of the source tree
// would prove the wrong artifact.
const PORTAL_DIR = resolve(process.env.PORTAL_DIR || process.cwd());
const WEBROOT = resolve(process.env.PORTAL_WEBROOT_DIR || join(PORTAL_DIR, 'build'));
const ENTRY = 'splash.html';
const HAVE_BUILD = existsSync(join(WEBROOT, ENTRY));

// The stub API port is NOT free: `src/helpers/tollgate.js` derives
// `http://<page-host>:2121` from `window.location.hostname`, so the API has to
// answer on the same hostname and exactly that port. The fixture reports a
// clear failure rather than silently testing a different address.
const API_HOST = '0.0.0.0';

const LAN_HOST = findLanAddress();
const KEYSET_ID = '00ad268c4d1f5827';

/** PNG pixel dimensions straight out of the IHDR chunk. */
function pngSize(buf) {
  if (buf.length < 24 || buf.toString('latin1', 1, 4) !== 'PNG') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Wait until the page has a registration whose ACTIVE worker is `activated`.
 *
 * Deliberately NOT `page.waitForFunction`: a page function that returns a
 * Promise is truthy at the polling layer, so an `async` predicate passes on the
 * first evaluation and waits for nothing. Polling from Node actually awaits the
 * promise, which is the whole assertion.
 */
async function waitForActivated(page, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await page.evaluate(`(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return {
          hasRegistration: !!reg,
          scope: reg ? reg.scope : null,
          activeState: reg && reg.active ? reg.active.state : null,
          controller: !!navigator.serviceWorker.controller,
        };
      })()`);
    } catch (err) {
      last = { error: String(err && err.message) };
    }
    if (last && last.activeState === 'activated') return last;
    await page.waitForTimeout(100);
  }
  return last || { activeState: null };
}

/**
 * Start the whole rig: a mint, the API on :2121, and the portal's shipped bytes
 * on `host`. Everything is closed in `close()`.
 */
async function startRig({ host, state: stateOverrides = {}, mintOptions = {} } = {}) {
  const mint = await startStubMint({ keysetId: KEYSET_ID, ...mintOptions });
  const state = createPortalState({ mintUrl: mint.origin, ...stateOverrides });
  const api = await startStubTollGateApi({ host: API_HOST, state });
  const portal = await serveWebroot({ webroot: WEBROOT, host });

  return {
    portal,
    api,
    mint,
    state,
    /** A token the app's own pinned cashu-ts encoded, for this mint. */
    token: (opts = {}) => mintToken({ mintUrl: mint.origin, keysetId: KEYSET_ID, ...opts }),
    async close() {
      await portal.close();
      await api.close();
      await mint.close();
    },
  };
}

/** Page-side probe, kept as one string so every origin measures the same code. */
const PROBE = `(() => ({
  isSecureContext: window.isSecureContext,
  hasServiceWorkerAPI: 'serviceWorker' in navigator,
  serviceWorkerType: typeof navigator.serviceWorker,
  hasCryptoSubtle: !!(window.crypto && window.crypto.subtle),
  hasCaches: 'caches' in window,
  hasGetRandomValues: !!(window.crypto && typeof window.crypto.getRandomValues === 'function'),
  href: window.location.href,
}))()`;

test.describe('WWEB — hermetic captive-portal purchase path', () => {
  // The money path is asserted on the Pixel 7 project on purpose: the buyer is
  // on a phone, and the card's assertion set is the one W1/W2 inherit. The
  // desktop project already covers rendering (functional/visual specs).
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'money-path assertions belong on the mobile-chrome (Pixel 7) project');
    // A missing build must be a FAILURE in CI, never a green skip: a gate that
    // silently skips when the artifact is absent is worse than no gate.
    if (process.env.CI) {
      expect(HAVE_BUILD, `no ${ENTRY} in ${WEBROOT} — \`npm run build\` must run before this spec`).toBe(true);
      expect(LAN_HOST, 'CI needs a non-loopback IPv4 to reproduce a captive-portal origin').toBeTruthy();
    }
    test.skip(!HAVE_BUILD, `no ${ENTRY} in ${WEBROOT} — run \`npm run build\` first`);
    test.skip(!LAN_HOST, 'this host has no non-loopback IPv4, so the captive-portal origin cannot be reproduced');
  });

  // ── 1 ────────────────────────────────────────────────────────────────────
  test('1. the document loads over http:// with no mixed content and no page error', async ({ page }) => {
    const rig = await startRig({ host: LAN_HOST });
    try {
      const errors = recordConsole(page);
      const requests = recordRequests(page);
      // CSP violations are the silent failure mode: a blocked connect-src makes
      // an API response vanish without any exception reaching the app.
      await page.addInitScript(() => {
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (e) => {
          window.__cspViolations.push({ blockedURI: e.blockedURI, violatedDirective: e.violatedDirective });
        });
      });

      const res = await page.goto(`${rig.portal.origin}/${ENTRY}`, { waitUntil: 'load' });

      expect(res.status(), 'the captive portal must serve its document').toBe(200);
      expect(page.url(), 'we are on the router-shaped origin').toContain(LAN_HOST);
      expect(page.url().startsWith('http://'), 'plain http, like a real portal').toBe(true);

      // The app actually booted: header + footer are static, the price sheet is not.
      await page.waitForSelector('.tollgate-captive-portal-header', { timeout: 15000 });
      await expect(page.locator('.tollgate-captive-portal-footer')).toContainText(/TollGate/i);

      const violations = await page.evaluate('window.__cspViolations || []');
      console.log(`  CSP violations: ${JSON.stringify(violations)}`);
      expect(violations, 'the shipped CSP must not block anything this page needs').toEqual([]);

      // No upgrade to https: from an http document — the classic mixed-content
      // abort, and the reason a captive portal's page goes blank on a handset.
      const insecure = requests.all.filter((r) => r.scheme === 'data:' || r.scheme === 'blob:' ? false : r.scheme !== 'http:');
      console.log(`  non-http requests: ${JSON.stringify(insecure.map((r) => r.url))}`);
      expect(insecure, 'an http document must not request any other scheme').toEqual([]);

      // Hermetic: nothing outside the three stub origins was contacted.
      //
      // The API binds 0.0.0.0 so it can answer on whichever hostname the page
      // was served from, so its ORIGIN is not the address the browser dials —
      // the browser dials `<page-host>:2121`, because `src/helpers/tollgate.js`
      // derives the API base from `window.location.hostname`. Both spellings are
      // allowed; anything else is a leak.
      const pageHost = new URL(rig.portal.origin).hostname;
      const allowed = new Set([
        new URL(rig.portal.origin).host,
        new URL(rig.mint.origin).host,
        `${pageHost}:${TOLLGATE_API_PORT}`,
        new URL(rig.api.origin).host,
      ]);
      const foreign = requests.foreign(allowed);
      console.log(`  hosts contacted: ${JSON.stringify(requests.hosts())}`);
      expect(foreign, 'the run must not touch any host outside the rig').toEqual([]);

      // And nothing threw. A pageerror here is the failure mode this whole card
      // is about (a TypeError on the absent serviceWorker takes the SPA down).
      const fatal = errors.filter((e) => e.type === 'pageerror');
      console.log(`  page errors: ${JSON.stringify(fatal)}`);
      expect(fatal, 'the portal must not throw on this origin').toEqual([]);
      const mixed = errors.filter((e) => /mixed content/i.test(e.text));
      expect(mixed, 'no mixed-content abort').toEqual([]);
    } finally {
      await rig.close();
    }
  });

  // ── 2 ────────────────────────────────────────────────────────────────────
  test('2. the linked manifest is fetchable and valid, and its icons are the size they claim', async ({ page, request }) => {
    const rig = await startRig({ host: LAN_HOST });
    try {
      await page.goto(`${rig.portal.origin}/${ENTRY}`, { waitUntil: 'domcontentloaded' });

      // The DOCUMENT must link it — a manifest sitting in the webroot that no
      // page references is invisible to installability.
      const href = await page.getAttribute('link[rel="manifest"]', 'href');
      expect(href, 'the entry document must link a web app manifest').toBeTruthy();

      const manifestUrl = new URL(href, `${rig.portal.origin}/${ENTRY}`);
      expect(manifestUrl.origin, 'the manifest must be same-origin with the portal').toBe(rig.portal.origin);

      const res = await request.get(manifestUrl.href);
      expect(res.status(), `${manifestUrl.pathname} must be fetchable`).toBe(200);

      const manifest = await res.json();
      console.log(`  manifest: ${manifestUrl.pathname} -> ${JSON.stringify({
        name: manifest.name,
        short_name: manifest.short_name,
        start_url: manifest.start_url,
        display: manifest.display,
        icons: (manifest.icons || []).map((i) => `${i.src}:${i.sizes}`),
      })}`);

      // The four fields the card names, plus the two an installed app's identity
      // is keyed on. Without an explicit `id` a later start_url fix orphans
      // every existing install; without `scope` the app escapes its own shell.
      expect(manifest.name, 'name').toBeTruthy();
      expect(manifest.short_name, 'short_name').toBeTruthy();
      expect(manifest.start_url, 'start_url').toBeTruthy();
      expect(['standalone', 'fullscreen', 'minimal-ui'], 'display must be an app display mode').toContain(manifest.display);
      expect(manifest.id, 'an explicit id keeps existing installs alive').toBeTruthy();
      expect(manifest.scope, 'an explicit scope').toBeTruthy();

      // start_url must name a document the SERVED tree actually contains, and it
      // must answer over the wire — resolved relative to the manifest, per spec.
      const startUrl = new URL(manifest.start_url, manifestUrl);
      const startRes = await request.get(startUrl.href);
      console.log(`  start_url: ${JSON.stringify(manifest.start_url)} -> ${startUrl.pathname} (${startRes.status()})`);
      expect(startRes.status(), `start_url ${JSON.stringify(manifest.start_url)} must resolve to a served document`).toBe(200);

      // Installability needs 192 and 512 (any) plus a maskable one, and the
      // bytes must actually be that size — a mislabelled icon fails install
      // with no error a user can act on.
      const icons = manifest.icons || [];
      const sizes = icons.map((i) => i.sizes);
      expect(sizes, 'a 192x192 icon is required for installability').toContain('192x192');
      expect(sizes, 'a 512x512 icon is required for installability').toContain('512x512');
      expect(
        icons.some((i) => (i.purpose || 'any').split(/\s+/).includes('maskable')),
        'a maskable icon is required so Android does not letterbox it'
      ).toBe(true);

      for (const icon of icons) {
        const iconRes = await request.get(new URL(icon.src, manifestUrl).href);
        expect(iconRes.status(), `icon ${icon.src} must be fetchable`).toBe(200);
        const bytes = await iconRes.body();
        const actual = pngSize(bytes);
        if (!actual) {
          // .ico / vector: declared sizes are advisory and Chrome ignores them
          // for installability. Recorded, not asserted — see the header note.
          console.log(`  icon ${icon.src} declared=${icon.sizes} (not a PNG; dimensions not asserted)`);
          continue;
        }
        const claimed = String(icon.sizes).match(/^(\d+)x(\d+)$/);
        expect(claimed, `icon ${icon.src} declares a single pixel size`).toBeTruthy();
        console.log(`  icon ${icon.src} declared=${icon.sizes} actual=${actual.width}x${actual.height}`);
        expect(
          `${actual.width}x${actual.height}`,
          `icon ${icon.src} claims ${icon.sizes} but the bytes are ${actual.width}x${actual.height}`
        ).toBe(icon.sizes);
      }
    } finally {
      await rig.close();
    }
  });

  // ── 3a ───────────────────────────────────────────────────────────────────
  test('3a. on the router origin there is NO service worker — and the trap is a TypeError, not a SecurityError', async ({ page }) => {
    const rig = await startRig({ host: LAN_HOST });
    try {
      const errors = recordConsole(page);
      await page.goto(`${rig.portal.origin}/${ENTRY}`, { waitUntil: 'load' });

      const measured = await page.evaluate(PROBE);
      console.log(`  [router origin] ${JSON.stringify(measured)}`);

      expect(measured.href, 'this is the non-loopback LAN address').toContain(LAN_HOST);
      expect(measured.isSecureContext, 'a bare LAN IP over http is Not Trustworthy (spec §3.1 step 9)').toBe(false);
      expect(measured.hasServiceWorkerAPI, 'navigator.serviceWorker must not exist here').toBe(false);
      expect(measured.serviceWorkerType, 'it is ABSENT, not a rejected/throwable object').toBe('undefined');
      // The corollary the wallet design turns on: no subtle means no seed here.
      expect(measured.hasCryptoSubtle, 'crypto.subtle is secure-context-gated').toBe(false);
      // ...but getRandomValues is not gated, which is why a no-install paste
      // fallback is still possible on this origin.
      expect(measured.hasGetRandomValues, 'getRandomValues has no SecureContext gate').toBe(true);

      // THE assertion. A try/catch feature-detect crashes; a
      // `catch (SecurityError)` misses it; only a property check degrades.
      const outcome = await page.evaluate(`(async () => {
        try {
          await navigator.serviceWorker.register('sw.js');
          return { kind: 'registered' };
        } catch (err) {
          return { kind: 'threw', name: err && err.name, message: String(err && err.message) };
        }
      })()`);
      console.log(`  try/catch detect: ${JSON.stringify(outcome)}`);
      expect(outcome.kind, 'register() is unreachable — the property is undefined').toBe('threw');
      expect(outcome.name, 'NOT a SecurityError — a TypeError, so catch(SecurityError) misses it').toBe('TypeError');
      expect(outcome.message).toContain('undefined');

      // And the portal DEGRADED rather than throwing: the install affordance is
      // an honest signpost, the payment UI still rendered, no page error.
      const panel = page.locator('[data-testid="install-panel"]');
      if (await panel.count()) {
        expect(await panel.first().getAttribute('data-variant'), 'an insecure origin can only signpost').toBe('signpost');
      }
      await page.waitForSelector('#cashu-token', { timeout: 15000 });
      const fatal = errors.filter((e) => e.type === 'pageerror');
      expect(fatal, 'the absent serviceWorker must not take the page down').toEqual([]);
    } finally {
      await rig.close();
    }
  });

  // ── 3b ───────────────────────────────────────────────────────────────────
  test('3b. on a secure origin the service worker registers and reaches "activated"', async ({ page }) => {
    const rig = await startRig({ host: '127.0.0.1' });
    try {
      await page.goto(`${rig.portal.origin}/${ENTRY}`, { waitUntil: 'load' });

      const measured = await page.evaluate(PROBE);
      console.log(`  [secure origin] ${JSON.stringify(measured)}`);
      expect(measured.isSecureContext, 'loopback IS potentially trustworthy (spec §3.1 step 4)').toBe(true);
      expect(measured.hasServiceWorkerAPI).toBe(true);

      // The APP registers it (InstallPanel mounts -> registerServiceWorker), so
      // this asserts the product path, not a hand-rolled registration inside
      // the test.
      //
      // `navigator.serviceWorker.ready` is NOT sufficient: it resolves as soon
      // as a registration has an ACTIVE worker, and a worker in the `activating`
      // state already satisfies that (measured — ready resolved with
      // activeState === 'activating'). The card asks for `activated`, which is
      // the state that only follows a successful install event, so the
      // assertion waits for the state itself.
      const state = await waitForActivated(page);
      console.log(`  worker: ${JSON.stringify(state)}`);
      expect(state.activeState, 'the worker must reach "activated", not merely install').toBe('activated');
      expect(state.scope).toContain(rig.portal.origin);

      const caches = await page.evaluate('caches.keys()');
      console.log(`  caches: ${JSON.stringify(caches)}`);
      expect(caches.some((n) => n.startsWith('tollgate-shell-')), 'activation must leave a versioned shell cache').toBe(true);
    } finally {
      await rig.close();
    }
  });

  // ── 3c ───────────────────────────────────────────────────────────────────
  test('3c. WITH the secure-origin allowlist, the worker activates on the router-shaped origin itself', async ({ page: _page }, testInfo) => {
    // This is the ONLY configuration in which a real router origin can run a
    // worker: Chromium's secure-origin override (`--unsafely-treat-insecure-
    // origin-as-secure`), which the SPIKE measured as the one working
    // mechanism, viable for a device-owned fleet and never for BYOD.
    //
    // MEASURED on this host: Playwright's BUNDLED Chromium ignores the switch
    // (isSecureContext stays false, v149.0.7827.55), while the system Chrome
    // channel honours it (v156.0.8078.47). So the arm runs on `channel:
    // 'chrome'` and SKIPS — loudly, with the reason — when that binary is
    // absent. It must never quietly pass on the bundled browser.
    const rig = await startRig({ host: LAN_HOST });
    let browser;
    try {
      let available = true;
      let probeError = null;
      try {
        browser = await chromium.launch({ channel: 'chrome' });
      } catch (err) {
        available = false;
        probeError = String(err && err.message ? err.message : err);
      }
      test.skip(!available, `system Chrome channel unavailable (${probeError}) — the allowlist cannot be exercised`);

      await browser.close();
      browser = await chromium.launch({
        channel: 'chrome',
        args: [`--unsafely-treat-insecure-origin-as-secure=${rig.portal.origin}`],
      });
      const context = await browser.newContext({ ...devices['Pixel 7'] });
      const page = await context.newPage();

      await page.goto(`${rig.portal.origin}/${ENTRY}`, { waitUntil: 'load' });
      const measured = await page.evaluate(PROBE);
      console.log(`  [allowlisted router origin] ${JSON.stringify(measured)}`);
      expect(measured.href).toContain(LAN_HOST);
      expect(measured.isSecureContext, 'the override must actually take effect, or this arm proves nothing').toBe(true);

      const active = await waitForActivated(page);
      console.log(`  worker ON THE ROUTER ORIGIN: ${JSON.stringify(active)}`);
      expect(active.activeState).toBe('activated');

      // A worker that takes over and then eats the router's own price sheet is
      // the defect W1 fixed; prove the money path still arrives under a
      // CONTROLLING worker (a fresh navigation is controlled once activated).
      await page.reload({ waitUntil: 'load' });
      const controlling = await page.evaluate('!!navigator.serviceWorker.controller');
      console.log(`  page controlled by the worker: ${controlling}`);
      await page.waitForSelector('#cashu-token', { timeout: 15000 });
      await expect(page.locator('.tollgate-captive-portal-method-options button').first()).toBeVisible();

      await context.close();
    } finally {
      if (browser) await browser.close().catch(() => {});
      await rig.close();
    }
    void testInfo;
  });

  // ── 4 ────────────────────────────────────────────────────────────────────
  test('4. the balance and the venue identity are RENDERED FROM THE API, not hardcoded', async ({ page }) => {
    // "Venue" here is the gateway/merchant surface the buyer is paying: which
    // device the router thinks they are, which mint it takes, and at what price.
    // Everything the UI shows about it comes over the wire, and the proof is
    // that CHANGING the API changes the page — a hardcoded render cannot follow.
    const rig = await startRig({ host: LAN_HOST });
    try {
      await page.goto(`${rig.portal.origin}/${ENTRY}`, { waitUntil: 'load' });
      await page.waitForSelector('#cashu-token', { timeout: 15000 });

      const mac = await page.locator('.tollgate-captive-portal-deviceinfo').textContent();
      console.log(`  device line: ${JSON.stringify(mac)}`);
      expect(mac, 'the device identity must come from /whoami').toContain(rig.state.mac);

      const options = page.locator('.tollgate-captive-portal-method-options button');
      await expect(options.first()).toContainText(`${rig.state.price} ${rig.state.unit}`);
      await expect(options.first()).toContainText(new URL(rig.state.mintUrl).host);
      // The step size + price-per-step line is derived from the price sheet too.
      await expect(options.first()).toContainText(/min/);

      // Mutate the gateway and reload: the page must follow, field by field.
      rig.state.mac = '02:00:00:00:00:a7';
      rig.state.price = 777;
      const secondMint = await startStubMint({ keysetId: KEYSET_ID });
      rig.state.mintUrl = secondMint.origin;
      try {
        await page.reload({ waitUntil: 'load' });
        await page.waitForSelector('#cashu-token', { timeout: 15000 });

        await expect(page.locator('.tollgate-captive-portal-deviceinfo')).toContainText(rig.state.mac);
        await expect(page.locator('.tollgate-captive-portal-method-options button').first()).toContainText('777 sat');
        await expect(page.locator('.tollgate-captive-portal-method-options button').first()).toContainText(
          new URL(rig.state.mintUrl).host
        );
        console.log('  after API mutation the page followed: mac, mint and price all changed');
      } finally {
        await secondMint.close();
      }

      // The balance page reads /balance (a different endpoint, a different page).
      const balance = await page.context().newPage();
      await balance.goto(`${rig.portal.origin}/balance.html`, { waitUntil: 'load' });
      await balance.waitForSelector('.tollgate-captive-portal-balance-panel', { timeout: 15000 });
      const noSession = await balance.locator('.tollgate-captive-portal-balance-panel').textContent();
      console.log(`  balance (no session): ${JSON.stringify(noSession.slice(0, 90))}`);
      expect(noSession).toContain('No active session');

      // Now give the stub an active session and prove the page renders its
      // numbers rather than a template.
      rig.state.session = { usage: 120000, allotment: 600000, startTime: 1700000000, token: 'x' };
      await balance.reload({ waitUntil: 'load' });
      await balance.waitForSelector('.tollgate-captive-portal-balance-grid', { timeout: 15000 });
      const grid = await balance.locator('.tollgate-captive-portal-balance-grid').textContent();
      console.log(`  balance (active): ${JSON.stringify(grid)}`);
      expect(grid, '/balance remaining=480000ms must render as 8 min').toContain('8 min');
      expect(grid, 'the allotment must render from the API').toContain('10 min');
      await balance.close();
    } finally {
      await rig.close();
    }
  });

  // ── 5a ───────────────────────────────────────────────────────────────────
  test('5a. a pasted Cashu token spends: POST / with the raw token, granted, and the session flips', async ({ page }) => {
    const rig = await startRig({ host: LAN_HOST });
    try {
      await page.goto(`${rig.portal.origin}/${ENTRY}`, { waitUntil: 'load' });
      await page.waitForSelector('#cashu-token', { timeout: 15000 });

      // Before the spend the router knows no session — asserted, not assumed.
      expect(rig.state.session, 'the stub starts with no session').toBeNull();

      const token = rig.token({ amount: 420, version: 3 });
      await page.fill('#cashu-token', token);

      // The wallet decodes it client-side and shows what it buys.
      await expect(page.locator('.status.success .status-label')).toContainText(/valid cashu token/i, { timeout: 15000 });

      // The mint leg really ran: the fee pre-check hits /v1/keysets.
      //
      // POLL, do not assert — the label above and the mint call below come from
      // two different effects in src/components/Cashu.jsx: validation (:138)
      // sets the "valid" label, while getMintSwapFee (:170) is keyed on
      // `[token, tokenValue]` so it cannot even start until that state update
      // has rendered, and then it awaits a real fetch. The label is therefore
      // visible strictly BEFORE the mint request is issued; asserting the
      // journal immediately raced the effect and went red ~1 run in 3. The
      // assertion is unchanged in strength (the mint call must still arrive),
      // only the wait is real. Same shape as waitForActivated above.
      await expect
        .poll(() => rig.mint.journal.some((j) => j.path === '/v1/keysets'), {
          timeout: 10000,
          message: 'the mint fee pre-check must reach the mint',
        })
        .toBe(true);
      console.log(`  mint journal: ${JSON.stringify(rig.mint.journal)}`);

      const pay = page.locator('.tollgate-captive-portal-method-submit button.cta').first();
      await expect(pay).toBeEnabled();
      await pay.click();

      await page.waitForSelector('.tollgate-captive-portal-access-granted', { timeout: 20000 });
      const granted = await page.locator('.tollgate-captive-portal-access-granted').textContent();
      console.log(`  granted: ${JSON.stringify(granted.slice(0, 120))}`);
      expect(granted).toMatch(/Payment successful/i);

      // THE payment request: the raw token, as text/plain, on POST /. Anything
      // else (a JSON envelope, a different path) would not be the HTTP-01 money
      // path the router and its curl example implement.
      const posts = rig.api.journal.filter((j) => j.method === 'POST' && j.path === '/');
      console.log(`  POST journal: ${JSON.stringify(posts.map((p) => ({ path: p.path, body: p.body && p.body.slice(0, 16) + '…' })))}`);
      expect(posts.length, 'exactly one payment request').toBe(1);
      expect(posts[0].body).toBe(token);

      // The success transition is not cosmetic: the router's state flipped.
      expect(rig.state.session, 'the merchant must have opened a session').not.toBeNull();
      expect(rig.state.session.token).toBe(token);

      // ...and a page that re-reads /balance now sees the live session.
      const balance = await page.context().newPage();
      await balance.goto(`${rig.portal.origin}/balance.html`, { waitUntil: 'load' });
      await balance.waitForSelector('.tollgate-captive-portal-balance-grid', { timeout: 15000 });
      const grid = await balance.locator('.tollgate-captive-portal-balance-grid').textContent();
      console.log(`  balance after purchase: ${JSON.stringify(grid)}`);
      expect(grid).toContain('10 min');
      await balance.close();
    } finally {
      await rig.close();
    }
  });

  // ── 5b ───────────────────────────────────────────────────────────────────
  test('5b. the Lightning path renders a real QR invoice and the paid transition flips the session state', async ({ page }) => {
    // The Cashu leg has no QR — its "invoice" is the token itself. A rendered
    // QR only exists on the Lightning rail, so that is where the card's
    // "payment request and rendered QR/invoice" is asserted, end to end
    // against the stub: request invoice -> QR -> status poll -> granted.
    const rig = await startRig({ host: LAN_HOST });
    try {
      await page.goto(`${rig.portal.origin}/${ENTRY}`, { waitUntil: 'load' });

      // The tab is gated on a real capability probe (GET /ln-invoice without a
      // quote), so this also proves the route detection works over the wire.
      const tab = page.locator('#tab-lightning');
      await expect(tab).toHaveAttribute('data-disabled', 'false', { timeout: 15000 });
      await tab.click();

      const buy = page.locator('.tollgate-captive-portal-method-submit button.cta').first();
      await expect(buy).toBeVisible({ timeout: 15000 });
      await buy.click();

      const invoice = page.locator('.tollgate-captive-portal-method-invoice');
      await expect(invoice).toBeVisible({ timeout: 20000 });

      // A REAL rendered QR: the SVG is generated from the invoice string by
      // qrcode-svg, so an empty/fabricated invoice renders nothing.
      //
      // qrcode-svg emits ONE `<rect>` PER MODULE (its `join` option, which would
      // emit a single `<path>`, is off by default and `createQr` does not set
      // it), plus one background `<rect>`. So the module count is
      // `rect` − 1, never `path`. Counting paths here measured zero and would
      // have failed against a perfectly good QR.
      const svg = invoice.locator('.tollgate-captive-portal-method-invoice-svg svg');
      await expect(svg).toBeVisible();
      const rects = await svg.locator('rect').count();
      const paths = await svg.locator('path').count();
      const modules = rects - 1; // minus the background rect
      console.log(`  QR: ${rects} rect(s), ${paths} path(s) -> ${modules} module(s)`);
      expect(modules, 'the QR must carry real modules, not an empty frame').toBeGreaterThan(1);
      // A 21x21 (version 1) frame is the floor for even a tiny payload; the
      // invoice string here is longer, so this also proves real encoding.
      expect(modules, 'a real QR at this payload size is far more than 21 modules').toBeGreaterThan(21);

      const href = await invoice.locator('a').first().getAttribute('href');
      console.log(`  invoice href: ${href.slice(0, 60)}…`);
      expect(href, 'the invoice must be a BOLT11 string').toBe(`lightning:${rig.state.invoice}`);
      await expect(invoice).toContainText(new RegExp(`${rig.state.price}\\s*sat`, 'i'));

      // The request was a real POST carrying the mint and amount.
      const created = rig.api.journal.filter((j) => j.method === 'POST' && j.path === '/ln-invoice');
      expect(created.length, 'the invoice must be created by a POST').toBe(1);
      console.log(`  POST /ln-invoice body: ${created[0].body}`);
      expect(JSON.parse(created[0].body)).toMatchObject({ amount: rig.state.price, mint_url: rig.state.mintUrl });

      // Settlement: the page polls GET /ln-invoice?quote=…, so flipping the
      // stub's state is the payment landing. No reload, no re-render trick.
      expect(rig.state.invoiceState).toBe('UNPAID');
      rig.state.invoiceState = 'PAID';
      await page.waitForSelector('.tollgate-captive-portal-access-granted', { timeout: 20000 });
      const granted = await page.locator('.tollgate-captive-portal-access-granted').textContent();
      console.log(`  granted: ${JSON.stringify(granted.slice(0, 110))}`);
      expect(granted).toMatch(/Payment successful/i);
      const polls = rig.api.journal.filter((j) => j.method === 'GET' && j.path === '/ln-invoice');
      console.log(`  status polls: ${polls.length}`);
      expect(polls.length, 'the settle transition must come from polling, not from a timer guess').toBeGreaterThan(1);
    } finally {
      await rig.close();
    }
  });

  // ── 6 ────────────────────────────────────────────────────────────────────
  test('6. with the API detached the portal DEGRADES — it never fabricates an invoice', async ({ page }) => {
    const rig = await startRig({ host: LAN_HOST });
    try {
      const errors = recordConsole(page);
      await page.goto(`${rig.portal.origin}/${ENTRY}`, { waitUntil: 'load' });
      await page.waitForSelector('#cashu-token', { timeout: 15000 });

      // Now the router's backend dies. The socket is destroyed, so this is the
      // transport failure a real crash produces — not a JSON "no thanks" the app
      // could render as a gateway decision.
      rig.api.detach();

      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('.tollgate-captive-portal-error', { timeout: 20000 });

      const surface = await page.locator('.tollgate-captive-portal-error').textContent();
      console.log(`  degraded surface: ${JSON.stringify(surface.slice(0, 140))}`);
      expect(surface).toMatch(/could not fetch tollgate (details|information)/i);
      // It says it is retrying rather than claiming a state it cannot know.
      await expect(page.locator('.tollgate-captive-portal-retrying')).toContainText(/retrying/i);

      // The three things a fabricated invoice would need are all absent.
      expect(await page.locator('.tollgate-captive-portal-method-invoice').count(), 'no invoice may be rendered').toBe(0);
      expect(await page.locator('.tollgate-captive-portal-access-granted').count(), 'no grant may be rendered').toBe(0);
      expect(await page.locator('.tollgate-captive-portal-method-submit button.cta').count(), 'no purchase CTA').toBe(0);

      // And it never even TRIED to pay: a degraded portal that posts a token
      // would consume the customer's value for nothing.
      const posts = rig.api.journal.filter((j) => j.method === 'POST');
      console.log(`  POSTs while detached: ${posts.length}`);
      expect(posts, 'a detached router must not receive a payment request').toEqual([]);

      const fatal = errors.filter((e) => e.type === 'pageerror');
      expect(fatal, 'degradation must not throw').toEqual([]);
    } finally {
      await rig.close();
    }
  });
});
