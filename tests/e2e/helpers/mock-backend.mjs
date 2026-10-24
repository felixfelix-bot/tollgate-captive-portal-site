// Shared mock-backend setup for Playwright e2e tests.
//
// Stubs @cashu/cashu-ts validateToken + submitToken so tests can reach
// AccessGranted without a real Cashu mint. Mocks backend endpoints on
// port 2121 (whoami, tollgate details, /usage, /balance).

const MOCK_TOLLGATE_DETAILS = {
  kind: 10021,
  id: '0'.repeat(64),
  pubkey: 'a'.repeat(64),
  created_at: 0,
  tags: [
    ['metric', 'milliseconds'],
    ['step_size', '600000'],
    ['step_purchase_limits', '1', '0'],
    ['price_per_step', 'cashu', '210', 'sat', 'https://mint.minibits.cash', 1],
  ],
  content: '',
  sig: 'b'.repeat(128),
};

const CASHU_HELPER_STUB = `
export const validateToken = (token, mint, i18n) => {
  if (!token || typeof token !== 'string' || !token.startsWith('cashu')) {
    return { status: 0, code: 'CU101', label: 'Invalid', message: 'bad token' };
  }
  return { status: 1, value: { amount: 420, unit: 'sat', isValid: true, hasProofs: true, proofCount: 1 } };
};
export const submitToken = async () => ({ status: 1, label: 'ok', message: 'ok' });
export const extractProofsFromToken = () => [];

// --- the rest of the module's export surface -------------------------------
//
// The stub replaces src/helpers/cashu.js, and src/components/Cashu.jsx imports
// { validateToken, submitToken, canSubmitAnyway, mintUrlFromToken, findMintOption }
// from it. A stub that exports only the mint-touching half does not merely skip
// those code paths — the ES module link fails, the app never hydrates, and the
// lane can never run at all (measured: "The requested module
// '/src/helpers/cashu.js' does not provide an export named …"). So every name
// the module under test imports must be exported here.
//
// canSubmitAnyway and findMintOption are copied VERBATIM from the real helper:
// they are pure, and a stub that drifted from the real gating would pin the wrong
// behaviour. If the real helper changes, change these with it.
export const canSubmitAnyway = (validation) =>
  !!validation && validation.status !== 1 && validation.code === "CU102";

export const normalizeMintUrl = (url) => {
  if ("string" !== typeof url) return null;

  let value = url.trim().toLowerCase();
  if (!value) return null;

  const scheme = value.startsWith("http://") ? "http" : "https";
  value = value.replace(scheme === "http" ? /:80(?=\\/|$)/ : /:443(?=\\/|$)/, "");
  value = value.replace(/^https?:\\/\\//, "");
  value = value.replace(/[?#].*$/, "");
  value = value.replace(/\\/+$/, "");

  return value.length ? value : null;
};

export const findMintOption = (mintUrl, options) => {
  const wanted = normalizeMintUrl(mintUrl);
  if (!wanted || !Array.isArray(options)) return null;

  return options.find((option) => normalizeMintUrl(option?.url) === wanted) || null;
};

// NOT mirrored: the real mintUrlFromToken decodes the note with cashu-ts
// (getTokenMetadata primary, getDecodedToken fallback) to learn which mint
// issued it. The stub exists to keep the cashu-ts decoders OUT of this lane, so
// it answers null — the documented "mint unknowable" answer the real helper
// uses for garbage and ambiguous notes, and a shape Cashu.jsx already handles
// (it asks the user / falls back to the advertised list). Consequence, stated
// plainly: this lane does NOT exercise mint auto-selection from a pasted note;
// that decode path is covered by tests/unit/cashu-validateToken.test.js.
// Replacing the module stub with real network-level stubbing (so the real
// decoder runs here too) is the open half of REGRESSION-A.
export const mintUrlFromToken = () => null;
`;

export const TEST_TOKEN = 'cashuBtest123MockTokenForE2E';

export async function setupMockBackend(page, options = {}) {
  const {
    usageResponse = '60000/600000',
    usageExpired = false,
    usageHang = false,
    metricOverride = null,
  } = options;

  const details = metricOverride
    ? { ...MOCK_TOLLGATE_DETAILS, tags: MOCK_TOLLGATE_DETAILS.tags.map(t => t[0] === 'metric' ? ['metric', metricOverride] : t) }
    : MOCK_TOLLGATE_DETAILS;

  await page.route('**/*', async (route, request) => {
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === '/src/helpers/cashu.js') {
      return route.fulfill({
        status: 200,
        contentType: 'text/javascript',
        body: CASHU_HELPER_STUB,
      });
    }

    if (url.port === '2121') {
      if (path === '/whoami') {
        return route.fulfill({
          status: 200,
          contentType: 'text/plain',
          body: 'mac=00:11:22:33:44:55',
        });
      }
      if (path === '/' || path === '') {
        if (method === 'POST') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: '{}',
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(details),
        });
      }
      if (path === '/usage') {
        if (usageHang) return;
        if (usageExpired) {
          return route.fulfill({
            status: 200,
            contentType: 'text/plain',
            body: '-1/-1',
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'text/plain',
          body: usageResponse,
        });
      }
      if (path === '/balance') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            session_active: true,
            metric: 'milliseconds',
            remaining: 540000,
            usage: 60000,
            allotment: 600000,
            start_time: 1,
          }),
        });
      }
      if (path === '/ln-invoice') {
        // capability probe is a GET without a quote; a real purchase is a POST
        if (method === 'POST') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              status: 1,
              quote: 'test-quote',
              invoice: 'lnbc1mockinvoice',
              mint_url: 'https://mint.minibits.cash/Bitcoin',
              amount: 210,
              expiry: 0,
              state: 'UNPAID',
            }),
          });
        }
        return route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ status: 0, error: 'quote is required' }),
        });
      }
    }

    return route.continue();
  });
}
