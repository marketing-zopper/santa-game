import { defineConfig } from '@playwright/test';

// Browser tests run against a production build made with --mode e2e (adds a test-only hook; see .env.e2e).
//
//   chrome   real Google Chrome  — the FULL suite (signed-in / admin / phone-OTP specs also need the env vars below)
//   edge     real Microsoft Edge — guest + responsive + compatibility specs
//   firefox  Playwright Firefox  — guest + responsive + compatibility specs
//   webkit   Playwright WebKit   — the Safari engine; guest + responsive + compatibility specs
//
// Chrome / Edge run with the browsers' REAL default autoplay policy (audible audio needs a tap; muted autoplay is allowed), so the
// music test exercises what visitors actually experience. Signed-in specs need SUPABASE_SERVICE_ROLE_KEY; OTP specs also SUPABASE_ACCESS_TOKEN +
// SUPABASE_PROJECT_REF (without them they are skipped).
// Chrome/Edge default for visitors: audible autoplay needs a user gesture, MUTED autoplay is allowed
const STRICT_AUTOPLAY = ['--autoplay-policy=document-user-activation-required'];
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const CROSS_BROWSER_SPECS = ['**/guest.spec.js', '**/responsive.spec.js', '**/compat.spec.js'];

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.js',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4174', headless: true, screenshot: 'only-on-failure' },
  projects: [
    { name: 'chrome', use: { ...PHONE, channel: 'chrome', launchOptions: { args: STRICT_AUTOPLAY } } },
    { name: 'edge', testMatch: CROSS_BROWSER_SPECS, use: { ...PHONE, channel: 'msedge', launchOptions: { args: STRICT_AUTOPLAY } } },
    // Firefox has no mobile emulation (isMobile / hasTouch are unsupported there): same viewport, desktop-style input
    { name: 'firefox', testMatch: CROSS_BROWSER_SPECS, use: { browserName: 'firefox', viewport: PHONE.viewport, deviceScaleFactor: 1 } },
    { name: 'webkit', testMatch: CROSS_BROWSER_SPECS, use: { ...PHONE, browserName: 'webkit' } },
  ],
  webServer: {
    command: 'npm run build:e2e && npm run preview:e2e',
    url: 'http://localhost:4174',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
