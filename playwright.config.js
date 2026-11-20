import { defineConfig } from '@playwright/test';

// Browser tests run against a production build made with --mode e2e (adds a test-only hook; see .env.e2e).
// Real Chrome is used (no browser download). Signed-in specs need SUPABASE_SERVICE_ROLE_KEY in the environment
// (to create temporary test users); without it they are skipped.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4174',
    channel: 'chrome',
    headless: true,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build:e2e && npm run preview:e2e',
    url: 'http://localhost:4174',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
