import { defineConfig, devices } from '@playwright/test'

const PORT = 3000
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`

/**
 * Playwright config for Agent 9's E2E suite.
 *
 * Tagging convention:
 *   - @realtime — tests that exercise Supabase Realtime websockets. Isolated
 *                 into their own CI job (.github/workflows/pr.yml → e2e-realtime)
 *                 and granted `retries: 1` via the retry-on-tag logic below.
 *   - @slow     — tests > 30s. Allowed to run in nightly; excluded from PR CI.
 *   - @a11y     — accessibility checks using axe-core; run alongside normal e2e.
 *
 * No other retries, anywhere. Non-realtime flakes are real bugs and must be
 * investigated, not masked.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // overridden per-tag below
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    {
      name: 'chromium-default',
      use: { ...devices['Desktop Chrome'] },
      grepInvert: /@realtime/,
    },
    {
      name: 'chromium-realtime',
      // Realtime-tagged tests only. Single retry because WS connections have
      // a known (small) flake surface. If >5% flake rate is observed, the fix
      // is to investigate the underlying subscription setup, NOT widen retry
      // further.
      use: { ...devices['Desktop Chrome'] },
      grep: /@realtime/,
      retries: 1,
    },
    {
      // Mobile viewport for staff routes that must work at 390px
      name: 'mobile-chromium',
      use: { ...devices['Pixel 5'] },
      grep: /@mobile/,
    },
  ],

  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: 'npm run start',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
