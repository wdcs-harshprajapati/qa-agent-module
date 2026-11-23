import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

const useBurp = process.env.USE_BURP === 'true';

if (!process.env.BASE_URL) {
  throw new Error('BASE_URL is not set. Copy .env.example to .env and fill in the values.');
}

export default defineConfig({
  testDir: './tests',
  // Single-tab mode: one worker, tests in order, each project reuses one tab
  // (see fixtures/auth.fixture.ts). Projects run one after the other.
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: 'reports/playwright-results.json' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: process.env.BASE_URL,
    // If the app uses a custom test id attribute (e.g. data-test), set it here AND in the
    // shared-tab fixture (playwright.selectors.setTestIdAttribute).
    // testIdAttribute: 'data-test',
    proxy: useBurp ? { server: 'http://127.0.0.1:8080' } : undefined,
    ignoreHTTPSErrors: useBurp,
    // Failure screenshot and trace come from the shared-tab fixture; built-in recording
    // only covers per-test contexts. Video is off because the tab is shared by all tests.
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },
  projects: [
    {
      name: 'Desktop Chrome',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
    },
  ],
});
