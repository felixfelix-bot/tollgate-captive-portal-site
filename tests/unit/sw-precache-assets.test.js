import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// GATE (card t_98145b7d, W1) — the shell precache must contain the CODE.
//
// `tests/unit/sw-lifecycle.test.js` pins the versioning; `sw-fetch-rule.test.js`
// pins which requests the worker may answer. Neither of them could catch the
// defect this file exists for, because both read `public/sw.js` as TEXT and the
// text looked entirely correct.
//
// THE DEFECT, measured rather than assumed:
//
//   the precache allow-list named splash.html, balance.html, the manifest and
//   the icons — and NOT the JavaScript or CSS. The offline reload therefore
//   returned an HTML document that then requested `/assets/portal-<hash>.js`;
//   that path is not on the (exact-path) allow-list, so the worker bypassed it
//   into a dead network, the bundle never loaded, and the page rendered as an
//   empty white rectangle.
//
// The e2e gate at the time asserted status 200 + body length > 200 + the URL.
// ALL of that passes for an HTML shell whose scripts 404 — which is why the only
// visible symptom was a blank screenshot nobody looked at closely.
//
// So this file pins the property that was actually missing: the built worker's
// precache must name the script and stylesheet the entry document references.
// It runs against the BUILD output because that is the artifact that ships —
// `public/sw.js` carries a placeholder block that the build replaces.
//
// ── WHY THE SKIP IS ON `it`, NOT ON `describe` (card t_1b85ff0f) ──────────────
//
// This file used to guard itself with `const d = HAVE_BUILD ? describe :
// describe.skip;` and read both files at the top of the describe factory. That
// guard did nothing: a suite factory — skipped or not — is EVALUATED at
// collection time, so the readFileSync ran anyway, threw ENOENT, and Vitest
// reported the whole FILE as failed ("Tests no tests") before a single test
// existed. A red unit job on every branch carrying this file, for a reason the
// diff never touched.
//
// So: no I/O at module scope or in a describe body. The bytes are read lazily by
// `built()` from inside the test callbacks, and each test is gated with
// `it.skipIf` — which registers the test and skips only its RUN. A checkout with
// no build/ now reports 4 skipped tests instead of a broken suite.
//
// A skip is still not a pass, so CI sets CI_REQUIRE_BUILD=1: there, a missing
// build/ is a FAILURE (the artifact was supposed to be produced first). Locally,
// before you have run `npm run build`, the tests skip and say so.
//
// (An earlier attempt put the readFileSync calls in a `beforeAll`. That does not
// work either: a throwing beforeAll fails the tests it feeds, which is the same
// red job with a worse message. The bytes have to be read inside the callbacks
// that are already gated.)

const BUILD = resolve(process.cwd(), 'build');
const ENTRY_DOC = resolve(BUILD, 'splash.html');
const BUILT_SW = resolve(BUILD, 'sw.js');

function has(p) {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}

const HAVE_BUILD = has(ENTRY_DOC) && has(BUILT_SW);
const REQUIRE_BUILD = process.env.CI_REQUIRE_BUILD === '1';
const SKIP = !HAVE_BUILD && !REQUIRE_BUILD;

if (!HAVE_BUILD && !REQUIRE_BUILD) {
  console.warn(
    '[sw-precache-assets] no build/ in this checkout — the 4 precache gates are ' +
      'SKIPPED, not passed. Run `npm run build` to exercise them against the ' +
      'artifact that ships.'
  );
}

/** The build bytes, read on first use from inside a test (never at collection). */
let cache = null;
function built() {
  if (!cache) {
    cache = { html: readFileSync(ENTRY_DOC, 'utf8'), sw: readFileSync(BUILT_SW, 'utf8') };
  }
  return cache;
}

/** Pull the worker's PRECACHE array out of the built source. */
function precacheEntries(sw) {
  const m = sw.match(/var PRECACHE = \[([\s\S]*?)\];/);
  if (!m) throw new Error('the built worker has no PRECACHE array');
  // eslint-disable-next-line no-new-func
  return new Function(`return [${m[1]}];`)();
}

/** Same-origin JS/CSS the entry document actually asks for. */
function documentAssets(html) {
  const out = [];
  const re = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1].startsWith('/assets/') && /\.(?:js|css)$/i.test(m[1])) out.push(m[1]);
  }
  return out;
}

describe('the BUILT shell precaches the code it needs to render', () => {
  it.skipIf(SKIP)('names every script and stylesheet in the entry document', () => {
    const { html, sw } = built();
    const assets = documentAssets(html);
    // Guard the guard: if the document references nothing, this test would be
    // vacuously green and would certify a shell that cannot render.
    expect(assets.length, 'splash.html must reference JS/CSS').toBeGreaterThan(0);

    const entries = precacheEntries(sw).map((e) => e.replace(/^\./, ''));
    for (const asset of assets) {
      expect(entries, `${asset} must be precached or the offline shell is blank`).toContain(asset);
    }
  });

  it.skipIf(SKIP)('still refuses to precache any authority or API path', () => {
    const entries = precacheEntries(built().sw);
    for (const banned of ['/balance', '/usage', '/pay', '/ln-invoice', '/v1/mint', '/v1/melt']) {
      // `/balance` is a legitimate DOCUMENT (balance.html) but never this path.
      expect(
        entries.some((e) => e === `./${banned}` || e === `.${banned}`),
        `${banned} must never be precached`
      ).toBe(false);
    }
  });

  it.skipIf(SKIP)('splits cache-first (immutable assets) from network-first (documents)', () => {
    // The strategy split is what makes an offline reload work AND lets a release
    // actually reach a returning visitor. A single strategy gets one of them
    // wrong, so pin that both branches exist.
    const { sw } = built();
    expect(sw).toMatch(/function isImmutableAsset\(/);
    expect(sw).toMatch(/if \(isImmutableAsset\(pathname\)\)/);
    // Documents must be fetched from the network FIRST, not served from cache
    // ahead of it: `var network = fetch(` is built before the cache is consulted
    // on the document branch.
    expect(sw).toMatch(/var network = fetch\(request\)/);
    const docBranch = sw.slice(sw.indexOf('// Document / icon'));
    expect(docBranch.indexOf('network.catch(')).toBeLessThan(docBranch.indexOf('cache.match('));
  });

  it.skipIf(SKIP)('has no surviving build placeholder', () => {
    const { sw } = built();
    expect(sw).not.toContain('__SW_VERSION__');
    expect(sw).not.toContain('__PRECACHE__');
  });
});
