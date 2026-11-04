// A HERMETIC TollGate fixture: the portal's shipped bytes on a plain-HTTP
// origin, the router's API on :2121, and a Cashu mint — all on this host, no
// router, no emulator, no network.
//
// ── Why a bespoke fixture instead of page.route() ───────────────────────────
//
// `tests/e2e/helpers/mock-backend.mjs` intercepts fetches INSIDE the page with
// Playwright routing and replaces `src/helpers/cashu.js` with a stub module.
// That is the right tool for UI state, and the wrong tool for this card: it
// proves nothing about the WIRE. The whole point here is the client-side
// purchase path as the browser actually walks it —
//
//   document over http:// (not localhost, which is a secure context by spec)
//   → GET  /whoami, GET /, GET /usage, GET /balance     (cross-origin, :2121)
//   → GET  {mint}/v1/keysets                            (cross-origin, CORS)
//   → POST /            raw text/plain Cashu token      (the money path)
//
// — so every leg is a real socket, a real CORS decision and a real CSP check.
// `page.route` would bypass CORS and CSP entirely and the test would be green
// on a portal that cannot reach its own router.
//
// ── The two origins, and why both are needed ────────────────────────────────
//
// The portal is served from `http://<router-lan-ip>:2051` — a bare RFC1918
// address over plain http, which W3C Secure Contexts §3.1 calls Not
// Trustworthy. `localhost`/`127.0.0.1` is Potentially Trustworthy (§3.1 steps
// 4-5), so a test that only ever visits localhost measures the one address the
// constraint does not apply to. This harness therefore binds the SAME build to
// both and lets the spec run them as a matched pair:
//
//   portalOrigin   http://<lan-ip>:<ephemeral>   not secure  → no SW at all
//   secureOrigin   http://127.0.0.1:<ephemeral>  secure      → SW activates
//
// ── Why :2121 is fixed ──────────────────────────────────────────────────────
//
// `src/helpers/tollgate.js` hardcodes the API port (`http://<hostname>:2121`),
// exactly as the TollGate spec requires. The portal origin's PORT is free
// (nothing in the app reads it) but the :2121 HOST is not: the API must answer
// on the same hostname the document was served from, or the app's derived base
// URL points somewhere else. So the stub binds `host:2121` for whichever host
// the spec is testing, and refuses to start silently if the port is taken.
//
// ── CORS policy: mirrored, not wildcarded ───────────────────────────────────
//
// The real module (tollgate-module-basic-go `CorsMiddleware`) echoes the Origin
// only for a local/private or same-host origin, never `*`, because the API is
// LAN-firewall-protected rather than credential-protected. A `*` stub would let
// this suite pass against a portal that a real router would refuse, so the stub
// reproduces the same decision and the spec asserts it.
import { createServer } from 'node:http';
import { getEncodedToken } from '@cashu/cashu-ts';

import { findLanAddress } from './portal-origin-host.mjs';

/** The API port the portal derives from its own hostname (src/helpers/tollgate.js). */
export const TOLLGATE_API_PORT = 2121;

/** Re-export so a spec can run the insecure half without importing two helpers. */
export { findLanAddress };

// ── CORS: the module's decision, restated ───────────────────────────────────

/** RFC1918 / loopback / CGNAT — what the module calls a "local origin". */
function isLocalOrigin(origin) {
  let host;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/** Same host, any port — the router's own portal on :2051 calling :2121. */
function isSameHost(origin, hostHeader) {
  try {
    const originHost = new URL(origin).hostname;
    const host = String(hostHeader || '').replace(/:\d+$/, '');
    return originHost !== '' && originHost === host;
  } catch {
    return false;
  }
}

/**
 * Apply the module's CORS decision. Returns the origin it echoed, or null.
 * Never emits `*` — see the header note.
 */
function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  const origin = req.headers.origin;
  if (origin && origin !== 'null' && (isLocalOrigin(origin) || isSameHost(origin, req.headers.host))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    return origin;
  }
  return null;
}

// ── the stub TollGate API (:2121) ───────────────────────────────────────────

/**
 * The mutable gateway state the portal renders from.
 *
 * Everything the UI shows about the gateway comes out of this object through
 * the wire, which is what lets the spec prove "rendered from the API, not from
 * hardcoded markup" by CHANGING it and watching the page follow.
 */
export function createPortalState({
  mac = '02:00:00:00:00:01',
  metric = 'milliseconds',
  stepSize = 600000,
  price = 210,
  minSteps = 1,
  mintUrl,
  unit = 'sat',
} = {}) {
  return {
    mac,
    metric,
    stepSize,
    price,
    minSteps,
    mintUrl,
    unit,
    /** null = no session; {usage, allotment, startTime} = an active one. */
    session: null,
    /** When true, POST / must refuse with a coded kind-21023 notice. */
    rejectPayment: null,
    /** 'UNPAID' | 'PAID' — what GET /ln-invoice?quote= reports. */
    invoiceState: 'UNPAID',
    invoiceQuote: 'hermetic-quote-1',
    invoice: 'lnbc1hermeticstubinvoice210n1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
  };
}

/** The kind-10021 advertisement the router publishes at GET /. */
function advertisement(state) {
  return {
    kind: 10021,
    id: '0'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: 0,
    tags: [
      ['metric', state.metric],
      ['step_size', String(state.stepSize)],
      ['step_purchase_limits', '1', '0'],
      ['price_per_step', 'cashu', String(state.price), state.unit, state.mintUrl, String(state.minSteps)],
    ],
    content: '',
    sig: 'b'.repeat(128),
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Start the stub TollGate API on `host:2121`.
 *
 * @returns {Promise<{
 *   origin: string,
 *   state: object,
 *   journal: Array<{method: string, path: string, origin: string|null, body: string|null}>,
 *   detach: () => void,
 *   attach: () => void,
 *   close: () => Promise<void>,
 * }>}
 */
export async function startStubTollGateApi({ host, state, port = TOLLGATE_API_PORT }) {
  const journal = [];
  let detached = false;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`);
    const path = url.pathname;
    const method = req.method || 'GET';

    // Journal BEFORE the detached check: a negative-control assertion is
    // "the portal tried to READ and never tried to PAY", which cannot be
    // observed if a detached stub forgets the attempt.
    const body = method === 'POST' ? await readBody(req).catch(() => null) : null;
    journal.push({ method, path, origin: req.headers.origin || null, body });

    // A detached stub is a BROKEN ROUTER, not a 503 with JSON: the socket dies
    // so the page sees the same transport failure it would see from a router
    // whose backend crashed. A JSON error would let the app render a "the
    // gateway says no" screen instead of the degraded surface under test.
    if (detached) {
      req.socket.destroy();
      return;
    }

    const echoed = applyCors(req, res);
    if (method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const json = (code, payload) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    const text = (code, payload) => {
      res.writeHead(code, { 'Content-Type': 'text/plain' });
      res.end(payload);
    };

    // /whoami — the portal's only source for the device identity it renders.
    if (path === '/whoami') {
      text(200, `mac=${state.mac}`);
      return;
    }

    // / — GET is the price sheet (kind 10021), POST is the money path.
    if (path === '/' || path === '') {
      if (method === 'POST') {
        if (state.rejectPayment) {
          json(402, {
            kind: 21023,
            tags: [['code', state.rejectPayment.code]],
            content: state.rejectPayment.message,
          });
          return;
        }
        // The token is a bearer instrument: authorise from the body, exactly as
        // the module does, and flip the session before answering.
        const token = (body || '').trim();
        if (!token.startsWith('cashu')) {
          json(400, { kind: 21023, tags: [['code', 'payment-error-invalid-token']], content: 'invalid cashu token' });
          return;
        }
        state.session = {
          usage: 0,
          allotment: state.stepSize * state.minSteps,
          startTime: Math.floor(Date.now() / 1000),
          token,
        };
        json(200, {});
        return;
      }
      json(200, advertisement(state));
      return;
    }

    if (path === '/usage') {
      if (!state.session) {
        text(200, '-1/-1');
        return;
      }
      text(200, `${state.session.usage}/${state.session.allotment}`);
      return;
    }

    if (path === '/balance') {
      if (!state.session) {
        json(200, { status: 1, session_active: false, mac: state.mac });
        return;
      }
      const { usage, allotment, startTime } = state.session;
      json(200, {
        status: 1,
        session_active: true,
        metric: state.metric,
        usage,
        allotment,
        remaining: allotment - usage,
        start_time: startTime,
        mac: state.mac,
      });
      return;
    }

    // /ln-invoice — GET without a quote is the capability probe (400 + JSON
    // envelope means "route exists"); GET with a quote is the status poll;
    // POST creates the invoice.
    if (path === '/ln-invoice') {
      const quote = url.searchParams.get('quote');
      if (method === 'POST') {
        json(200, {
          status: 1,
          quote: state.invoiceQuote,
          invoice: state.invoice,
          mint_url: state.mintUrl,
          amount: state.price,
          expiry: 600,
          state: 'UNPAID',
        });
        return;
      }
      if (quote) {
        const paid = state.invoiceState === 'PAID';
        json(200, {
          status: 1,
          quote,
          mint_url: state.mintUrl,
          amount: state.price,
          state: state.invoiceState,
          access_granted: paid,
          allotment: paid ? state.stepSize : 0,
          metric: state.metric,
        });
        return;
      }
      json(400, { status: 0, error: 'quote is required' });
      return;
    }

    json(404, { status: 0, error: `no route ${path}` });
  });

  await new Promise((resolve, reject) => {
    server.once('error', (err) => {
      reject(
        new Error(
          `stub TollGate API could not bind ${host}:${port} (${err.code || err.message}). ` +
            'The portal derives its API base as http://<page-host>:2121, so this port is not optional.'
        )
      );
    });
    server.listen(port, host, resolve);
  });

  return {
    origin: `http://${host}:${port}`,
    state,
    journal,
    detach() {
      detached = true;
      server.closeIdleConnections?.();
      // Kill keep-alive sockets so the next request actually fails.
      server.closeAllConnections?.();
    },
    attach() {
      detached = false;
    },
    close() {
      return new Promise((done) => {
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
        server.close(() => done());
      });
    },
  };
}

// ── the stub Cashu mint ─────────────────────────────────────────────────────

/**
 * Start a stub mint on an ephemeral port.
 *
 * The portal's ONLY mint call on the purchase path is
 * `GET {mint}/v1/keysets` (src/helpers/mint-fee.js) — it sums each proof's
 * `input_fee_ppk` to pre-check the swap fee. The stub therefore serves exactly
 * that route, with a fee the spec can assert on, and journals every hit so the
 * spec can prove the mint leg was really exercised rather than skipped.
 *
 * CORS: a real mint serves `/v1/keys*` CORS-open (it is public key material),
 * so the stub echoes any origin. It is still not `*`, so a browser that sends
 * credentials cannot accidentally be let through.
 */
export async function startStubMint({ keysetId, inputFeePpk = 0, unit = 'sat' } = {}) {
  const journal = [];

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://placeholder');
    journal.push({ method: req.method, path: url.pathname });

    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/v1/keysets') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          keysets: [{ id: keysetId, unit, input_fee_ppk: inputFeePpk, active: true }],
        })
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: `no route ${url.pathname}` }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    keysetId,
    journal,
    close() {
      return new Promise((done) => {
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
        server.close(() => done());
      });
    },
  };
}

// ── token minting ───────────────────────────────────────────────────────────

/**
 * Mint a REAL Cashu token for the stub mint, with the app's own cashu-ts.
 *
 * Deliberately not a hand-written `cashuB...` string: the portal decodes with
 * the pinned cashu-ts, so a token this library cannot encode is not a token the
 * purchase path should be asked to accept. The mint URL is embedded in the note
 * exactly as a wallet would embed it — that is what `mintUrlFromToken` reads to
 * auto-select the advertised mint.
 *
 * `version: 3` produces `cashuA…` (the corpus's V3 shape) and needs no keyset-id
 * mapping; `version: 4` produces `cashuB…`.
 */
export function mintToken({ mintUrl, amount = 420, keysetId, version = 3, unit = 'sat' }) {
  const proofs = [
    {
      amount,
      id: keysetId,
      // A proof's secret/C are opaque to the portal (it sums amounts; the
      // merchant re-decodes authoritatively on POST /), so a well-formed
      // placeholder is exactly what the corpus fixtures use for this class.
      secret: 'hermetic-' + 'aa'.repeat(30),
      C: '02' + '11'.repeat(32),
    },
  ];
  return getEncodedToken({ mint: mintUrl, proofs, unit }, { version });
}

// ── the hermeticity guard ───────────────────────────────────────────────────

/**
 * Collect every request the browser makes, so the spec can assert the run
 * touched nothing outside its own three stub origins. This is the difference
 * between "passes on this host" and "hermetic".
 */
export function recordRequests(page) {
  const seen = [];
  page.on('request', (request) => {
    try {
      const u = new URL(request.url());
      seen.push({ url: request.url(), host: u.host, scheme: u.protocol, resourceType: request.resourceType() });
    } catch {
      seen.push({ url: request.url(), host: '<unparseable>', scheme: '', resourceType: request.resourceType() });
    }
  });
  return {
    all: seen,
    hosts() {
      return [...new Set(seen.map((s) => s.host))];
    },
    foreign(allowedHosts) {
      const allowed = new Set(allowedHosts);
      return seen.filter((s) => !allowed.has(s.host));
    },
  };
}

/**
 * Console + pageerror capture. Two things this catches that a DOM assertion
 * cannot: a `TypeError ... serviceWorker` from the trap this card exists to
 * pin, and a CSP violation that silently removes an API response.
 */
export function recordConsole(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push({ type: msg.type(), text: msg.text() });
  });
  page.on('pageerror', (err) => errors.push({ type: 'pageerror', text: String(err && err.message ? err.message : err) }));
  return errors;
}
