import 'dotenv/config';
import { defineConfig, devices, type Project } from '@playwright/test';

const useBurp = process.env.USE_BURP === 'true';

if (!process.env.BASE_URL) {
  throw new Error('BASE_URL is not set. Copy .env.example to .env and fill in the values.');
}

// Run settings chosen in /qa:run-qa after plan approval, stored in .env:
//   QA_PROJECTS  comma-separated project names below, or "all" (default: all)
//   HEADLESS     true runs without a browser window (default: false, headed)
//   SCREENSHOT / VIDEO are read by fixtures/auth.fixture.ts (see .env.example).
const headless = process.env.HEADLESS === 'true';

// Galaxy S25 Ultra is not in Playwright's device registry yet. Real values: 6.9" 1440x3120,
// CSS viewport 412x891 at DPR 3.5. The user agent reuses the registry's current Chrome version.
const galaxyS25Ultra = {
  ...devices['Galaxy S24'],
  userAgent: devices['Galaxy S24'].userAgent.replace(/Android \d+; SM-\w+/, 'Android 15; SM-S938B'),
  screen: { width: 412, height: 891 },
  viewport: { width: 412, height: 891 },
  deviceScaleFactor: 3.5,
};

const desktopViewport = { width: 1440, height: 900 };

const allProjects: Project[] = [
  {
    name: 'Chrome',
    metadata: { device: 'Desktop 1440x900' },
    use: { ...devices['Desktop Chrome'], viewport: desktopViewport },
  },
  {
    name: 'Firefox',
    metadata: { device: 'Desktop 1440x900' },
    use: { ...devices['Desktop Firefox'], viewport: desktopViewport },
  },
  {
    name: 'Safari',
    metadata: { device: 'Desktop 1440x900' },
    use: { ...devices['Desktop Safari'], viewport: desktopViewport },
  },
  {
    name: 'Mobile Chrome',
    metadata: { device: 'Samsung Galaxy S25 Ultra' },
    use: galaxyS25Ultra,
  },
  {
    // Registry descriptor: screen 402x874 @ 3x, Safari visible viewport 402x681, WebKit.
    name: 'Mobile Safari',
    metadata: { device: 'iPhone 16 Pro' },
    use: { ...devices['iPhone 16 Pro'] },
  },
];

const selected = (process.env.QA_PROJECTS || 'all').split(',').map((s) => s.trim()).filter(Boolean);
const unknown = selected.filter((s) => s !== 'all' && !allProjects.some((p) => p.name === s));
if (unknown.length) {
  throw new Error(`QA_PROJECTS has unknown project(s): ${unknown.join(', ')}. Valid: all, ${allProjects.map((p) => p.name).join(', ')}`);
}
const projects = selected.includes('all') ? allProjects : allProjects.filter((p) => selected.includes(p.name as string));

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
    // Jira-ready bug report for every failed test: reports/failed-test-cases.{md,csv}, reports/bug-reports/
    ['./reporters/bug-reporter.ts'],
  ],
  use: {
    baseURL: process.env.BASE_URL,
    headless,
    // If the app uses a custom test id attribute (e.g. data-test), set it here AND in the
    // shared-tab fixture (playwright.selectors.setTestIdAttribute).
    // testIdAttribute: 'data-test',
    proxy: useBurp ? { server: 'http://127.0.0.1:8080' } : undefined,
    ignoreHTTPSErrors: useBurp,
    // Built-in recording only covers per-test contexts, so it stays off. The shared-tab fixture
    // records screenshots and per-test video (page.screencast) based on SCREENSHOT and VIDEO in .env.
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },
  projects,
});
