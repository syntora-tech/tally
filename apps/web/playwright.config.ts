import { defineConfig, devices } from '@playwright/test';

export const E2E_OWNER_EMAIL = 'owner@tally.test';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    // Must match site_url / additional_redirect_urls in supabase/config.toml.
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Invoke next directly: a pnpm wrapper does not forward SIGTERM, leaving next-server running.
    command: isCI ? 'next build && next start' : 'next dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: !isCI,
    timeout: 180_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    env: { ALLOWED_EMAILS: E2E_OWNER_EMAIL },
  },
});
