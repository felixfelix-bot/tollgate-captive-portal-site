import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PORTAL_TEST_PORT || '5173';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  outputDir: 'test-results/output',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Chromium-backed mobile device on purpose. `devices['iPhone 14']`
      // defaults to WebKit, which needs a second browser download and made
      // this project unrunnable with the chromium-only install documented in
      // README/CI (`npx playwright install --with-deps chromium`).
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
    },
  ],
  // The portal is a Vite dev server. Declaring it here makes `npm run test:e2e`
  // self-contained instead of silently failing with ERR_CONNECTION_REFUSED when
  // nobody started `npm run dev` first. reuseExistingServer keeps the CI job
  // (which launches `npm run dev &` itself) working unchanged.
  //
  // `--port ${PORT}` is not cosmetic: without it the server always binds 5173, so
  // PORTAL_TEST_PORT only moved the URL the suite asserted on and any stale dev
  // server already sitting on 5173 was reused instead of this checkout's tree —
  // a run then tested someone else's working copy and failed with an export error
  // that had nothing to do with the commit under test (measured on this fleet:
  // several checkouts run in parallel, each with its own dev server).
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60000,
  },
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
    },
    timeout: 10000,
  },
});
