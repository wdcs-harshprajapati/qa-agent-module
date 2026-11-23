/**
 * REFERENCE fixture for single-tab mode. test-generator copies this into the workspace as
 * fixtures/auth.fixture.ts and adapts the parts marked ADAPT. Do not import it from here.
 *
 * Design:
 * - One browser context + one tab per worker (worker-scoped sharedContext/sharedPage).
 *   The built-in `page`/`context` fixtures return them, so every test runs in the same tab.
 * - Before each test the tab is reset (cookies, localStorage, sessionStorage), then the
 *   saved session is restored for authenticated tests (storageState saved under .auth/).
 * - Login runs in the shared tab (never a second tab) and is refreshed before the session
 *   cookie expires.
 * - Use ONE test object everywhere. Guest tests use `test.use({ authenticated: false })`.
 *   A second test object (base.extend) changes the worker fixtures, which forces a new
 *   worker and therefore a new tab.
 * - Playwright always restarts the worker after a failed test, so a failure opens a new tab.
 */
import { test as base, expect, BrowserContext, Cookie, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
// ADAPT: import the page objects this suite uses.
// import { LoginPage } from '../pages/login.page';

type TestFixtures = {
  /** true (default): test starts logged in. Use `test.use({ authenticated: false })` for guest tests. */
  authenticated: boolean;
  // ADAPT: one fixture per page object, e.g. loginPage: LoginPage;
};

type WorkerFixtures = {
  sharedContext: BrowserContext;
  sharedPage: Page;
  authSession: AuthSession;
};

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env. Copy .env.example to .env and fill in the values.`);
  return value;
}

/** ADAPT: log in through the UI using page objects, then wait for a stable logged-in element. */
async function performLogin(page: Page): Promise<void> {
  // const loginPage = new LoginPage(page);
  // await loginPage.goto();
  // await loginPage.login(requireEnv('TEST_USER'), requireEnv('TEST_PASSWORD'));
  // await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  throw new Error('performLogin() is not implemented for this app');
}

/** ADAPT: name of the cookie that carries the session (used to detect expiry). */
const SESSION_COOKIE = 'session';

class AuthSession {
  private cookies: Cookie[] = [];
  private origins: { origin: string; localStorage: { name: string; value: string }[] }[] = [];

  constructor(private readonly file: string) {}

  private isValid(): boolean {
    const nowSeconds = Date.now() / 1000;
    const session = this.cookies.find((c) => c.name === SESSION_COOKIE);
    return !!session && (session.expires === -1 || session.expires - nowSeconds > 60);
  }

  /** Restores the session into the shared tab, logging in again if needed. */
  async apply(page: Page): Promise<void> {
    if (!this.isValid()) {
      await performLogin(page);
      const state = await page.context().storageState({ path: this.file });
      this.cookies = state.cookies;
      this.origins = state.origins;
      return;
    }
    await page.context().addCookies(this.cookies);
    // ADAPT: if the app keeps its auth token in localStorage, restore it for the current origin.
    for (const origin of this.origins) {
      if (new URL(page.url()).origin !== origin.origin) continue;
      await page.evaluate((items) => {
        for (const { name, value } of items) localStorage.setItem(name, value);
      }, origin.localStorage);
    }
  }
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  authenticated: [true, { option: true }],

  sharedContext: [
    async ({ browser, playwright }, use, workerInfo) => {
      const u = workerInfo.project.use;
      // Manually created contexts do not get the config's testIdAttribute; set it globally.
      if (u.testIdAttribute) playwright.selectors.setTestIdAttribute(u.testIdAttribute);
      const context = await browser.newContext({
        baseURL: u.baseURL,
        viewport: u.viewport,
        screen: u.screen,
        userAgent: u.userAgent,
        deviceScaleFactor: u.deviceScaleFactor,
        isMobile: u.isMobile,
        hasTouch: u.hasTouch,
        proxy: u.proxy,
        ignoreHTTPSErrors: u.ignoreHTTPSErrors,
        acceptDownloads: true,
      });
      await context.tracing.start({ screenshots: true, snapshots: true });
      await use(context);
      await context.tracing.stop();
      await context.close();
    },
    { scope: 'worker' },
  ],

  sharedPage: [
    async ({ sharedContext }, use) => {
      await use(await sharedContext.newPage());
    },
    { scope: 'worker' },
  ],

  authSession: [
    async ({}, use, workerInfo) => {
      const slug = workerInfo.project.name.replace(/\W+/g, '-').toLowerCase();
      const file = path.resolve(__dirname, '..', '.auth', `${slug}.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await use(new AuthSession(file));
    },
    { scope: 'worker' },
  ],

  context: async ({ sharedContext }, use) => {
    await use(sharedContext);
  },

  page: async ({ sharedPage, authSession, authenticated }, use, testInfo) => {
    const context = sharedPage.context();

    // Reset state left by the previous test. Storage can only be cleared on the app origin.
    await context.clearCookies();
    await sharedPage.goto('/');
    await sharedPage.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    if (authenticated) await authSession.apply(sharedPage);

    await context.tracing.startChunk({ title: testInfo.title });
    await use(sharedPage);

    // Failure artifacts (built-in screenshot/trace options only cover per-test contexts).
    if (testInfo.status !== testInfo.expectedStatus) {
      const screenshot = testInfo.outputPath('test-failed.png');
      await sharedPage.screenshot({ path: screenshot }).catch(() => undefined);
      if (fs.existsSync(screenshot)) {
        await testInfo.attach('screenshot', { path: screenshot, contentType: 'image/png' });
      }
      const trace = testInfo.outputPath('trace.zip');
      await context.tracing.stopChunk({ path: trace });
      await testInfo.attach('trace', { path: trace, contentType: 'application/zip' });
    } else {
      await context.tracing.stopChunk();
    }
  },

  // ADAPT: page object fixtures, e.g.
  // loginPage: async ({ page }, use) => use(new LoginPage(page)),
});

export { expect };
