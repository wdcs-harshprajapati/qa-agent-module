import fs from 'fs';
import dotenv from 'dotenv';
import { defineConfig, devices, type Project } from '@playwright/test';

// Environment files. Precedence: command line > .env.<QA_ENV> > .env
//   .env           shared run settings (QA_PROJECTS, SCREENSHOT, VIDEO, ...) and QA_ENV
//   .env.<name>    one file per environment (BASE_URL and that environment's credentials)
// Switch environment for one run: npx cross-env QA_ENV=staging playwright test
const baseEnv = fs.existsSync('.env') ? dotenv.parse(fs.readFileSync('.env')) : {};
const qaEnv = process.env.QA_ENV || baseEnv.QA_ENV || '';
if (qaEnv) {
  const envFile = `.env.${qaEnv}`;
  if (!fs.existsSync(envFile)) throw new Error(`QA_ENV is "${qaEnv}" but ${envFile} does not exist.`);
  dotenv.config({ path: envFile });
}
dotenv.config();
process.env.QA_ENV = qaEnv;

const useBurp = process.env.USE_BURP === 'true';

if (!process.env.BASE_URL) {
  throw new Error('BASE_URL is not set. Copy .env.example to .env and fill in the values.');
}

// Run settings chosen in /qa:run-qa after plan approval, stored in .env:
//   QA_PROJECTS     comma-separated project names below, or "all" (default: all)
//   HEADLESS        true runs without a browser window (default: false, headed)
//   QA_MOBILE_MODE  emulation (default) | android-emulator | browserstack
//   WORKERS         parallel workers (default 1). Keep 1 so cases run one by one in a single tab.
//                   Raise only when the user explicitly asks for parallel runs (one window per worker).
//   SCREENSHOT / VIDEO are read by fixtures/shared-page.fixture.ts (see .env.example).
const headless = process.env.HEADLESS === 'true';
const mobileMode = process.env.QA_MOBILE_MODE || 'emulation';
if (!['emulation', 'android-emulator', 'browserstack'].includes(mobileMode)) {
  throw new Error(`QA_MOBILE_MODE "${mobileMode}" is not valid. Use emulation, android-emulator, or browserstack.`);
}

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

// Visual baselines live in one folder per OS and browser project. Real devices (emulator,
// BrowserStack) render differently from emulation, so they get their own baseline folder.
const snapshots = (folder: string) => `{testDir}/__screenshots__/{platform}/${folder}/{testFilePath}/{arg}{ext}`;

// Mobile projects per mode. fixtures/shared-page.fixture.ts reads metadata.android / metadata.realDevice.
// - android-emulator: Chrome inside a running Android emulator (adb). iOS simulators need macOS
//   and are not supported by Playwright, so Mobile Safari stays emulated in this mode.
// - browserstack: real devices through the BrowserStack SDK (npm run test:browserstack).
const mobileChrome: Project =
  mobileMode === 'android-emulator'
    ? {
        name: 'Mobile Chrome',
        metadata: { device: 'Android emulator (adb)', android: true },
        snapshotPathTemplate: snapshots('{projectName}-android-emulator'),
        // Headless only hides the unused desktop browser; the emulator window shows the test.
        use: { browserName: 'chromium', isMobile: true, hasTouch: true, headless: true },
      }
    : mobileMode === 'browserstack'
      ? {
          name: 'Mobile Chrome',
          metadata: { device: 'BrowserStack real device', realDevice: true },
          snapshotPathTemplate: snapshots('{projectName}-browserstack'),
          use: { browserName: 'chromium' },
        }
      : { name: 'Mobile Chrome', metadata: { device: 'Samsung Galaxy S25 Ultra' }, use: galaxyS25Ultra };

const mobileSafari: Project =
  mobileMode === 'browserstack'
    ? {
        name: 'Mobile Safari',
        metadata: { device: 'BrowserStack real device', realDevice: true },
        snapshotPathTemplate: snapshots('{projectName}-browserstack'),
        use: { browserName: 'webkit' },
      }
    : {
        // Registry descriptor: screen 402x874 @ 3x, Safari visible viewport 402x681, WebKit.
        name: 'Mobile Safari',
        metadata: { device: 'iPhone 16 Pro' },
        use: { ...devices['iPhone 16 Pro'] },
      };

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
  mobileChrome,
  mobileSafari,
];

const selected = (process.env.QA_PROJECTS || 'all').split(',').map((s) => s.trim()).filter(Boolean);
const unknown = selected.filter((s) => s !== 'all' && !allProjects.some((p) => p.name === s));
if (unknown.length) {
  throw new Error(`QA_PROJECTS has unknown project(s): ${unknown.join(', ')}. Valid: all, ${allProjects.map((p) => p.name).join(', ')}`);
}
const browserProjects = (selected.includes('all') ? allProjects : allProjects.filter((p) => selected.includes(p.name as string))).map(
  (p): Project => ({ ...p, testIgnore: /security-report\.spec\.ts/ }),
);

// Browserless project that shows security-auditor results in the HTML report. Added only when the audit produced findings.
const securityProject: Project[] = fs.existsSync('reports/security-findings.json')
  ? [{ name: 'Security', metadata: { device: 'No browser (audit results)' }, retries: 0, testMatch: /security-report\.spec\.ts/ }]
  : [];
const projects = [...browserProjects, ...securityProject];

const workers = Number.parseInt(process.env.WORKERS ?? '', 10) > 0 ? Number.parseInt(process.env.WORKERS as string, 10) : 1;

export default defineConfig({
  testDir: './tests',
  // Single-tab mode: one worker, tests in order, each project reuses one tab
  // (see fixtures/shared-page.fixture.ts). Projects run one after the other.
  // WORKERS > 1 (explicit parallel runs only) opens one window per worker.
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: useBurp ? 1 : workers,
  reporter: [
    ['list'],
    ['json', { outputFile: 'reports/playwright-results.json' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    // Jira-ready bug reports, run archive, and run comparison (see reporters/bug-reporter.ts).
    ['./reporters/bug-reporter.ts'],
  ],
  // Visual regression baselines (@visual tests): one set per OS and browser project. Comparison is
  // strict (no pixel tolerance): mask dynamic areas (dates, ads, carousels) with the `mask` option.
  // Create or refresh them with: npm run test:update-baselines
  snapshotPathTemplate: snapshots('{projectName}'),
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide' },
  },
  use: {
    baseURL: process.env.BASE_URL,
    headless,
    // If the app uses a custom test id attribute (e.g. data-test), set it here. The shared-page
    // fixture applies it with playwright.selectors.setTestIdAttribute (manual contexts ignore it).
    // testIdAttribute: 'data-test',
    proxy: useBurp ? { server: 'http://127.0.0.1:8080' } : undefined,
    ignoreHTTPSErrors: useBurp,
    // Built-in recording only covers per-test contexts, so it stays off. fixtures/shared-page.fixture.ts
    // handles screenshot, trace, and video (SCREENSHOT and VIDEO in .env) for the shared tab.
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },
  projects,
});
